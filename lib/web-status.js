/**
 * Same-origin HTTP routes backing the OpenCode XD Bridge settings card.
 *
 * These answer loopback browser requests only and never carry the runtime's
 * server secret. Reads are GET; every action is an explicit POST.
 *
 * Mounted on the Host's `webServer` through `ctx.inject(['webServer'], …)` so
 * startup order cannot make the registration disappear. `webServer` is an
 * optional service: a headless profile simply never mounts these routes and the
 * provider keeps serving models regardless.
 *
 * @module dsh-opencode-xdbridge/web-status
 */

import {
  BRIDGE_MODEL_PATH,
  BRIDGE_PROBE_PATH,
  BRIDGE_REFRESH_PATH,
  BRIDGE_RESTART_PATH,
  BRIDGE_STATUS_PATH,
} from './status-paths.js'

/** Cap on the request body this plugin will parse. */
const BODY_LIMIT = 64 * 1024

function json(res, status, body) {
  const text = JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(text),
    'Cache-Control': 'no-store',
  })
  res.end(text)
}

/** One-line message safe to return to the browser. */
function safeMessage(error) {
  const text = error instanceof Error ? error.message : String(error)
  return text.length > 500 ? `${text.slice(0, 500)}…` : text
}

/**
 * Whether the request came from the local DSH UI.
 *
 * A browser sends `Origin` on cross-origin and same-origin POSTs; when present
 * it must name loopback. Requests without an Origin (curl, the host itself) are
 * allowed, which is what keeps the CLI usable.
 */
function loopbackOrigin(req) {
  const origin = req.headers.origin
  if (origin === undefined || origin === '') return true
  try {
    const { hostname } = new URL(origin)
    return hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '::1' || hostname === '[::1]'
  } catch {
    return false
  }
}

/** Read and parse a bounded JSON body. */
async function readJson(req) {
  const chunks = []
  let bytes = 0
  for await (const chunk of req) {
    bytes += chunk.length
    if (bytes > BODY_LIMIT) throw new Error('请求体过大')
    chunks.push(chunk)
  }
  if (bytes === 0) return {}
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) }
  catch { throw new Error('请求体不是合法 JSON') }
}

/**
 * Mount every route this plugin owns.
 *
 * @param {import('@deepseek-ai/cordis').Context} ctx a context where `webServer` is present
 * @param {object} deps the live plugin state
 * @param {() => object} deps.status current status document
 * @param {(modelId?: string) => Promise<object>} deps.refresh re-read the roster
 * @param {(modelId?: string) => Promise<object>} deps.probe run a detection sweep
 * @param {() => Promise<object>} deps.restart restart the managed runtime
 * @param {(modelId: string) => object|undefined} deps.model one model's detail
 */
export function registerBridgeStatusRoute(ctx, deps) {
  ctx.effect(() => {
    const disposers = []

    /** Wrap a handler with the shared guards. */
    const route = (path, method, handler) => {
      disposers.push(ctx.webServer.register({
        kind: 'exact',
        path,
        handler: async (req, res) => {
          if (req.method !== method) return json(res, 405, { error: 'method not allowed' })
          if (!loopbackOrigin(req)) return json(res, 403, { error: 'origin-not-trusted' })
          try {
            await handler(req, res)
          } catch (error) {
            json(res, 500, { error: safeMessage(error) })
          }
        },
      }))
    }

    route(BRIDGE_STATUS_PATH, 'GET', async (req, res) => {
      json(res, 200, deps.status())
    })

    // Re-read the free-model roster. Separate from the probe: this only asks the
    // runtime what it offers, and is the way back from a failed startup read.
    route(BRIDGE_REFRESH_PATH, 'POST', async (req, res) => {
      const body = await readJson(req)
      const result = await deps.refresh(typeof body.model === 'string' ? body.model : undefined)
      json(res, 200, { ok: true, ...result })
    })

    // Run a real detection sweep. Takes tens of seconds per model, so it runs
    // in the background and the card polls the status document for progress.
    route(BRIDGE_PROBE_PATH, 'POST', async (req, res) => {
      const body = await readJson(req)
      const result = await deps.probe(typeof body.model === 'string' ? body.model : undefined)
      json(res, 200, { ok: true, ...result })
    })

    route(BRIDGE_RESTART_PATH, 'POST', async (req, res) => {
      const result = await deps.restart()
      json(res, 200, { ok: true, ...result })
    })

    route(BRIDGE_MODEL_PATH, 'GET', async (req, res) => {
      const id = new URL(req.url ?? '/', 'http://localhost').searchParams.get('id')
      if (!id) return json(res, 400, { error: 'missing id' })
      const model = deps.model(id)
      if (model === undefined) return json(res, 404, { error: 'unknown model' })
      json(res, 200, model)
    })

    return () => {
      for (const dispose of disposers) {
        try { dispose() } catch { /* already released */ }
      }
    }
  })
}
