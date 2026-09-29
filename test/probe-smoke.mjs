/**
 * Verify the detection (probe) route end to end.
 *
 * Detection is the page's most valuable action — it is what separates "the
 * model is listed" from "the model actually answers and can call a tool" — so
 * it gets its own check against a real runtime.
 *
 *   OPENCODE_XDBRIDGE_DATA_DIR=... node test/probe-smoke.mjs
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { apply } from '../lib/index.js'

const dataDir = process.env.OPENCODE_XDBRIDGE_DATA_DIR
  || path.join(os.tmpdir(), 'dsh-opencode-xdbridge-probe')

const routes = new Map()
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1')
  const handler = routes.get(url.pathname)
  if (handler === undefined) { res.writeHead(404); res.end('{}'); return }
  void handler(req, res)
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const origin = `http://127.0.0.1:${server.address().port}`

let ready = false
/** Disposers collected from ctx.effect, so the plugin can be shut down cleanly. */
const disposers = []
const ctx = {
  logger: console,
  effect: fn => {
    const dispose = fn()
    const disposer = () => { if (typeof dispose === 'function') return dispose() }
    disposers.push(disposer)
    return disposer
  },
  inject: (services, callback) => { if (services.includes('webServer')) callback(ctx) },
  webServer: { register: ({ path: routePath, handler }) => { routes.set(routePath, handler); return () => routes.delete(routePath) } },
  llm: {
    registerAdapter: () => { ready = true; return () => {} },
    registerConfigurableProviders: () => () => {},
    registerModelDiscovery: () => () => {},
  },
  get: () => undefined,
}

apply(ctx, {})
const deadline = Date.now() + 600_000
while (!ready && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 500))
if (!ready) { console.error('FAILED: provider never registered'); process.exit(1) }

const STATUS = `${origin}/plugins/dsh-opencode-xdbridge/status`
const PROBE = `${origin}/plugins/dsh-opencode-xdbridge/models/probe`

const before = await fetch(STATUS).then(r => r.json())
console.log(`before: ${JSON.stringify(before.metrics)}`)
const target = before.models[0]
console.log(`probing one model: ${target.id}`)

// Probe a single model so the check stays fast.
const started = await fetch(PROBE, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ model: target.id }),
}).then(r => r.json())
console.log(`probe response: ${JSON.stringify(started)}`)

const after = await fetch(STATUS).then(r => r.json())
console.log(`after:  ${JSON.stringify(after.metrics)}`)
const probed = after.models.find(model => model.id === target.id)
console.log(`result: ${JSON.stringify(probed?.lastResult)}`)

const ok = after.metrics.available >= 1
  && probed?.lastResult?.ok === true
  && probed?.lastResult?.source === 'probe'
  && Number.isFinite(probed?.lastResult?.durationMs)
  && after.probe.running === false

// Shut the plugin down before exiting: the managed runtime is a child process,
// and leaving it alive trips Node's own teardown assertion on Windows.
for (const disposer of disposers.reverse()) await Promise.resolve(disposer()).catch(() => {})
server.close()
console.log(ok ? '\nPROBE SMOKE OK' : '\nPROBE SMOKE FAILED')
process.exit(ok ? 0 : 1)
