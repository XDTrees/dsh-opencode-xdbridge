/**
 * Host-side plugin entry.
 *
 * Starts a managed, isolated OpenCode runtime, exposes it through a loopback
 * OpenAI-compatible endpoint, and registers that endpoint as the
 * `opencode-xdbridge` model provider in the Harness LLM seam. It also mounts the
 * same-origin routes backing this plugin's settings page.
 *
 * Startup is asynchronous on purpose. Preparing the runtime can mean a one-time
 * ~60 MB download, and blocking `apply()` on that would stall the whole Harness
 * boot. The provider is therefore registered once the runtime is healthy; until
 * then the picker simply does not offer it, and the settings page reports the
 * startup state.
 *
 * @module dsh-opencode-xdbridge
 */

import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import z from '@deepseek-ai/schemastery'
import { dataDirectory } from './platform.js'
import { findRuntime, startBackend } from './runtime.js'
import { createShim } from './shim.js'
import { clientModelID } from './model-id.js'
import { BridgeCatalog, classifyFailure } from './catalog.js'
import { createBridgeAdapter, BRIDGE_PROVIDER, BRIDGE_DISPLAY_NAME } from './adapter.js'
import { prepare } from './protocol.js'
import { PROBE_ATTEMPT_TIMEOUT_MS, probeBody, probeModel, formatUnsupported } from './probe.js'
import { registerBridgeStatusRoute } from './web-status.js'

/** Stable Cordis plugin name. */
export const name = 'llm-opencode-xdbridge'

/** The model registry must exist before a provider can register. */
export const inject = ['llm']

/** Settings namespace reserved for this plugin. */
export const BRIDGE_SETTINGS_NS = 'opencode-xdbridge'

/**
 * Plugin configuration schema.
 *
 * Declared so the host can validate and surface these fields, and so a bad
 * value is reported at configuration time rather than at runtime.
 */
export const Config = z.object({
  dataDir: z.string().description('存放受管 OpenCode 运行时、日志与状态的目录（默认在 DSH home 下）'),
  binaryPath: z.string().description('使用已有的 OpenCode 可执行文件，而不是下载官方版本'),
  runtimeVersion: z.string().description('固定使用某个 OpenCode 版本'),
  autoRefresh: z.boolean().default(true).description('启动后稍晚重新读取一次免费模型清单'),
})

/** Default config values, documented in one place. */
export const DEFAULTS = {
  autoRefresh: true,
}

/** How long to wait before the post-startup roster refresh. */
const REFRESH_DELAY_MS = 15_000

/** Log file for the managed runtime, rotated at 5 MB. */
async function openLogStream(dataDir) {
  const file = path.join(dataDir, 'opencode.log')
  try {
    const stat = await fsp.stat(file)
    if (stat.size > 5 * 1024 * 1024) await fsp.rename(file, `${file}.previous`)
  } catch { /* no existing log */ }
  return fs.createWriteStream(file, { flags: 'a', mode: 0o600 })
}

/**
 * Cordis plugin entry.
 *
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {Config} config
 */
export function apply(ctx, config = {}) {
  const logger = ctx.logger ?? console
  const settings = { ...DEFAULTS, ...config }
  const dataDir = dataDirectory(settings)

  const catalog = new BridgeCatalog()
  let runtime
  let shim
  let backend
  let logStream
  let closed = false
  let phase = 'starting'
  let message = '正在启动隔离模型服务'
  /** In-flight requests, keyed by session, for the page's activity line. */
  const activities = new Map()
  let probeState = { running: false, current: undefined, pending: [] }

  /** Release everything this plugin owns, once. */
  const shutdown = async () => {
    if (closed) return
    closed = true
    phase = 'stopped'
    await shim?.close().catch(() => {})
    await runtime?.stop().catch(() => {})
    logStream?.end()
  }

  // Register teardown before any resource exists, so a failure part-way through
  // still releases whatever was already created.
  ctx.effect(() => shutdown)

  /**
   * Read the free-model catalog from the runtime.
   *
   * A failure keeps the previous list rather than emptying the picker: an
   * unreadable catalog is not a verdict on any model.
   */
  const refresh = async () => {
    if (backend === undefined) throw new Error('运行时尚未就绪')
    const models = await backend.models()
    catalog.replace(models)
    logger.info?.(`dsh-opencode-xdbridge: ${models.length} 个免费模型可用`)
    return { count: models.length }
  }

  /**
   * Run a detection sweep, one model at a time.
   *
   * Sequential on purpose: probing in parallel would compete for the same
   * upstream quota and make every measurement slower and noisier.
   */
  const probe = async (modelId) => {
    if (backend === undefined) throw new Error('运行时尚未就绪')
    if (probeState.running) return { started: false, message: '检测正在进行' }

    const selected = modelId ? catalog.all().filter(model => model.id === modelId) : catalog.all()
    if (selected.length === 0) throw new Error('模型不在当前目录中')

    probeState = { running: true, current: undefined, pending: selected.map(model => model.id) }
    let ok = 0
    let failed = 0

    // Detached from the HTTP request: a sweep takes tens of seconds per model,
    // so the route returns immediately and the page follows `probe` progress.
    const task = (async () => {
      try {
        for (const model of selected) {
          if (closed) break
          probeState = { running: true, current: model.id, pending: probeState.pending.filter(id => id !== model.id) }
          const started = Date.now()
          try {
            if (model.supportsTools === false) {
              throw Object.assign(new Error('运行时未声明该模型支持工具调用'), { code: 'invalid_tool_call', status: 502 })
            }
            await probeModel({
              // `complete` takes a PREPARED request, so the probe body goes
              // through the same `prepare` the real request path uses. Running
              // detection through the real translator is the point: it measures
              // the model on the path actual traffic takes.
              //
              // Validation runs against `all()`, NOT `visible()`: `visible()`
              // hides models already marked unusable, so probing against it
              // made every failed model permanently unprobeable — `prepare`
              // rejected it as model_not_found and the badge could never
              // recover.
              //
              // Each attempt gets its own deadline (owned by `probeModel`), so
              // a slow first try cannot starve the retry.
              complete: (token, signal) => backend.complete(
                prepare(probeBody(model, token), catalog.all()),
                signal,
                { probe: true },
              ),
            })
            catalog.record(model.id, { ok: true, source: 'probe', durationMs: Date.now() - started })
            ok += 1
          } catch (cause) {
            const error = cause
            if (!closed && error.code === 'no_action') {
              // A text-only reply says the model works, just not for tool use:
              // publish it as chat-only instead of withdrawing it.
              catalog.record(model.id, {
                ok: true, source: 'probe', chatOnly: true, durationMs: Date.now() - started,
                error: '探测时只返回文本、未产生动作；已按仅对话发布',
              })
              ok += 1
            } else if (!closed && formatUnsupported(error)) {
              catalog.record(model.id, {
                ok: true, source: 'probe', chatOnly: true, durationMs: Date.now() - started,
                error: `工具转换不兼容：${error.message}`,
              })
              ok += 1
            } else if (!closed) {
              catalog.record(model.id, {
                ok: false, source: 'probe', durationMs: Date.now() - started,
                category: classifyFailure(error.message, error.status),
                error: error.name === 'TimeoutError' ? '模型探测超时' : error.message,
              })
              failed += 1
            }
          }
        }
      } finally {
        probeState = { running: false, current: undefined, pending: [] }
      }
    })()

    return { started: true, count: selected.length, task, done: task.then(() => ({ ok, failed })) }
  }

  /**
   * Restart the managed runtime, keeping the shim and provider in place.
   *
   * Only the OpenCode process is replaced: the shim's `complete` reads the
   * `backend` variable at call time and the adapter reads `shim.baseUrl()` per
   * model list, so neither needs re-registering. Re-registering would also fail
   * with DUPLICATE_ADAPTER.
   */
  const restart = async () => {
    if (closed) throw new Error('插件已卸载')
    logger.info?.('dsh-opencode-xdbridge: 正在重启运行时')
    phase = 'starting'
    message = '正在重启 OpenCode 运行时'
    await runtime?.stop().catch(() => {})
    runtime = undefined
    backend = undefined

    await fsp.mkdir(dataDir, { recursive: true, mode: 0o700 })
    const binary = await findRuntime(dataDir, text => {
      message = text
      logger.info?.(`dsh-opencode-xdbridge: ${text}`)
    }, {
      ...(settings.binaryPath ? { candidates: [settings.binaryPath] } : {}),
      ...(settings.runtimeVersion ? { version: settings.runtimeVersion } : {}),
    })
    runtime = await startBackend(binary, dataDir, logStream)
    backend = runtime.backend
    if (closed) { await runtime.stop().catch(() => {}); return {} }

    await refresh().catch(error => {
      logger.warn?.(`dsh-opencode-xdbridge: 重启后读取模型失败：${error.message}`)
    })
    phase = 'ready'
    message = `运行中 · ${catalog.all().length} 个免费模型`
    return { count: catalog.all().length, runtimeVersion: runtime.version }
  }

  /** Build the status document the settings page renders. */
  const status = () => ({
    phase,
    message,
    runtimeVersion: runtime?.version,
    endpoint: shim?.baseUrl(),
    dataDir,
    provider: BRIDGE_PROVIDER,
    models: catalog.describeAll(),
    probe: probeState,
    activity: [...activities.values()].map(entry => ({
      model: entry.model,
      status: entry.status,
      waitedMs: Date.now() - entry.startedAt,
      ...(entry.attempt !== undefined ? { attempt: entry.attempt } : {}),
      ...(entry.error !== undefined ? { error: entry.error } : {}),
    })),
    metrics: catalog.metrics(),
  })

  /**
   * Bridge the runtime's progress events into the activity map.
   *
   * A slow or retrying upstream otherwise produces no visible state at all, so
   * the page would show a bare "request in flight" with no detail.
   */
  const noteActivity = progress => {
    if (!progress?.sessionID) return
    if (progress.type === 'request.done') { activities.delete(progress.sessionID); return }
    const entry = activities.get(progress.sessionID) ?? { sessionID: progress.sessionID, startedAt: Date.now(), status: 'waiting' }
    Object.assign(entry, {
      model: progress.model ?? entry.model,
      status: progress.status ?? entry.status,
      ...(progress.attempt !== undefined ? { attempt: progress.attempt } : {}),
      ...(progress.error !== undefined ? { error: progress.error } : {}),
    })
    activities.set(progress.sessionID, entry)
  }

  /** Record a real request's outcome against the catalog. */
  const onResult = (modelId, ok, error, statusCode) => {
    if (!modelId) return
    catalog.record(modelId, {
      ok,
      source: 'request',
      ...(ok ? {} : { category: classifyFailure(error ?? '', statusCode), error: error ?? '请求失败' }),
    })
  }

  /** Start (or restart) the runtime and register the provider. */
  const init = async () => {
    if (closed) return
    await fsp.mkdir(dataDir, { recursive: true, mode: 0o700 })
    if (logStream === undefined) logStream = await openLogStream(dataDir)
    if (closed) return

    phase = 'starting'
    message = '正在准备 OpenCode 运行时'

    // 1. A real OpenCode binary. Required, not incidental: OpenCode Zen only
    //    serves its free tier to traffic from a genuine OpenCode runtime.
    const binary = await findRuntime(dataDir, text => {
      message = text
      logger.info?.(`dsh-opencode-xdbridge: ${text}`)
    }, {
      ...(settings.binaryPath ? { candidates: [settings.binaryPath] } : {}),
      ...(settings.runtimeVersion ? { version: settings.runtimeVersion } : {}),
    })
    if (closed) return

    // 2. The isolated runtime: its own XDG root, a fresh server secret, and the
    //    approval-gated agents that keep the free tier reachable.
    runtime = await startBackend(binary, dataDir, logStream)
    backend = runtime.backend
    if (closed) return
    logger.info?.(`dsh-opencode-xdbridge: OpenCode ${runtime.version} 运行时已就绪`)

    // 3. The loopback endpoint pi-ai will talk to.
    shim = await createShim({
      complete: (request, signal, meta) => backend.complete(request, signal, meta),
      getModels: () => catalog.visible(),
      refresh,
      logger,
      // Lets a `capture-requests` marker file in the data directory switch on
      // request capture without needing to relaunch the Harness with an env var.
      dataDir,
    })
    if (closed) return
    logger.info?.(`dsh-opencode-xdbridge: 本地端点 ${shim.baseUrl()}`)

    // 4. Seed the catalog before registering, so the provider is never empty.
    await refresh().catch(error => {
      logger.warn?.(`dsh-opencode-xdbridge: 免费模型读取失败，稍后重试：${error.message}`)
    })
    if (closed) return

    phase = 'ready'
    message = `运行中 · ${catalog.all().length} 个免费模型`

    // 5. Re-read the roster once startup settles: the first reading can race
    //    upstream catalog propagation.
    if (settings.autoRefresh && !closed) {
      const timer = setTimeout(() => { void refresh().catch(() => {}) }, REFRESH_DELAY_MS)
      timer.unref?.()
    }
    return { count: catalog.all().length }
  }

  /** Register the provider once the runtime is healthy. */
  const register = () => {
    if (closed) return
    const bridge = createBridgeAdapter({ shim, catalog, ctx })
    const releaseAdapter = ctx.llm.registerAdapter([BRIDGE_PROVIDER], bridge.adapter)
    const releaseDirectory = ctx.llm.registerConfigurableProviders([{
      provider: BRIDGE_PROVIDER,
      displayName: BRIDGE_DISPLAY_NAME,
      settingsNs: BRIDGE_SETTINGS_NS,
      settingsPath: [],
      declared: false,
    }])
    // Answering discovery from the live catalog is what makes a newly available
    // free model appear without restarting the host.
    const releaseDiscovery = ctx.llm.registerModelDiscovery(BRIDGE_SETTINGS_NS, async request => {
      if (request?.provider !== undefined && request.provider !== BRIDGE_PROVIDER) return []
      return catalog.visible().map(model => ({
        id: model.id,
        name: clientModelID(model),
        contextWindow: model.contextWindow,
        maxTokens: model.maxOutputTokens,
        inputModalities: model.supportsImages ? ['text', 'image'] : ['text'],
      }))
    })

    ctx.effect(() => () => {
      try { releaseDiscovery() } catch { /* already released */ }
      try { releaseDirectory() } catch { /* already released */ }
      try { releaseAdapter() } catch { /* already released */ }
    })
    logger.info?.(`dsh-opencode-xdbridge: provider "${BRIDGE_PROVIDER}" 已注册，${catalog.visible().length} 个模型`)
  }

  // The settings page's routes. `webServer` is optional: a headless profile
  // simply never mounts them and the provider still serves models.
  ctx.inject(['webServer'], webCtx => {
    registerBridgeStatusRoute(webCtx, {
      status,
      refresh: async modelId => {
        if (modelId) return { count: (await refresh(), catalog.all().length) }
        return refresh()
      },
      probe: async modelId => {
        const started = await probe(modelId)
        if (started.started === false) return started
        // Report the finished sweep, so the button's feedback is accurate.
        const summary = await started.done
        return { ...summary, count: started.count }
      },
      restart,
      model: modelId => catalog.describe(modelId),
    })
  })

  // Deliberately not awaited: the download must never hold up Harness boot.
  void (async () => {
    try {
      await init()
      register()
    } catch (error) {
      phase = 'error'
      message = `运行时错误：${error?.message ?? error}`
      logger.error?.(`dsh-opencode-xdbridge: 启动失败：${error?.message ?? error}`)
      await shutdown().catch(() => {})
    }
  })()
}

export { BRIDGE_PROVIDER, BRIDGE_DISPLAY_NAME }
export { dataDirectory, dshHome, runtimePackage } from './platform.js'
export { findRuntime, startBackend, nativePermissions, isolatedAgents } from './runtime.js'
export { Backend, freeModels } from './backend.js'
export { clientModelID } from './model-id.js'
export { BridgeCatalog, classifyFailure } from './catalog.js'
export { createShim } from './shim.js'
export { createBridgeAdapter } from './adapter.js'
export { prepare, decode, completion, BridgeError } from './protocol.js'
export { registerBridgeStatusRoute } from './web-status.js'
export { probeBody, probeModel, judgeProbe } from './probe.js'
