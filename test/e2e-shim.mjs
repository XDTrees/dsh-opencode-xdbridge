/**
 * End-to-end check through the plugin's OWN shim HTTP endpoint.
 *
 * Every earlier failure hid behind the same gap: tests called the backend
 * directly with hand-built models, while production goes
 * `HTTP -> shim -> prepare(catalog.visible()) -> backend`. This test drives the
 * real endpoint, so a mismatch between the catalog shape and what `prepare`
 * expects cannot pass unnoticed again.
 */

import fs from 'node:fs'
import { findRuntime, startBackend } from '../lib/runtime.js'
import { BridgeCatalog } from '../lib/catalog.js'
import { createShim } from '../lib/shim.js'

const dataDir = 'D:\\deep seek harness\\dsh-home\\opencode-xdbridge'
const log = fs.createWriteStream(`${dataDir}\\e2e-shim.log`, { flags: 'a' })
const rt = await startBackend(await findRuntime(dataDir, () => {}), dataDir, log)

const catalog = new BridgeCatalog()
catalog.replace(await rt.backend.models())

// Wire the shim exactly as the plugin does in production.
const shim = await createShim({
  complete: (request, signal, meta) => rt.backend.complete(request, signal, meta),
  getModels: () => catalog.visible(),
  refresh: async () => {},
  logger: { info: () => {}, warn: () => {}, error: () => {} },
})

const base = shim.baseUrl()
const token = shim.token()
console.log('shim endpoint:', base)
console.log('')

/** POST a chat completion and return the parsed outcome. */
async function call(body) {
  const res = await fetch(`${base}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(180000),
  })
  const text = await res.text()
  return { status: res.status, text }
}

const models = catalog.visible()
console.log(`通过真实 shim 端点测试 ${models.length} 个模型（每个都带工具）\n`)

const TOOLS = [{
  type: 'function',
  function: {
    name: 'Read',
    description: 'Read a file.',
    parameters: { type: 'object', properties: { file_path: { type: 'string' } }, required: ['file_path'], additionalProperties: false },
  },
}]

let failures = 0
for (const model of models) {
  const body = {
    model: model.id,
    messages: [{ role: 'user', content: 'Read /tmp/a.txt and report it.' }],
    tools: TOOLS,
    max_tokens: 512,
    reasoning_effort: 'high',
  }
  // A per-model guard: one slow model must not hide the verdict for the rest.
  let status
  let text
  try {
    ;({ status, text } = await call(body))
  } catch (error) {
    status = 0
    text = `本地超时/异常：${String(error?.message ?? error).slice(0, 100)}`
  }
  // 200 is the only success. A non-200 that names an upstream cause (region
  // block, dead endpoint, model produced no envelope) is the upstream's
  // verdict, not a defect here — those are reported distinctly.
  const ok = status === 200
  const upstream = /Endpoint is unavailable|not available in your country|信封/.test(text)
  if (!ok && !upstream) failures += 1
  const label = ok ? '[ok  ]' : (upstream ? '[上游]' : '[FAIL]')
  const detail = ok ? '' : ` -> HTTP ${status} ${text.slice(0, 150)}`
  console.log(`  ${label} ${model.id}${detail}`)
}

console.log('')
console.log(
  failures === 0
    ? 'SHIM END-TO-END OK（无插件侧失败）'
    : `SHIM END-TO-END: ${failures} 个模型因插件问题失败`,
)

await shim.close?.()
await rt.stop()
log.end()
process.exit(failures === 0 ? 0 : 1)
