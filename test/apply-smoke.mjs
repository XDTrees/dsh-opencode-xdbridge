/**
 * Verify `apply()` wires the provider AND the settings-page routes against a
 * stub context.
 *
 * This exercises the real host entry — runtime download, shim, provider
 * registration, and the `webServer` route table — then calls those routes over
 * HTTP the way the browser page does.
 *
 *   node test/apply-smoke.mjs
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { apply, name, inject, BRIDGE_PROVIDER, BRIDGE_DISPLAY_NAME, BRIDGE_SETTINGS_NS } from '../lib/index.js'

const dataDir = process.env.OPENCODE_XDBRIDGE_DATA_DIR
  || path.join(os.tmpdir(), 'dsh-opencode-xdbridge-apply')
fs.rmSync(dataDir, { recursive: true, force: true })

const calls = { adapter: [], directory: [], discovery: [], routes: [] }
let discovered = null

/** A real HTTP server standing in for the host's webServer. */
const routes = new Map()
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1')
  const handler = routes.get(url.pathname)
  if (handler === undefined) { res.writeHead(404); res.end('{}'); return }
  void handler(req, res)
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const origin = `http://127.0.0.1:${server.address().port}`

const ctx = {
  logger: console,
  effect: (fn) => { const dispose = fn(); return () => { if (typeof dispose === 'function') dispose() } },
  // `webServer` is optional; the plugin reaches it through ctx.inject.
  inject: (services, callback) => {
    if (services.includes('webServer')) callback(ctx)
  },
  webServer: {
    register: ({ path: routePath, handler }) => {
      routes.set(routePath, handler)
      calls.routes.push(routePath)
      return () => routes.delete(routePath)
    },
  },
  llm: {
    registerAdapter: (providers, adapter) => { calls.adapter.push({ providers, adapter }); return () => {} },
    registerConfigurableProviders: entries => { calls.directory.push(entries); return () => {} },
    registerModelDiscovery: (ns, discover) => { calls.discovery.push({ ns }); discovered = discover; return () => {} },
  },
  get: () => undefined,
}

console.log(`plugin name=${name} inject=${JSON.stringify(inject)}`)
apply(ctx, {})
console.log('apply() returned without blocking boot')

const deadline = Date.now() + 600_000
while (calls.adapter.length === 0 && Date.now() < deadline) {
  await new Promise(resolve => setTimeout(resolve, 500))
}
if (calls.adapter.length === 0) { console.error('FAILED: provider never registered'); process.exit(1) }

console.log('\n=== provider registration ===')
console.log(`  providers = ${JSON.stringify(calls.adapter[0].providers)}`)
console.log(`  adapter   = ${calls.adapter[0].adapter?.constructor?.name}`)
console.log(`  directory = ${JSON.stringify(calls.directory[0])}`)

console.log('\n=== webServer routes ===')
for (const route of calls.routes) console.log(`  ${route}`)

console.log('\n=== GET status (as the page does) ===')
const status = await fetch(`${origin}/plugins/dsh-opencode-xdbridge/status`).then(r => r.json())
console.log(`  phase=${status.phase} provider=${status.provider}`)
console.log(`  runtimeVersion=${status.runtimeVersion}`)
console.log(`  endpoint=${status.endpoint}`)
console.log(`  metrics=${JSON.stringify(status.metrics)}`)
console.log(`  models=${status.models.length}`)
for (const model of status.models.slice(0, 3)) {
  console.log(`    ${model.id.padEnd(40)} ctx=${model.contextWindow} tools=${model.supportsTools} reasoning=${model.supportsReasoning}`)
}

console.log('\n=== POST refresh ===')
const refreshed = await fetch(`${origin}/plugins/dsh-opencode-xdbridge/models/refresh`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
}).then(r => r.json())
console.log(`  ${JSON.stringify(refreshed)}`)

console.log('\n=== GET model detail ===')
const detail = await fetch(`${origin}/plugins/dsh-opencode-xdbridge/model?id=${encodeURIComponent(status.models[0].id)}`).then(r => r.json())
console.log(`  ${detail.id} → ${detail.name}`)

console.log('\n=== model discovery ===')
const models = await discovered({ provider: BRIDGE_PROVIDER })
console.log(`  ${models.length} models for our provider`)
const foreign = await discovered({ provider: 'someone-else' })
console.log(`  ${foreign.length} for a foreign provider (expected 0)`)

console.log('\n=== guards ===')
const badOrigin = await fetch(`${origin}/plugins/dsh-opencode-xdbridge/status`, { headers: { Origin: 'https://evil.example' } })
console.log(`  cross-origin status → HTTP ${badOrigin.status} (expected 403)`)
const wrongMethod = await fetch(`${origin}/plugins/dsh-opencode-xdbridge/status`, { method: 'POST' })
console.log(`  wrong method → HTTP ${wrongMethod.status} (expected 405)`)
const missing = await fetch(`${origin}/plugins/dsh-opencode-xdbridge/model?id=nope`).then(r => r.json())
console.log(`  unknown model → ${JSON.stringify(missing)}`)

const ok = calls.adapter[0].providers[0] === BRIDGE_PROVIDER
  && calls.directory[0][0].displayName === BRIDGE_DISPLAY_NAME
  && calls.discovery[0].ns === BRIDGE_SETTINGS_NS
  && calls.routes.length === 5
  && status.phase === 'ready'
  && status.models.length > 0
  && status.metrics.discovered === status.models.length
  && models.length > 0
  && foreign.length === 0
  && badOrigin.status === 403
  && wrongMethod.status === 405

server.close()
console.log(ok ? '\nAPPLY SMOKE OK' : '\nAPPLY SMOKE FAILED')
process.exit(ok ? 0 : 1)
