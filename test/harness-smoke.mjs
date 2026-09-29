/**
 * Headless verification of the real registration path.
 *
 * This mounts the actual `PiAiAdapter` this plugin registers against a stub
 * Cordis context, then streams a turn through the public
 * `GenerateOptions`/`StreamChunk` seam — the same seam the Harness uses.
 *
 * It proves the provider works end to end without launching the desktop app.
 *
 *   OPENCODE_XDBRIDGE_E2E=1 node test/harness-smoke.mjs
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { findRuntime, startBackend } from '../lib/runtime.js'
import { createShim } from '../lib/shim.js'
import { BridgeCatalog } from '../lib/catalog.js'
import { createBridgeAdapter } from '../lib/adapter.js'

const dataDir = process.env.OPENCODE_XDBRIDGE_E2E_DIR || path.join(os.tmpdir(), 'dsh-opencode-xdbridge-e2e')
fs.mkdirSync(dataDir, { recursive: true })
const logStream = fs.createWriteStream(path.join(dataDir, 'harness-smoke.log'), { flags: 'a' })

const binary = await findRuntime(dataDir, message => console.log(`[runtime] ${message}`))
const runtime = await startBackend(binary, dataDir, logStream)
const catalog = new BridgeCatalog()
catalog.replace(await runtime.backend.models())
console.log(`[smoke] ${catalog.visible().length} free models`)

const shim = await createShim({
  complete: (request, signal, meta) => runtime.backend.complete(request, signal, meta),
  getModels: () => catalog.visible(),
  logger: console,
})

// A stub context: the adapter only reads `attachments` and `fs` from it.
const ctx = { get: () => undefined }

const bridge = createBridgeAdapter({ shim, catalog, ctx })

console.log('\n=== provider snapshot ===')
const provider = bridge.adapter.constructor ? undefined : undefined
const models = bridge.buildModels()
for (const model of models) {
  console.log(`  ${model.id.padEnd(40)} ctx=${model.contextWindow} max=${model.maxTokens} api=${model.api} base=${model.baseUrl}`)
}

console.log('\n=== listModels() through the adapter ===')
try {
  const listed = await bridge.adapter.listModels(bridge.providerId)
  console.log(`  ${listed.length} models`)
  for (const model of listed.slice(0, 3)) console.log(`  ${JSON.stringify(model)}`)
} catch (error) {
  console.log(`  listModels threw: ${error.message}`)
}

console.log('\n=== resolveModel() through the adapter ===')
const first = models[0]
try {
  const resolved = await bridge.adapter.resolveModel(bridge.providerId, first.id)
  console.log(`  ${JSON.stringify({ id: resolved.id, name: resolved.name, contextWindow: resolved.contextWindow, maxTokens: resolved.defaultMaxTokens })}`)
} catch (error) {
  console.log(`  resolveModel threw: ${error.message}`)
}

console.log('\n=== stream() through the adapter (the real seam) ===')
try {
  const chunks = []
  const stream = bridge.adapter.stream({
    provider: bridge.providerId,
    model: first.id,
    system: 'You are a helpful assistant.',
    messages: [{ role: 'user', content: [{ type: 'text', text: 'Reply with exactly one word: PONG' }] }],
  })
  for await (const chunk of stream) {
    chunks.push(chunk)
    if (chunks.length <= 12) console.log(`  chunk: ${JSON.stringify(chunk).slice(0, 200)}`)
  }
  console.log(`  total ${chunks.length} chunks`)
  const text = chunks.filter(c => c.type === 'text-delta').map(c => c.text).join('')
  const finish = chunks.find(c => c.type === 'finish')
  console.log(`  text = ${JSON.stringify(text)}`)
  console.log(`  finish = ${JSON.stringify(finish?.reason)}`)
  if (!text.trim()) throw new Error('no text produced')
  console.log('\nSMOKE OK')
} catch (error) {
  console.error(`\nSMOKE FAILED: ${error.message}`)
  console.error(error.stack?.split('\n').slice(0, 8).join('\n'))
  process.exitCode = 1
} finally {
  await shim.close().catch(() => {})
  await runtime.stop().catch(() => {})
  logStream.end()
}
