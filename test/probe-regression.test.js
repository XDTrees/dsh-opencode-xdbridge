/**
 * Regression tests for two detection bugs.
 *
 * 1. Re-probe deadlock. The probe validated its request against
 *    `catalog.visible()`, which hides models already marked unusable. So a
 *    model that failed once could never be probed again: `prepare` rejected it
 *    as `model_not_found`, the failure was re-recorded, and the badge was stuck
 *    on 不可用 forever. Clicking "检测全部" twice made MORE models look broken.
 *
 * 2. Starved retry. Both attempts shared one deadline, so a slow first attempt
 *    left the retry no time. A model that answered with text (a legitimate
 *    "chat only" verdict) got reported as a timeout instead.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { BridgeCatalog } from '../lib/catalog.js'
import { prepare } from '../lib/protocol.js'
import { probeBody, probeModel, PROBE_ATTEMPT_TIMEOUT_MS } from '../lib/probe.js'

/** A catalog with one healthy and one previously-failed model. */
function catalogWithFailure() {
  const catalog = new BridgeCatalog()
  catalog.replace([
    { id: 'opencode/good', name: 'Good', context: 100000, output: 8000, toolcall: true, reasoning: true },
    { id: 'opencode/bad', name: 'Bad', context: 100000, output: 8000, toolcall: true, reasoning: true },
  ])
  catalog.record('opencode/bad', { ok: false, source: 'probe', category: 'timeout', error: '超时' })
  return catalog
}

test('all() always keeps every model, whatever its verdict', () => {
  const catalog = catalogWithFailure()
  assert.equal(catalog.all().length, 2)
})

test('a previously-failed model can still be prepared for a re-probe', () => {
  // This is the regression: validating against `visible()` threw model_not_found.
  const catalog = catalogWithFailure()
  const model = catalog.all().find(m => m.id === 'opencode/bad')
  assert.doesNotThrow(() => prepare(probeBody(model, 'tok'), catalog.all()))
})

test('a blocking failure is what removes a model from the validation list', () => {
  // Guards the fix from the other side: only a blocking verdict hides a model,
  // and even then it stays in `all()` so it can be re-probed.
  const catalog = catalogWithFailure()
  catalog.record('opencode/bad', { ok: false, source: 'probe', category: 'region', error: '地区不可用' })
  const model = catalog.all().find(m => m.id === 'opencode/bad')
  assert.throws(
    () => prepare(probeBody(model, 'tok'), catalog.visible()),
    error => error.code === 'model_not_found',
  )
  assert.doesNotThrow(() => prepare(probeBody(model, 'tok'), catalog.all()))
})

test('a recorded failure is cleared by a later successful probe', () => {
  const catalog = catalogWithFailure()
  catalog.record('opencode/bad', { ok: false, source: 'probe', category: 'region', error: '地区不可用' })
  assert.equal(catalog.visible().length, 1)
  catalog.record('opencode/bad', { ok: true, source: 'probe', durationMs: 10 })
  assert.equal(catalog.visible().length, 2)
})

test('each probe attempt gets its own timeout budget', async () => {
  // Attempt 1 burns most of a budget, then fails retryably. Attempt 2 must
  // still get a full budget rather than inheriting a nearly-expired deadline.
  const attemptTimeouts = []
  let attempt = 0
  await assert.rejects(
    probeModel({
      attempts: 2,
      timeoutMs: 300,
      complete: async (token, signal) => {
        attempt += 1
        attemptTimeouts.push(Date.now())
        if (attempt === 1) {
          // Consume 200ms of the 300ms budget, then fail retryably.
          await new Promise(resolve => setTimeout(resolve, 200))
          const error = new Error('只返回文本')
          error.code = 'no_action'
          throw error
        }
        // The second attempt must not already be aborted.
        assert.equal(signal.aborted, false, 'second attempt inherited an expired deadline')
        const error = new Error('仍然只返回文本')
        error.code = 'no_action'
        throw error
      },
    }),
    error => error.code === 'no_action',
  )
  assert.equal(attemptTimeouts.length, 2, 'expected two attempts')
})

test('a probe attempt that exceeds its budget reports a timeout', async () => {
  await assert.rejects(
    probeModel({
      attempts: 1,
      timeoutMs: 120,
      complete: async (token, signal) => {
        await new Promise((resolve, reject) => {
          const timer = setTimeout(resolve, 5000)
          signal.addEventListener('abort', () => { clearTimeout(timer); reject(Object.assign(new Error('aborted'), { name: 'AbortError' })) })
        })
      },
    }),
    error => error.code === 'timeout',
  )
})

test('the default per-attempt budget is generous enough for a cold model', () => {
  assert.ok(PROBE_ATTEMPT_TIMEOUT_MS >= 60_000, String(PROBE_ATTEMPT_TIMEOUT_MS))
})

test('a country restriction is classified as a region problem, not a generic error', async () => {
  const { classifyFailure } = await import('../lib/catalog.js')
  assert.equal(
    classifyFailure('This model is not available in your country.', 403),
    'region',
  )
  // A plain 403 without that wording stays an access problem.
  assert.equal(classifyFailure('Forbidden', 403), 'access')
})

test('a transient failure keeps the model offered', () => {
  // A timeout says nothing durable about the model, so it must stay in the
  // picker; hiding it would withdraw a working model over one slow minute.
  const catalog = catalogWithFailure() // records a `timeout`
  assert.equal(catalog.visible().length, 2, 'a timed-out model must remain offered')
  assert.equal(catalog.metrics().flaky, 1)
  assert.equal(catalog.metrics().unusable, 0)
})

test('a blocking failure withdraws the model', () => {
  const catalog = catalogWithFailure()
  catalog.record('opencode/bad', { ok: false, source: 'probe', category: 'region', error: '地区不可用' })
  assert.equal(catalog.visible().length, 1, 'a region-blocked model must be withdrawn')
  assert.equal(catalog.metrics().unusable, 1)
  assert.equal(catalog.metrics().flaky, 0)
})

test('a blocked model can still be re-probed and recover', () => {
  // The blocking verdict hides it from the picker but must never make it
  // unprobeable — that was the original deadlock.
  const catalog = catalogWithFailure()
  catalog.record('opencode/bad', { ok: false, source: 'probe', category: 'region', error: '地区不可用' })
  assert.equal(catalog.visible().length, 1)
  const model = catalog.all().find(m => m.id === 'opencode/bad')
  assert.doesNotThrow(() => prepare(probeBody(model, 'tok'), catalog.all()))
  catalog.record('opencode/bad', { ok: true, source: 'probe', durationMs: 12 })
  assert.equal(catalog.visible().length, 2, 'it must come back after a successful probe')
})
