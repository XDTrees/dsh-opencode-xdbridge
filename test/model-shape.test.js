/**
 * Regression tests for the protocol/client model-shape mismatch.
 *
 * The shim prepares requests against `catalog.visible()`, but the catalog
 * rebuilds each model into the CLIENT shape — `contextWindow`,
 * `supportsReasoning`, `supportsTools`. The protocol's `prepare` reads the
 * RUNTIME shape: `reasoning`, `variants`, `context`, `output`, `images`,
 * `toolcall`.
 *
 * So on the real request path `model.reasoning` was always `undefined`, which
 * made `reasoningEfforts()` return `{}`, which made every effort lookup miss —
 * for every model. The unit tests never caught it because they built requests
 * from raw runtime objects, which is not what production passes.
 *
 * These tests therefore drive the REAL accessor (`catalog.visible()`), which is
 * the whole point: a test that hand-builds a model cannot see this class of bug.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { BridgeCatalog } from '../lib/catalog.js'
import { prepare } from '../lib/protocol.js'
import { reasoningEfforts } from '../lib/reasoning.js'

/** A runtime model exactly as the OpenCode backend reports it. */
const runtimeModel = {
  id: 'opencode/space-bunny-free',
  name: 'Space Bunny Free',
  context: 1_048_576,
  output: 524_288,
  images: true,
  reasoning: true,
  toolcall: true,
  variants: {
    low: { reasoningEffort: 'low' }, medium: { reasoningEffort: 'medium' },
    high: { reasoningEffort: 'high' }, xhigh: { reasoningEffort: 'xhigh' },
    max: { reasoningEffort: 'max' },
  },
}

/** A model with no variant levels. */
const noVariants = {
  id: 'opencode/big-pickle', name: 'Big Pickle', context: 200_000, output: 32_000,
  images: false, reasoning: true, toolcall: true, variants: {},
}

function catalogOf(...models) {
  const catalog = new BridgeCatalog()
  catalog.replace(models)
  return catalog
}

test('the catalog keeps the fields prepare needs, not just the client ones', () => {
  const catalog = catalogOf(runtimeModel)
  const model = catalog.visible()[0]
  // These are what prepare() reads. If the catalog renames them away, every
  // request silently loses its capability information.
  assert.equal(model.reasoning, true, 'reasoning must survive the catalog')
  assert.equal(model.toolcall, true, 'toolcall must survive the catalog')
  assert.equal(model.context, 1_048_576, 'context must survive the catalog')
  assert.equal(model.output, 524_288, 'output must survive the catalog')
  assert.equal(model.images, true, 'images must survive the catalog')
})

test('effort levels are discoverable on the REAL request path', () => {
  // This is the regression: prepared against catalog.visible(), this returned {}
  // for every model, so no level ever matched.
  const catalog = catalogOf(runtimeModel)
  const efforts = reasoningEfforts(catalog.visible()[0])
  assert.deepEqual(efforts, {
    low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', max: 'max',
  })
})

test('a request built the way production builds it carries the variant', () => {
  const catalog = catalogOf(runtimeModel)
  const request = prepare({
    model: runtimeModel.id,
    messages: [{ role: 'user', content: 'hi' }],
    reasoning_effort: 'high',
  }, catalog.visible())
  assert.equal(request.variant, 'high', 'high must reach the runtime on the real path')
})

test('the model is still found by id on the real path', () => {
  const catalog = catalogOf(runtimeModel)
  assert.ok(catalog.visible().some(m => m.id === runtimeModel.id))
})

test('a model with no levels is still recognised as reasoning-capable', () => {
  const catalog = catalogOf(noVariants)
  const model = catalog.visible()[0]
  assert.equal(model.reasoning, true)
  assert.deepEqual(reasoningEfforts(model), {})
})

test('every level the Harness sends is accepted through the real path', () => {
  const catalog = catalogOf(runtimeModel, noVariants)
  for (const model of catalog.visible()) {
    for (const effort of ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']) {
      assert.doesNotThrow(
        () => prepare({
          model: model.id,
          messages: [{ role: 'user', content: 'hi' }],
          reasoning_effort: effort,
        }, catalog.visible()),
        `${model.id} rejected ${effort}`,
      )
    }
  }
})

test('image capability survives the catalog', () => {
  const catalog = catalogOf(runtimeModel)
  const model = catalog.visible()[0]
  assert.equal(model.images, true)
  // prepare() gates inline images on model.images; a renamed field would
  // silently turn every image request into "该模型不接受图片输入".
  assert.doesNotThrow(() => prepare({
    model: model.id,
    messages: [{
      role: 'user',
      content: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,aGVsbG8=' } }],
    }],
  }, catalog.visible()))
})
