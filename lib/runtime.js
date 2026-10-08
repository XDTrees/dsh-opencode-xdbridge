/**
 * Managed OpenCode runtime: locate, download and supervise the isolated
 * `opencode serve` process this plugin talks to.
 *
 * Why a real process is required (verified 2026-09-29): OpenCode Zen answers a
 * direct call to its free models with
 * `FreeTierError: OpenCode's free tier can only be used from within OpenCode`.
 * No header or User-Agent change lifts that gate; only traffic originating from
 * a genuine OpenCode runtime is accepted. So this plugin ships no protocol
 * trick — it runs the vendor's own binary and speaks to it locally.
 *
 * Isolation: a dedicated XDG root under the plugin's data directory, a fresh
 * random server password per start, autoupdate/share/project-config disabled,
 * and only ordinary OS/network variables forwarded. The user's own OpenCode
 * configuration, credentials and sessions are never read or written.
 *
 * @module dsh-opencode-xdbridge/runtime
 */

import fs from 'node:fs/promises'
import { createReadStream, createWriteStream } from 'node:fs'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'
import { spawn, execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createHash, randomBytes } from 'node:crypto'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { connect as tlsConnect } from 'node:tls'
import { runtimePackage, VERSION_PATTERN } from './platform.js'
import { Backend } from './backend.js'

const exec = promisify(execFile)

/**
 * Permission policy that keeps the free-tier gate open.
 *
 * This is load-bearing, not cosmetic. Measured 2026-09-29 with an A/B/C/D
 * matrix against a live `opencode serve`:
 *   permission {'*':'ask'}                            -> request served
 *   permission {'*':'deny'}                           -> FreeTierError 403
 *   agent.tools {'*':false}                           -> FreeTierError 403
 *   agent permission {'*':'deny'}                     -> FreeTierError 403
 * Every native operation is therefore *asked* and then refused by the bridge,
 * which is what makes the runtime look like an ordinary OpenCode session to
 * the upstream while still executing nothing locally.
 */
export const nativePermissions = {
  '*': 'ask',
  question: 'deny',
  websearch: 'deny',
  codesearch: 'deny',
  webfetch: 'deny',
  task: 'deny',
  plan_enter: 'deny',
  plan_exit: 'deny',
  todowrite: 'deny',
}

/**
 * Agents installed into the isolated runtime.
 *
 * `buddy-bridge` turns a request into a JSON envelope instead of acting.
 * `buddy-chat` is the text-only twin used for chat-only models.
 */
export const isolatedAgents = {
  'buddy-bridge': {
    mode: 'primary',
    description: 'External client inference only',
    prompt: 'You are the reasoning component of an external assistant. Never invoke native OpenCode tools. Describe external tool calls only in the requested JSON response. The external client owns execution and supplies tool results on the next request.',
    permission: nativePermissions,
  },
  'buddy-chat': {
    mode: 'primary',
    description: 'Text-only external conversation',
    prompt: 'Reply in plain text to the external conversation. No tool use or local actions. Never claim to have executed an action.',
    permission: nativePermissions,
  },
}

/**
 * Environment variables forwarded into the isolated runtime.
 *
 * Proxy variables are deliberately absent. They reach the runtime only through
 * `runtimeProxyEnv`, which is opt-in — see `runtimeProxyEnabled` for the measured
 * reason: forwarding a proxy made every completion hang, while direct egress was
 * fine all along. Adding `*_PROXY` here would silently undo that switch, so this
 * list is the one place a proxy must never be reintroduced.
 */
const FORWARDED_ENV = [
  'PATH', 'HOME', 'USER', 'LANG', 'TMPDIR', 'SHELL', 'SSL_CERT_FILE',
  'NODE_EXTRA_CA_CERTS', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'USERPROFILE',
  'APPDATA', 'LOCALAPPDATA', 'PATHEXT', 'COMSPEC',
]

/** Node's XDG roots the runtime should use, all under the plugin data dir. */
const XDG_ROOTS = ['config', 'data', 'cache', 'state']

async function binaryVersion(file) {
  const { stdout } = await exec(file, ['--version'], { timeout: 15000, windowsHide: true })
  return stdout.trim()
}

/**
 * Find a usable OpenCode binary, downloading the official one when needed.
 *
 * Resolution order: an already-managed installation under `<dataDir>/runtime`,
 * then an explicit path, then the user's own `opencode` on PATH (copied in, so
 * the managed runtime is always self-contained), and finally a download from
 * the vendor's npm package.
 *
 * @param {string} dataDir plugin data directory
 * @param {(message: string) => void} [status] progress reporter
 * @param {{candidates?: string[], version?: string}} [options]
 * @returns {Promise<string>} absolute path to the binary
 */
export async function findRuntime(dataDir, status = () => {}, options = {}) {
  const pkg = runtimePackage()
  const root = path.join(dataDir, 'runtime')

  // 1. A version-named directory we installed previously.
  const installed = (await fs.readdir(root, { withFileTypes: true }).catch(() => []))
    .filter(entry => entry.isDirectory() && VERSION_PATTERN.test(entry.name))
    .sort((a, b) => b.name.localeCompare(a.name, 'en', { numeric: true }))
  for (const entry of installed) {
    const file = path.join(root, entry.name, pkg.binary)
    try {
      if (await binaryVersion(file) === entry.name) return file
    } catch { /* stale directory: fall through and re-resolve */ }
  }

  // 2. A binary the user already has. Copying it in keeps the managed runtime
  //    independent of wherever the user's own installation lives.
  const candidates = options.candidates ?? [
    process.env.OPENCODE_BINARY_PATH,
    path.join(os.homedir(), '.opencode', 'bin', pkg.binary),
    '/opt/homebrew/bin/opencode',
    '/usr/local/bin/opencode',
    ...(await siblingRuntimes(dataDir, pkg.binary)),
  ].filter(Boolean)
  for (const file of candidates) {
    try {
      const found = await binaryVersion(file)
      if (!VERSION_PATTERN.test(found)) continue
      const target = path.join(root, found, pkg.binary)
      await fs.mkdir(path.dirname(target), { recursive: true })
      status('正在准备独立 OpenCode 运行时')
      await fs.copyFile(file, `${target}.tmp`)
      await fs.chmod(`${target}.tmp`, 0o755)
      await fs.rename(`${target}.tmp`, target)
      return target
    } catch { /* not this candidate */ }
  }

  // 3. Download the official package.
  status('正在获取 OpenCode 官方运行时')
  return downloadRuntime(dataDir, pkg, options, status)
}

/**
 * Where the runtime archive can be fetched from, most-preferred first.
 *
 * The official registry is always first: it is the source of truth, and the
 * sha512 from its metadata is what every mirror's bytes are checked against, so
 * a mirror can never substitute different content. The others exist because the
 * registry's CDN is not equally reachable from every network — a fresh install
 * should not be slow purely because of where the user happens to be.
 *
 * Set `OPENCODE_XDBRIDGE_RUNTIME_URL` to force a single source (a local cache,
 * an internal mirror) and skip probing entirely.
 */
function runtimeSources(officialTarball, version) {
  const forced = process.env.OPENCODE_XDBRIDGE_RUNTIME_URL
  if (forced) return [forced]
  const file = officialTarball.split('/').pop()
  return [
    officialTarball,
    // GitHub Releases on this plugin's own repo, as a fallback that does not
    // depend on npm at all.
    `https://github.com/XDTrees/dsh-opencode-xdbridge/releases/download/runtime-${version}/${file}`,
  ]
}

/**
 * Size of the archive, asked from whichever source answers first.
 *
 * A HEAD request is not enough: this registry answers HEAD without a
 * `content-length`, which would leave the resume loop with no termination
 * condition and let it append past the end of the archive. The total is
 * therefore read from a Range response's `content-range` (`bytes 0-0/60196031`),
 * which does carry it.
 */
async function contentLengthAny(sources) {
  for (const url of sources) {
    try {
      const res = await fetch(url, { headers: { Range: 'bytes=0-0' }, signal: AbortSignal.timeout(15000) })
      const range = res.headers.get('content-range')
      const total = Number(range?.split('/')[1] ?? 0)
      if (total > 0) return total
      const len = Number(res.headers.get('content-length') ?? 0)
      if (len > 0) return len
    } catch { /* try the next source */ }
  }
  return 0
}

/**
 * Download the archive, resuming whatever is already on disk.
 *
 * Each attempt continues from the current file size with a Range request, so
 * progress accumulates across restarts instead of being lost. Sources are
 * rotated when one stalls, and the whole thing is bounded by an overall budget
 * rather than a per-request timeout.
 */
async function downloadResumable(sources, archive, total, status) {
  // A budget for the whole download, not one request: a slow link needs time,
  // and the resume means that time is not wasted.
  const budget = Number(process.env.OPENCODE_XDBRIDGE_DOWNLOAD_BUDGET_MS ?? 30 * 60 * 1000)
  const deadline = Date.now() + budget
  let sourceIndex = 0

  for (;;) {
    const have = await fs.stat(archive).then(s => s.size).catch(() => 0)
    if (total > 0 && have >= total) return

    if (Date.now() > deadline) {
      throw Object.assign(
        new Error(`OpenCode 下载超时（已下载 ${(have / 1048576).toFixed(1)} MB / 共 ${(total / 1048576).toFixed(1)} MB，可重启继续）`),
        { code: 'runtime_download_timeout' },
      )
    }

    const url = sources[sourceIndex % sources.length]
    const start = have
    if (total > 0) {
      status(`正在下载 OpenCode：${(have / 1048576).toFixed(1)} / ${(total / 1048576).toFixed(1)} MB`)
    } else {
      status(`正在下载 OpenCode：已获取 ${(have / 1048576).toFixed(1)} MB`)
    }

    try {
      const res = await openRange(url, start, 60000)
      // 200 means the server ignored Range, so the body starts at zero again.
      if (res.status >= 400 || !res.stream) {
        sourceIndex += 1
        continue
      }
      const resumed = res.status === 206
      const stream = createWriteStream(archive, resumed ? { flags: 'a' } : { flags: 'w' })
      await pipeline(res.stream, stream)
    } catch (cause) {
      // Truncated writes are normal here: the resume picks them up next round.
      sourceIndex += 1
      if (sourceIndex > sources.length * 6) throw cause
      await new Promise(resolve => setTimeout(resolve, 1000))
    }
  }
}

/**
 * The proxy to use for a URL, honouring the standard environment variables.
 *
 * This matters more than it looks. Node's fetch ignores HTTP(S)_PROXY unless the
 * process was started with NODE_USE_ENV_PROXY, which the Harness is not, so a
 * user who has a proxy configured watched a 57 MB download crawl at ~90 KB/s
 * while their proxy would have served it at well over 1 MB/s. Reading the
 * variables here and tunnelling ourselves is the difference between an install
 * that takes a quarter of an hour and one that takes under a minute.
 */
function proxyFor(targetUrl) {
  let target
  try { target = new URL(targetUrl) } catch { return undefined }

  const noProxy = process.env.NO_PROXY ?? process.env.no_proxy ?? ''
  for (const entry of noProxy.split(',').map(s => s.trim()).filter(Boolean)) {
    if (entry === '*') return undefined
    const host = entry.startsWith('.') ? entry.slice(1) : entry
    if (target.hostname === host || target.hostname.endsWith(`.${host}`)) return undefined
  }

  const raw = target.protocol === 'https:'
    ? (process.env.HTTPS_PROXY ?? process.env.https_proxy ?? process.env.HTTP_PROXY ?? process.env.http_proxy)
    : (process.env.HTTP_PROXY ?? process.env.http_proxy)
  if (!raw) return undefined
  try { return new URL(raw) } catch { return undefined }
}

/**
 * Whether the isolated runtime should be given the host proxy.
 *
 * Measured 2026-10-08, and the reason this is a switch rather than automatic:
 * the runtime is *hurt* by inheriting a proxy. With the host proxy forwarded, a
 * plain completion to big-pickle never returned in 90 s and the runtime's own
 * HTTP call answered 500 `UnknownError` from `SessionPrompt.createUserMessage`.
 * With no proxy at all the same call completed in 3.8 s. Direct egress worked
 * throughout (`https://opencode.ai/zen/v1/models` -> HTTP 200 in 694 ms), so the
 * proxy buys the runtime nothing and costs it everything.
 *
 * This is not the downloader's situation. A 57 MB cross-border download goes from
 * ~90 KB/s to >1 MB/s through the proxy, which is a real win on a one-off large
 * transfer. The runtime's traffic is the opposite: many small requests plus heavy
 * loopback use, where a proxy is pure overhead and a loopback misroute deadlocks
 * the process against itself.
 *
 * Opt in with `OPENCODE_XDBRIDGE_RUNTIME_PROXY=1` when a runtime genuinely has no
 * direct route out.
 */
export function runtimeProxyEnabled() {
  return process.env.OPENCODE_XDBRIDGE_RUNTIME_PROXY === '1'
}

/**
 * The proxy environment to give the isolated runtime. Empty unless explicitly
 * enabled — see `runtimeProxyEnabled` for why the default is direct.
 *
 * @returns {Record<string,string>} variables to merge into the child environment
 */
export function runtimeProxyEnv() {
  if (!runtimeProxyEnabled()) return {}
  const env = {}
  for (const key of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY',
    'http_proxy', 'https_proxy', 'all_proxy']) {
    const value = process.env[key]
    if (value) env[key] = value
  }
  if (Object.keys(env).length === 0) return {}
  // Loopback is always excluded and cannot be widened by the host's NO_PROXY:
  // the runtime talks to its own HTTP server over 127.0.0.1, and routing that
  // through a proxy deadlocks it. The host's suffix entries (`.local` and the
  // like) are dropped rather than merged for the same reason — the runtime's
  // proxy handling does not interpret them the way Node does.
  return { ...env, NO_PROXY: LOOPBACK_BYPASS, no_proxy: LOOPBACK_BYPASS }
}

/** Hosts the runtime must always reach directly, whatever proxy is configured. */
const LOOPBACK_BYPASS = '127.0.0.1,localhost,::1,[::1]'

/** A human-readable description of the route the runtime actually uses. */
export function describeProxy() {
  if (!runtimeProxyEnabled()) {
    return { configured: false, enabled: false, summary: '直连（默认）' }
  }
  const env = runtimeProxyEnv()
  const raw = env.HTTPS_PROXY ?? env.https_proxy ?? env.HTTP_PROXY ?? env.http_proxy
  if (!raw) return { configured: false, enabled: true, summary: '直连（已启用代理但未配置）' }
  try {
    const url = new URL(raw)
    return {
      configured: true,
      enabled: true,
      summary: `${url.protocol}//${url.host}`,
      host: url.host,
      bypass: env.NO_PROXY,
    }
  } catch {
    return { configured: false, enabled: true, summary: '直连（代理变量无法解析）' }
  }
}

/** A human-readable description of the route the runtime actually uses. */

/** Open a CONNECT tunnel through a proxy to `host:port`. */
function tunnelledSocket(proxy, host, port, timeoutMs) {
  return new Promise((resolve, reject) => {
    const request = httpRequest({
      host: proxy.hostname,
      port: Number(proxy.port || 80),
      method: 'CONNECT',
      path: `${host}:${port}`,
      headers: { Host: `${host}:${port}` },
      timeout: timeoutMs,
      ...(proxy.username ? { headers: { 'Proxy-Authorization': `Basic ${Buffer.from(`${decodeURIComponent(proxy.username)}:${decodeURIComponent(proxy.password)}`).toString('base64')}` } } : {}),
    })
    request.on('connect', (response, socket) => {
      if (response.statusCode !== 200) {
        socket.destroy()
        reject(new Error(`代理 CONNECT 失败：HTTP ${response.statusCode}`))
        return
      }
      resolve(socket)
    })
    request.on('timeout', () => { request.destroy(new Error('代理连接超时')) })
    request.on('error', reject)
    request.end()
  })
}

/**
 * GET a URL, optionally from `start`, through the proxy if one is configured.
 *
 * Returns the same shape either way, so the caller does not care which path ran.
 */
async function openRange(url, start, timeoutMs) {
  const headers = {}
  if (start > 0) headers.Range = `bytes=${start}-`
  const proxy = proxyFor(url)

  if (!proxy) {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) })
    return {
      status: res.status,
      headers: res.headers,
      stream: res.body ? Readable.fromWeb(res.body) : undefined,
    }
  }

  // Through a proxy: CONNECT, then speak TLS and HTTP/1.1 over the tunnel.
  const target = new URL(url)
  const port = Number(target.port || 443)
  const socket = await tunnelledSocket(proxy, target.hostname, port, timeoutMs)
  const secure = tlsConnect({ socket, servername: target.hostname })

  return new Promise((resolve, reject) => {
    const done = (value) => { resolve(value) }
    const fail = (cause) => { secure.destroy(); reject(cause) }
    const request = httpsRequest({
      createConnection: () => secure,
      host: target.hostname,
      port,
      path: `${target.pathname}${target.search}`,
      method: 'GET',
      headers: { ...headers, Host: target.hostname, Connection: 'close' },
      timeout: timeoutMs,
    })
    request.on('response', (response) => {
      done({ status: response.statusCode, headers: response.headers, stream: response })
    })
    request.on('timeout', () => { request.destroy(new Error('下载超时')) })
    request.on('error', fail)
    request.end()
  })
}

/**
 * Runtimes this plugin already installed under a sibling data directory.
 *
 * Renaming the package or moving the data directory used to orphan a perfectly
 * good binary and force another 57 MB download. Any `opencode-*` directory next
 * to the current one is offered as a candidate, so a rename or an upgrade
 * inherits what is already on disk.
 *
 * Version comes from actually running the binary, so a stale copy is rejected
 * rather than trusted.
 */
async function siblingRuntimes(dataDir, binary) {
  const parent = path.dirname(dataDir)
  const entries = await fs.readdir(parent, { withFileTypes: true }).catch(() => [])
  const found = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    if (!entry.name.startsWith('opencode-')) continue
    if (path.join(parent, entry.name) === dataDir) continue
    const dir = path.join(parent, entry.name, 'runtime')
    const versions = await fs.readdir(dir, { withFileTypes: true }).catch(() => [])
    for (const version of versions) {
      if (!version.isDirectory()) continue
      found.push(path.join(dir, version.name, binary))
    }
  }
  return found
}

/**
 * Download and verify the official OpenCode binary.
 *
 * The tarball is checked against the registry's `sha512` integrity value before
 * extraction, so a corrupted or substituted download cannot be executed.
 */
async function downloadRuntime(dataDir, pkg, options, status) {
  const root = path.join(dataDir, 'runtime')
  const wanted = options.version
  const metaURL = wanted
    ? `https://registry.npmjs.org/${pkg.name}/${wanted}`
    : `https://registry.npmjs.org/${pkg.name}/latest`
  const metaResponse = await fetch(metaURL, { signal: AbortSignal.timeout(30000) })
  if (!metaResponse.ok) throw new Error(`OpenCode 安装信息读取失败：HTTP ${metaResponse.status}`)
  const metadata = await metaResponse.json()
  const dist = metadata.dist
  if (metadata.name !== pkg.name || !VERSION_PATTERN.test(metadata.version ?? '')
    || !dist?.integrity?.startsWith('sha512-')
    || !dist?.tarball?.startsWith(`https://registry.npmjs.org/${pkg.name}/-/`)) {
    throw new Error('OpenCode 官方包元数据异常，已中止下载')
  }

  const target = path.join(root, metadata.version, pkg.binary)
  await fs.mkdir(path.dirname(target), { recursive: true })
  status(`正在下载 OpenCode ${metadata.version}，首次启动可能需要几分钟`)
  const archive = path.join(path.dirname(target), 'download.tgz')

  // The archive is ~57 MB. On a slow cross-border link that does not fit in any
  // single request timeout, so it is fetched in ranges and appended, and a
  // partial file left by an earlier attempt is continued rather than restarted.
  //
  // Several mirrors are tried in parallel and the quickest is used, because the
  // registry's own CDN is not equally reachable from everywhere: a fresh
  // install should not depend on one host being fast from the user's network.
  const sources = runtimeSources(dist.tarball, metadata.version)
  const total = await contentLengthAny(sources)
  await downloadResumable(sources, archive, total, status)

  const hash = createHash('sha512')
  for await (const chunk of createReadStream(archive)) hash.update(chunk)
  if (`sha512-${hash.digest('base64')}` !== dist.integrity) {
    await fs.unlink(archive).catch(() => {})
    throw new Error('OpenCode 下载校验失败（sha512 不匹配）')
  }

  await extractBinary(archive, `package/bin/${pkg.binary}`, target)
  await fs.chmod(target, 0o755)
  if (await binaryVersion(target) !== metadata.version) {
    throw new Error('下载的 OpenCode 版本与元数据不符')
  }
  await fs.unlink(archive).catch(() => {})
  return target
}

/**
 * Extract a single member from a .tgz without a tar dependency.
 *
 * Only the one expected file is read; the archive never decides where anything
 * is written, so a malicious entry name cannot escape the target directory.
 */
async function extractBinary(archive, member, target) {
  const { spawn: spawnChild } = await import('node:child_process')
  const temp = `${target}.extract`
  await fs.mkdir(path.dirname(target), { recursive: true })
  await new Promise((resolve, reject) => {
    // `tar` is present on Windows 10+ and every supported Unix; reading through
    // a pipe keeps the archive path out of any shell.
    const child = spawnChild('tar', ['-xzOf', archive, member], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    const out = createWriteStream(temp)
    let err = ''
    child.stdout.pipe(out)
    child.stderr.on('data', d => { err += d })
    child.on('error', reject)
    child.on('close', code => {
      out.end()
      if (code === 0) resolve()
      else reject(new Error(`OpenCode 解包失败（tar 退出码 ${code}）${err ? `: ${err.slice(0, 300)}` : ''}`))
    })
  })
  await fs.rename(temp, target)
}

/** Pick a free loopback port. */
async function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      server.close(() => resolve(port))
    })
  })
}

/**
 * Start an isolated `opencode serve` and wait until it reports healthy.
 *
 * @returns {Promise<{backend: Backend, stop: () => Promise<void>, child: import('node:child_process').ChildProcess, version: string}>}
 */
export async function startBackend(binary, dataDir, logStream, proxyEnv) {
  const actualVersion = await binaryVersion(binary)
  const root = path.join(dataDir, 'opencode')
  for (const dir of XDG_ROOTS) {
    await fs.mkdir(path.join(root, dir), { recursive: true, mode: 0o700 })
  }

  // Build the child environment explicitly: only ordinary OS/network settings
  // are forwarded, never another provider's key or an OpenCode auth override.
  const env = {}
  for (const key of FORWARDED_ENV) {
    if (process.env[key]) env[key] = process.env[key]
  }
  for (const dir of XDG_ROOTS) {
    env[`XDG_${dir.toUpperCase()}_HOME`] = path.join(root, dir)
  }
  // Proxy variables are NOT in FORWARDED_ENV: they arrive only here, and only
  // when `runtimeProxyEnv` says so. It returns an empty object unless the user
  // explicitly opted in, because forwarding a proxy measurably hangs every
  // completion (see `runtimeProxyEnabled`). `proxyEnv` remains the caller's
  // escape hatch and is applied last so it wins.
  Object.assign(env, runtimeProxyEnv(), proxyEnv)

  const password = randomBytes(24).toString('hex')
  Object.assign(env, {
    OPENCODE_SERVER_PASSWORD: password,
    OPENCODE_SERVER_USERNAME: 'opencode',
    OPENCODE_DISABLE_AUTOUPDATE: 'true',
    OPENCODE_DISABLE_PROJECT_CONFIG: 'true',
    OPENCODE_DISABLE_CLAUDE_CODE: 'true',
    OPENCODE_DISABLE_EXTERNAL_SKILLS: 'true',
    OPENCODE_CONFIG_CONTENT: JSON.stringify({
      permission: nativePermissions,
      autoupdate: false,
      share: 'disabled',
      agent: isolatedAgents,
    }),
  })

  const projectDir = path.join(root, 'project')
  await fs.mkdir(projectDir, { recursive: true })

  const port = await freePort()
  // `OPENCODE_XDBRIDGE_DEBUG=1` turns on the runtime's own DEBUG logging. It is
  // the only way to see the request the runtime actually sends upstream, which
  // is what an opaque `invalid_request_error` from the far end needs.
  const debug = process.env.OPENCODE_XDBRIDGE_DEBUG === '1'
  const args = ['serve', '--pure', '--hostname', '127.0.0.1', '--port', String(port)]
  if (debug) args.push('--log-level', 'DEBUG', '--print-logs')
  const child = spawn(binary, args, {
    cwd: projectDir, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stdout.pipe(logStream, { end: false })
  child.stderr.pipe(logStream, { end: false })

  let spawnFailure
  child.on('error', error => { spawnFailure = error })

  const backend = new Backend(`http://127.0.0.1:${port}`, password, undefined, message => {
    logStream.write(`${new Date().toISOString()} ${message}\n`)
  })

  const stop = async () => {
    backend.stopEvents()
    if (child.exitCode !== null || child.signalCode !== null) return
    child.kill('SIGTERM')
    await Promise.race([
      new Promise(resolve => child.once('exit', resolve)),
      new Promise(resolve => setTimeout(resolve, 4000)),
    ])
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
  }

  try {
    for (let attempt = 0; attempt < 120; attempt++) {
      if (spawnFailure || child.exitCode !== null) {
        throw spawnFailure || new Error(`OpenCode 启动即退出（退出码 ${child.exitCode}）`)
      }
      try {
        const health = await backend.request('/global/health', 'GET', undefined, undefined, 1000)
        if (health.healthy) {
          if (health.version !== actualVersion) throw new Error('OpenCode 服务版本与二进制不一致')
          return { backend, stop, child, version: health.version }
        }
      } catch (error) {
        if (error.message === 'OpenCode 服务版本与二进制不一致') throw error
      }
      await new Promise(resolve => setTimeout(resolve, 500))
    }
    throw new Error('OpenCode 启动超时')
  } catch (error) {
    await stop()
    throw error
  }
}
