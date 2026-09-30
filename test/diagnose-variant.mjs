/**
 * Send a real request with each variant to find which ones the upstream accepts.
 *
 * The settings page lists low/medium/high/xhigh/max for space-bunny, yet the
 * user reports every one of them failing. Guessing at the mapping is not
 * enough: this drives the actual request path and records the upstream's reply
 * for each variant, so the failing set is measured rather than inferred.
 */

import fs from 'node:fs'
import { findRuntime, startBackend } from '../lib/runtime.js'
import { prepare } from '../lib/protocol.js'
import { reasoningEfforts } from '../lib/reasoning.js'

const dataDir = 'D:\\deep seek harness\\dsh-home\\opencode-xdbridge'
const log = fs.createWriteStream(`${dataDir}\\variant.log`, { flags: 'a' })
const rt = await startBackend(await findRuntime(dataDir, () => {}), dataDir, log)
const models = await rt.backend.models()

const model = models.find(m => m.id.includes(process.argv[2] ?? 'space-bunny'))
if (!model) { console.log('model not found'); process.exit(1) }

console.log('model    :', model.id)
console.log('reasoning:', model.reasoning)
console.log('variants :', JSON.stringify(model.variants))
console.log('exposed  :', JSON.stringify(reasoningEfforts(model)))
console.log('')

/** Drive one real completion at the given effort; report what came back. */
async function attempt(effort) {
  const body = { model: model.id, messages: [{ role: 'user', content: 'Say OK.' }], max_tokens: 24 }
  if (effort !== undefined) body.reasoning_effort = effort
  const started = Date.now()
  try {
    const request = prepare(body, [model])
    console.log(`  variant sent -> ${JSON.stringify(request.variant)}`)
    await rt.backend.complete(request, AbortSignal.timeout(120000), { probe: true })
    return `OK (${Date.now() - started}ms)`
  } catch (error) {
    const text = String(error?.message ?? error)
    return `${error?.status ?? error?.code ?? '?'} ${text.slice(0, 150)}`
  }
}

for (const effort of [undefined, 'low', 'medium', 'high', 'xhigh', 'max']) {
  console.log(`\n--- reasoning_effort = ${effort ?? '(not sent)'} ---`)
  console.log('  result:', await attempt(effort))
}

await rt.stop()
log.end()
