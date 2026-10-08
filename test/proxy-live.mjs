/**
 * Does the isolated runtime actually reach the upstream, with and without a proxy?
 *
 * The unit tests prove the environment object is built correctly; this proves a
 * real `opencode serve` child is usable end to end. Two scenarios matter:
 *   - with the host proxy: the child must inherit it, or nothing is reachable
 *   - with no proxy at all: the child must still start and talk over loopback
 *
 * A real completion is the only proof the upstream is reachable, and it must go
 * through `prepare()` first: `backend.complete` consumes a prepared request, not
 * a raw OpenAI body, so bypassing `prepare` would test nothing about the wire.
 *
 * Usage: node test/proxy-live.mjs [dataDir] [--no-proxy]
 */

import fs from 'node:fs'
import path from 'node:path'
import { findRuntime, startBackend, describeProxy, runtimeProxyEnv } from '../lib/runtime.js'
import { prepare } from '../lib/protocol.js'

const args = process.argv.slice(2)
const noProxy = args.includes('--no-proxy')
const dataDir = args.find(a => !a.startsWith('--')) ?? 'D:\\deep seek harness\\dsh-home\\opencode-xdbridge'

if (noProxy) {
  // Strip every proxy variable so the "direct" path is genuinely exercised.
  for (const key of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY',
    'http_proxy', 'https_proxy', 'all_proxy', 'no_proxy']) {
    delete process.env[key]
  }
}

console.log(noProxy ? '########## 场景：无代理（直连）##########' : '########## 场景：继承宿主代理 ##########')
console.log('=== 宿主进程看到的代理 ===')
console.log('  describeProxy():', JSON.stringify(describeProxy()))
console.log('  runtimeProxyEnv():', JSON.stringify(runtimeProxyEnv()))

const binary = await findRuntime(dataDir, text => console.log('  [findRuntime]', text))
console.log('\n二进制:', binary)

const logStream = fs.createWriteStream(path.join(dataDir, 'proxy-probe.log'), { flags: 'a' })
const started = Date.now()
const rt = await startBackend(binary, dataDir, logStream)
console.log(`启动耗时: ${Date.now() - started}ms  版本: ${rt.version}`)

console.log('\n=== 运行时可用性 ===')
let models = []
try {
  models = await rt.backend.models()
  console.log(`  ✅ 返回 ${models.length} 个免费模型`)
  for (const m of models.slice(0, 5)) console.log('     -', m.id)
  const added = models.filter(m => !/big-pickle|ling-3\.0|longcat|mimo-v2\.6|muse-spark|nemotron-3-ultra|nemotron-3\.5|space-bunny/.test(m.id))
  if (added.length) console.log('     ⚠ 上游新增:', added.map(m => m.id).join(', '))
} catch (error) {
  console.log('  ❌ 读取模型失败:', error.message)
}

// A real completion is the only proof the upstream is reachable end to end.
console.log('\n=== 真实请求（证明能到上游）===')
const target = models.find(m => /space-bunny/.test(m.id)) ?? models[0]
if (!target) {
  console.log('  ⚠ 没有可用模型，跳过请求测试')
} else {
  try {
    const startedAt = Date.now()
    const request = prepare({
      model: target.id,
      messages: [{ role: 'user', content: 'Reply with exactly: PROXY_OK' }],
      stream: false,
      max_completion_tokens: 64,
    }, models)
    const response = await rt.backend.complete(request, AbortSignal.timeout(180000), { probe: false })
    console.log(`  ✅ 收到回复 (${Date.now() - startedAt}ms) 模型=${target.id}`)
    console.log('     ', JSON.stringify(response?.choices?.[0]?.message ?? response).slice(0, 300))
  } catch (error) {
    console.log(`  ❌ 请求失败: ${error.status} ${String(error.message).slice(0, 300)}`)
  }
}

await rt.stop()
logStream.end()
