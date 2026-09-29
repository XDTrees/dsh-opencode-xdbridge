/**
 * End-to-end integration test against a real, isolated OpenCode runtime.
 *
 * This is the test that proves the plugin actually works: it starts the
 * managed runtime, brings up the loopback shim, and drives the OpenAI-compatible
 * endpoint the Harness talks to — including a real tool call.
 *
 * It downloads/uses the official OpenCode binary and makes real upstream calls,
 * so it is opt-in:
 *
 *   OPENCODE_XDBRIDGE_E2E=1 node --test test/integration.test.js
 *
 * @module dsh-opencode-xdbridge/test/integration
 */

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { findRuntime, startBackend } from '../lib/runtime.js'
import { createShim } from '../lib/shim.js'
import { BridgeCatalog } from '../lib/catalog.js'

const enabled = process.env.OPENCODE_XDBRIDGE_E2E === '1'
const dataDir = process.env.OPENCODE_XDBRIDGE_E2E_DIR
  || path.join(os.tmpdir(), 'dsh-opencode-xdbridge-e2e')

let runtime
let shim
let catalog
let logStream
let baseUrl
let token

/** Call the shim the way pi-ai's provider does. */
async function chat(body) {
  const response = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(180_000),
  })
  const text = await response.text()
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0, 400)}`)
  return text
}

before(async () => {
  if (!enabled) return
  fs.mkdirSync(dataDir, { recursive: true })
  logStream = fs.createWriteStream(path.join(dataDir, 'e2e.log'), { flags: 'a' })

  const binary = await findRuntime(dataDir, message => console.log(`[runtime] ${message}`))
  runtime = await startBackend(binary, dataDir, logStream)
  catalog = new BridgeCatalog()
  catalog.replace(await runtime.backend.models())

  shim = await createShim({
    complete: (request, signal, meta) => runtime.backend.complete(request, signal, meta),
    getModels: () => catalog.visible(),
    logger: console,
  })
  baseUrl = shim.baseUrl()
  token = shim.token()
  console.log(`[e2e] shim at ${baseUrl}; ${catalog.visible().length} free models`)
}, { timeout: 600_000 })

after(async () => {
  if (!enabled) return
  await shim?.close().catch(() => {})
  await runtime?.stop().catch(() => {})
  logStream?.end()
})

test('the runtime advertises free models', { skip: !enabled, timeout: 120_000 }, () => {
  const models = catalog.visible()
  assert.ok(models.length > 0, 'expected at least one free model')
  for (const model of models) {
    assert.match(model.id, /^opencode\//)
    assert.ok(model.contextWindow > 0)
  }
  console.log(`[e2e] models: ${models.map(m => m.id).join(', ')}`)
})

test('the shim lists models over its OpenAI-compatible route', { skip: !enabled, timeout: 60_000 }, async () => {
  const response = await fetch(`${baseUrl}/v1/models`, { headers: { Authorization: `Bearer ${token}` } })
  assert.equal(response.status, 200)
  const body = await response.json()
  assert.equal(body.object, 'list')
  assert.ok(body.data.length > 0)
})

test('the shim rejects an unauthenticated request', { skip: !enabled, timeout: 60_000 }, async () => {
  const response = await fetch(`${baseUrl}/v1/models`, { headers: { Authorization: 'Bearer wrong' } })
  assert.equal(response.status, 401)
})

test('a plain chat turn returns text', { skip: !enabled, timeout: 180_000 }, async () => {
  const first = catalog.visible()[0]
  const text = await chat({
    model: first.id,
    messages: [{ role: 'user', content: 'Reply with exactly one word: PONG' }],
  })
  const body = JSON.parse(text)
  assert.equal(body.object, 'chat.completion')
  assert.equal(body.choices[0].message.role, 'assistant')
  assert.ok(typeof body.choices[0].message.content === 'string')
  assert.ok(body.choices[0].message.content.length > 0, 'expected a non-empty reply')
  console.log(`[e2e] ${first.id} replied: ${JSON.stringify(body.choices[0].message.content.slice(0, 120))}`)
})

test('a streaming chat turn emits SSE chunks ending in [DONE]', { skip: !enabled, timeout: 180_000 }, async () => {
  const first = catalog.visible()[0]
  const response = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: first.id,
      stream: true,
      messages: [{ role: 'user', content: 'Say hi in three words.' }],
    }),
    signal: AbortSignal.timeout(180_000),
  })
  assert.equal(response.status, 200)
  assert.match(response.headers.get('content-type'), /text\/event-stream/)

  let text = ''
  // undici yields Uint8Array chunks, whose .toString() would produce a list of
  // byte values rather than text; wrap in Buffer to decode as UTF-8.
  for await (const chunk of response.body) text += Buffer.from(chunk).toString()
  assert.match(text, /data: \[DONE\]/)
  assert.match(text, /chat\.completion\.chunk/)
  console.log(`[e2e] stream length ${text.length} bytes`)
})

test('a tool call comes back as an external tool call', { skip: !enabled, timeout: 180_000 }, async () => {
  const first = catalog.visible().find(m => m.supportsTools) ?? catalog.visible()[0]
  const text = await chat({
    model: first.id,
    messages: [{ role: 'user', content: 'List the files under /tmp. You must use the Glob tool.' }],
    tools: [{
      type: 'function',
      function: {
        name: 'Glob',
        description: 'List files matching a pattern',
        parameters: { type: 'object', properties: { pattern: { type: 'string' } }, required: ['pattern'] },
      },
    }],
  })
  const body = JSON.parse(text)
  const message = body.choices[0].message
  assert.ok(Array.isArray(message.tool_calls) && message.tool_calls.length > 0,
    `expected a tool call, got: ${JSON.stringify(message).slice(0, 300)}`)
  assert.equal(message.tool_calls[0].function.name, 'Glob')
  const args = JSON.parse(message.tool_calls[0].function.arguments)
  assert.ok(typeof args.pattern === 'string')
  console.log(`[e2e] tool call: ${message.tool_calls[0].function.name} ${message.tool_calls[0].function.arguments}`)
})

test('an unknown model is refused', { skip: !enabled, timeout: 60_000 }, async () => {
  const response = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'does-not-exist', messages: [{ role: 'user', content: 'hi' }] }),
    signal: AbortSignal.timeout(60_000),
  })
  assert.equal(response.status, 400)
})
