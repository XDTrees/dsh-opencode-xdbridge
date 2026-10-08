/**
 * The proxy must reach the runtime only through the opt-in switch.
 *
 * Guards the one structural mistake that reintroduced the hang: listing `*_PROXY`
 * in `FORWARDED_ENV`, which is applied unconditionally and would silently bypass
 * `runtimeProxyEnabled`.
 */

import fs from 'node:fs'

const src = fs.readFileSync(new URL('../lib/runtime.js', import.meta.url), 'utf8')
let bad = 0

const check = (ok, label) => {
  if (!ok) bad += 1
  console.log(`  ${ok ? '[ok]  ' : '[MISS]'} ${label}`)
}

// The forwarded list must not resurrect the proxy.
const list = /const FORWARDED_ENV = \[([\s\S]*?)\]/.exec(src)[1]
for (const key of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY',
  'http_proxy', 'https_proxy', 'all_proxy', 'no_proxy']) {
  check(!list.includes(`'${key}'`), `FORWARDED_ENV 不含 ${key}`)
}

check(/export function runtimeProxyEnabled/.test(src), 'runtimeProxyEnabled 已导出')
check(/export function runtimeProxyEnv/.test(src), 'runtimeProxyEnv 已导出')
check(/export function describeProxy/.test(src), 'describeProxy 已导出')
check(/if \(!runtimeProxyEnabled\(\)\) return \{\}/.test(src), 'runtimeProxyEnv 默认返回空')

// Exactly one definition each — a partial edit once left a duplicate describeProxy.
for (const name of ['runtimeProxyEnv', 'describeProxy', 'runtimeProxyEnabled']) {
  const count = (src.match(new RegExp(`export function ${name}\\b`, 'g')) ?? []).length
  check(count === 1, `${name} 只有一个定义（实际 ${count}）`)
}

// The switch must be read by name, not by an inverted or arbitrary variable.
check(/OPENCODE_XDBRIDGE_RUNTIME_PROXY === '1'/.test(src), "开关读 OPENCODE_XDBRIDGE_RUNTIME_PROXY === '1'")

console.log(bad === 0 ? '\nPROXY DEFAULT CHECK OK' : '\nPROXY DEFAULT CHECK FAILED')
process.exit(bad === 0 ? 0 : 1)
