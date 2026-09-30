/**
 * Regression tests for reasoning-effort handling.
 *
 * Two real defects this locks down:
 *
 * 1. The Harness's level enum is `off`/`minimal`/`low`/`medium`/`high`/`xhigh`/`max`.
 *    The plugin compared against `none`, so `off` was unrecognised and EVERY
 *    request carrying it — including the plain default the user gets without
 *    choosing anything — came back `400 unsupported_reasoning_effort`.
 *
 * 2. A level the model does not expose was rejected outright. That turned a
 *    harmless client habit (sending `minimal`, or `high` to a model with no
 *    levels) into a request that could not succeed at all. An unusable level
 *    should fall back to the model's own default, not fail the request.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { prepare } from '../lib/protocol.js'
import { EFFORT_LEVELS, reasoningEfforts } from '../lib/reasoning.js'

/** A model that exposes real levels. */
const withLevels = {
  id: 'opencode/space-bunny-free', name: 'Space Bunny', reasoning: true, toolcall: true,
  variants: {
    low: { reasoningEffort: 'low' }, medium: { reasoningEffort: 'medium' },
    high: { reasoningEffort: 'high' }, xhigh: { reasoningEffort: 'xhigh' },
    max: { reasoningEffort: 'max' },
  },
}

/** A reasoning model that exposes no levels at all. */
const withoutLevels = {
  id: 'opencode/big-pickle', name: 'Big Pickle', reasoning: true, toolcall: true, variants: {},
}

/** A model with no reasoning support. */
const noReasoning = {
  id: 'opencode/plain', name: 'Plain', reasoning: false, toolcall: true, variants: {},
}

const bodyFor = (model, effort) => ({
  model: model.id,
  messages: [{ role: 'user', content: 'hi' }],
  max_tokens: 8,
  ...(effort === undefined ? {} : { reasoning_effort: effort }),
})

/** The whole set the Harness can send. */
const HARNESS_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']

test('the plugin knows the level the Harness actually sends for "off"', () => {
  // It was `none`; the wire value is `off`.
  assert.ok(EFFORT_LEVELS.includes('off'), `EFFORT_LEVELS must include "off": ${JSON.stringify(EFFORT_LEVELS)}`)
})

test('every level the Harness can send is accepted, whatever the model exposes', () => {
  for (const model of [withLevels, withoutLevels]) {
    for (const effort of HARNESS_LEVELS) {
      assert.doesNotThrow(
        () => prepare(bodyFor(model, effort), [model]),
        `${model.name} rejected reasoning_effort="${effort}"`,
      )
    }
  }
})

test('"off" means no reasoning variant, not a failed request', () => {
  const request = prepare(bodyFor(withLevels, 'off'), [withLevels])
  assert.equal(request.variant, undefined, 'off must not select a variant')
})

test('a level the model exposes is forwarded to the runtime', () => {
  for (const level of ['low', 'high', 'max']) {
    const request = prepare(bodyFor(withLevels, level), [withLevels])
    assert.equal(request.variant, level)
  }
})

test('a level the model does not expose falls back instead of failing', () => {
  // space-bunny has no `minimal`; the request must still succeed.
  const request = prepare(bodyFor(withLevels, 'minimal'), [withLevels])
  assert.notEqual(request.variant, 'minimal')
  // Falling back means the runtime picks its own default, so nothing is sent.
  assert.equal(request.variant, undefined)
})

test('a model with no levels accepts any level and sends none', () => {
  for (const level of HARNESS_LEVELS) {
    const request = prepare(bodyFor(withoutLevels, level), [withoutLevels])
    assert.equal(request.variant, undefined, `${level} must not become a variant`)
  }
})

test('a model with no reasoning support ignores the level rather than failing', () => {
  for (const level of HARNESS_LEVELS) {
    assert.doesNotThrow(() => prepare(bodyFor(noReasoning, level), [noReasoning]))
  }
})

test('no effort at all is still fine', () => {
  assert.doesNotThrow(() => prepare(bodyFor(withLevels, undefined), [withLevels]))
  assert.doesNotThrow(() => prepare(bodyFor(withoutLevels, undefined), [withoutLevels]))
})

test('reasoningEfforts exposes exactly the levels the runtime advertises', () => {
  assert.deepEqual(reasoningEfforts(withLevels), {
    low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', max: 'max',
  })
  assert.deepEqual(reasoningEfforts(withoutLevels), {})
  assert.deepEqual(reasoningEfforts(noReasoning), {})
})

test('a non-string effort is ignored rather than crashing', () => {
  for (const weird of [null, 0, {}, []]) {
    assert.doesNotThrow(() => prepare(bodyFor(withLevels, weird), [withLevels]))
  }
})
