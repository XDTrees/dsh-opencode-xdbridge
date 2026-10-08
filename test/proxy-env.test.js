/**
 * The isolated runtime must NOT inherit the host proxy by default.
 *
 * This is a regression test for a real measured breakage (2026-10-08). Forwarding
 * the host proxy into the runtime made every completion hang: a plain big-pickle
 * request never returned within 90 s and the runtime's own HTTP layer answered
 * 500 `UnknownError` from `SessionPrompt.createUserMessage`. The identical call
 * with no proxy completed in 3.8 s, and direct egress was fine the whole time
 * (`https://opencode.ai/zen/v1/models` -> HTTP 200 in 694 ms).
 *
 * So the proxy has to be opt-in, never automatic. The downloader keeps using it —
 * a 57 MB cross-border transfer really does go from ~90 KB/s to >1 MB/s — but the
 * runtime's many small requests plus heavy loopback use only suffer from it.
 *
 * These assertions exercise the pure helpers. They are cheap and they pin the
 * default, which is the part that silently regressed.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { runtimeProxyEnv, runtimeProxyEnabled, describeProxy } from '../lib/runtime.js'

const PROXY_KEYS = ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY',
  'http_proxy', 'https_proxy', 'all_proxy', 'no_proxy',
  'OPENCODE_XDBRIDGE_RUNTIME_PROXY']

/** Run `fn` with a scrubbed proxy environment, then restore exactly what was there. */
function withEnv(values, fn) {
  const saved = new Map(PROXY_KEYS.map(key => [key, process.env[key]]))
  for (const key of PROXY_KEYS) delete process.env[key]
  Object.assign(process.env, values)
  try {
    return fn()
  } finally {
    for (const key of PROXY_KEYS) {
      const value = saved.get(key)
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
}

test('proxy is off by default even when the host has one configured', () => {
  // The whole point: a configured host proxy must not leak into the runtime.
  withEnv({ HTTPS_PROXY: 'http://127.0.0.1:7897', HTTP_PROXY: 'http://127.0.0.1:7897' }, () => {
    assert.equal(runtimeProxyEnabled(), false)
    assert.deepEqual(runtimeProxyEnv(), {})
    assert.equal(describeProxy().configured, false)
  })
})

test('the default reports a direct connection', () => {
  withEnv({ HTTPS_PROXY: 'http://127.0.0.1:7897' }, () => {
    const described = describeProxy()
    assert.equal(described.enabled, false)
    assert.match(described.summary, /直连/)
  })
})

test('proxy is used only when explicitly enabled', () => {
  withEnv({
    OPENCODE_XDBRIDGE_RUNTIME_PROXY: '1',
    HTTPS_PROXY: 'http://127.0.0.1:7897',
  }, () => {
    assert.equal(runtimeProxyEnabled(), true)
    const env = runtimeProxyEnv()
    assert.equal(env.HTTPS_PROXY, 'http://127.0.0.1:7897')
  })
})

test('enabling it without a configured proxy stays direct', () => {
  withEnv({ OPENCODE_XDBRIDGE_RUNTIME_PROXY: '1' }, () => {
    assert.equal(runtimeProxyEnabled(), true)
    assert.deepEqual(runtimeProxyEnv(), {})
    assert.equal(describeProxy().configured, false)
  })
})

test('a flag value other than "1" does not enable it', () => {
  withEnv({ OPENCODE_XDBRIDGE_RUNTIME_PROXY: 'true', HTTPS_PROXY: 'http://127.0.0.1:7897' }, () => {
    assert.equal(runtimeProxyEnabled(), false)
    assert.deepEqual(runtimeProxyEnv(), {})
  })
})

test('loopback is always excluded when the proxy is on', () => {
  // Routing the runtime's own HTTP calls through a proxy deadlocks it, so this
  // bypass is load-bearing rather than a convenience.
  withEnv({
    OPENCODE_XDBRIDGE_RUNTIME_PROXY: '1',
    HTTPS_PROXY: 'http://127.0.0.1:7897',
    NO_PROXY: 'example.com',
  }, () => {
    const env = runtimeProxyEnv()
    assert.match(env.NO_PROXY, /127\.0\.0\.1/)
    assert.match(env.NO_PROXY, /localhost/)
    // The host's suffix entries are dropped, not merged: the runtime does not
    // read them the way Node does.
    assert.ok(!env.NO_PROXY.includes('example.com'))
  })
})

test('lower-case proxy variables are honoured when enabled', () => {
  withEnv({
    OPENCODE_XDBRIDGE_RUNTIME_PROXY: '1',
    https_proxy: 'http://127.0.0.1:7897',
  }, () => {
    const env = runtimeProxyEnv()
    assert.equal(env.https_proxy, 'http://127.0.0.1:7897')
  })
})

test('describeProxy reports the host without credentials', () => {
  withEnv({
    OPENCODE_XDBRIDGE_RUNTIME_PROXY: '1',
    HTTPS_PROXY: 'http://user:secret@127.0.0.1:7897',
  }, () => {
    const described = describeProxy()
    assert.equal(described.configured, true)
    assert.equal(described.host, '127.0.0.1:7897')
    assert.ok(!described.summary.includes('secret'), '凭据不应出现在状态页面上')
  })
})

test('describeProxy survives an unparseable proxy value', () => {
  withEnv({ OPENCODE_XDBRIDGE_RUNTIME_PROXY: '1', HTTPS_PROXY: 'not a url' }, () => {
    assert.equal(describeProxy().configured, false)
  })
})
