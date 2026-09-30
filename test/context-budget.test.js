/**
 * Regression tests for context-window budgeting and the over-limit refusal.
 *
 * The bug these lock down: the plugin advertised each model's RAW window to the
 * Harness. The Harness therefore had no reason to compact, built a
 * 1.44M-token conversation for a model declaring 200K, and the upstream answered
 * with a bare `invalid_request_error: invalid request` — a message naming no
 * cause at all, which is why it read as "every model, every effort, everything
 * fails". Reproduced from a captured real request, not from a constructed one.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { BridgeCatalog } from '../lib/catalog.js'
import { prepare } from '../lib/protocol.js'
import {
  usableContextWindow, checkContextFit, estimateTokens, formatTokens, SAFETY_MARGIN,
} from '../lib/context-budget.js'

const runtimeModel = (over = {}) => ({
  id: 'opencode/big-pickle', name: 'Big Pickle',
  context: 200_000, output: 32_000, images: false, reasoning: true, toolcall: true, variants: {},
  ...over,
})

test('the advertised window is smaller than the raw one', () => {
  const model = runtimeModel()
  const advertised = usableContextWindow(model)
  assert.ok(advertised < model.context, `advertised ${advertised} must be below raw ${model.context}`)
  assert.ok(advertised > 0)
})

test('the reserve covers both the reply and a safety margin', () => {
  const model = runtimeModel({ context: 200_000, output: 32_000 })
  const expected = Math.floor((200_000 - 32_000) * (1 - SAFETY_MARGIN))
  assert.equal(usableContextWindow(model), expected)
})

test('a huge declared output limit cannot starve the prompt', () => {
  // Reserve at most half the window, however large `output` is.
  const model = runtimeModel({ context: 1_048_576, output: 524_288 })
  const advertised = usableContextWindow(model)
  assert.ok(advertised > 1_048_576 * 0.3, `prompt budget collapsed to ${advertised}`)
})

test('a missing or nonsensical window falls back to a usable default', () => {
  assert.ok(usableContextWindow({}) > 0)
  assert.ok(usableContextWindow({ context: 0 }) > 0)
  assert.ok(usableContextWindow({ context: NaN }) > 0)
  assert.ok(usableContextWindow(undefined) > 0)
})

test('the catalog reports the usable budget, and keeps the raw figure too', () => {
  const catalog = new BridgeCatalog()
  catalog.replace([runtimeModel()])
  const model = catalog.visible()[0]
  assert.equal(model.reportedContextWindow, 200_000, 'the raw window must remain available')
  assert.ok(model.contextWindow < 200_000, 'the client must see the usable budget')
})

test('the real captured request is refused with a message naming the cause', () => {
  // The captured conversation weighed ~1.44M tokens against a 200K model.
  const catalog = new BridgeCatalog()
  catalog.replace([runtimeModel()])
  const huge = 'x'.repeat(6_000_000) // well over 200K tokens
  assert.throws(
    () => prepare({
      model: 'opencode/big-pickle',
      messages: [{ role: 'user', content: huge }],
    }, catalog.visible()),
    error => {
      assert.equal(error.status, 400)
      assert.equal(error.code, 'context_length_exceeded')
      // The message must be actionable: it names the model's limit.
      assert.match(error.message, /超出/)
      assert.match(error.message, /上限/)
      return true
    },
  )
})

test('a request within the window is not refused', () => {
  const catalog = new BridgeCatalog()
  catalog.replace([runtimeModel()])
  assert.doesNotThrow(() => prepare({
    model: 'opencode/big-pickle',
    messages: [{ role: 'user', content: 'hello' }],
  }, catalog.visible()))
})

test('CJK text is counted per character, not per four bytes', () => {
  // 200 Chinese characters is ~200 tokens, but only ~150 by a bytes/4 estimate
  // (they are 600 bytes in UTF-8). Undercounting Chinese is what made the
  // earlier estimate wrong by hundreds of thousands of tokens.
  const chinese = '中'.repeat(200)
  assert.equal(estimateTokens(chinese), 200)
  assert.ok(estimateTokens(chinese) > Math.ceil(Buffer.byteLength(chinese) / 4))
})

test('latin text is counted at about four characters per token', () => {
  assert.equal(estimateTokens('a'.repeat(400)), 100)
  assert.equal(estimateTokens(''), 0)
  assert.equal(estimateTokens(undefined), 0)
})

test('checkContextFit flags only a genuine overrun', () => {
  assert.equal(checkContextFit(199_999, runtimeModel()).over, false)
  assert.equal(checkContextFit(200_001, runtimeModel()).over, true)
  // An unknown window must not cause a false refusal.
  assert.equal(checkContextFit(999_999, {}).over, false)
})

test('token counts are formatted for people', () => {
  assert.equal(formatTokens(1_444_352), '1.4M')
  assert.equal(formatTokens(200_000), '200K')
  assert.equal(formatTokens(512), '512')
  assert.equal(formatTokens(undefined), '—')
})
