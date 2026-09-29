/**
 * Unit tests for the pure protocol layer: request preparation, envelope
 * decoding, and the handoff mapping.
 *
 * These cover the parts where a mistake means executing the wrong action, so
 * they are the ones worth pinning down.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { prepare, decode, completion, BridgeError } from '../lib/protocol.js'
import { buildHandoff, handoffInput, validateAction } from '../lib/handoff.js'
import { freeModels, clientModelID } from '../lib/backend.js'
import { reasoningEfforts } from '../lib/reasoning.js'

/** A minimal published-model entry. */
function model(overrides = {}) {
  return {
    id: 'opencode/big-pickle',
    name: 'Big Pickle',
    context: 200000,
    input: 160000,
    output: 32000,
    images: false,
    toolcall: true,
    reasoning: true,
    variants: {},
    ...overrides,
  }
}

const MODELS = [model()]

test('prepare rejects an unknown model', () => {
  assert.throws(
    () => prepare({ model: 'nope', messages: [{ role: 'user', content: 'hi' }] }, MODELS),
    error => error instanceof BridgeError && error.code === 'model_not_found',
  )
})

test('prepare rejects an empty message list', () => {
  assert.throws(
    () => prepare({ model: 'opencode/big-pickle', messages: [] }, MODELS),
    error => error.code === 'invalid_request',
  )
})

test('prepare accepts a model addressed by its client id', () => {
  const request = prepare({ model: clientModelID(MODELS[0]), messages: [{ role: 'user', content: 'hi' }] }, MODELS)
  assert.equal(request.model.id, 'opencode/big-pickle')
})

test('prepare rejects duplicate tool names', () => {
  const tool = { type: 'function', function: { name: 'Read', parameters: { type: 'object' } } }
  assert.throws(
    () => prepare({ model: 'opencode/big-pickle', messages: [{ role: 'user', content: 'hi' }], tools: [tool, tool] }, MODELS),
    /重复/,
  )
})

test('prepare rejects an image for a text-only model', () => {
  assert.throws(
    () => prepare({
      model: 'opencode/big-pickle',
      messages: [{
        role: 'user',
        content: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,aGk=' } }],
      }],
    }, MODELS),
    error => error.code === 'unsupported_content',
  )
})

test('prepare rejects a remote image URL', () => {
  const withImages = [model({ images: true })]
  assert.throws(
    () => prepare({
      model: 'opencode/big-pickle',
      messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'https://example.com/a.png' } }] }],
    }, withImages),
    error => error.code === 'unsupported_content',
  )
})

test('prepare accepts an inline base64 image and records an attachment', () => {
  const withImages = [model({ images: true })]
  const request = prepare({
    model: 'opencode/big-pickle',
    messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,aGk=' } }] }],
  }, withImages)
  assert.equal(request.images.length, 1)
  assert.equal(request.images[0].mime, 'image/png')
  assert.match(request.text, /Attached image/)
})

test('prepare refuses tool use on a chat-only model', () => {
  const chatOnly = [model({ chatOnly: true })]
  assert.throws(
    () => prepare({
      model: 'opencode/big-pickle',
      messages: [{ role: 'user', content: 'hi' }],
      tools: [{ type: 'function', function: { name: 'Read', parameters: { type: 'object' } } }],
    }, chatOnly),
    error => error.code === 'tools_not_supported',
  )
})

test('prepare rejects a reasoning effort the model does not expose', () => {
  const withVariants = [model({ variants: { low: { reasoningEffort: 'low' } } })]
  assert.throws(
    () => prepare({
      model: 'opencode/big-pickle',
      messages: [{ role: 'user', content: 'hi' }],
      reasoning_effort: 'high',
    }, withVariants),
    error => error.code === 'unsupported_reasoning_effort',
  )
})

test('prepare accepts a declared reasoning effort', () => {
  const withVariants = [model({ variants: { low: { reasoningEffort: 'low' } } })]
  const request = prepare({
    model: 'opencode/big-pickle',
    messages: [{ role: 'user', content: 'hi' }],
    reasoning_effort: 'low',
  }, withVariants)
  assert.equal(request.variant, 'low')
})

test('prepare tolerates a default effort on a fixed-reasoning model', () => {
  const request = prepare({
    model: 'opencode/big-pickle',
    messages: [{ role: 'user', content: 'hi' }],
    reasoning_effort: 'high',
  }, MODELS)
  assert.equal(request.variant, undefined)
})

test('decode reads a plain text envelope', () => {
  const request = prepare({ model: 'opencode/big-pickle', messages: [{ role: 'user', content: 'hi' }] }, MODELS)
  const message = decode('{"content":"hello","calls":[]}', request)
  assert.equal(message.content, 'hello')
  assert.equal(message.tool_calls, undefined)
})

test('decode unwraps a fenced envelope', () => {
  const request = prepare({ model: 'opencode/big-pickle', messages: [{ role: 'user', content: 'hi' }] }, MODELS)
  assert.equal(decode('```json\n{"content":"hi","calls":[]}\n```', request).content, 'hi')
})

test('decode accepts tool_calls spelling', () => {
  const tools = [{ type: 'function', function: { name: 'Read', parameters: { type: 'object', properties: { file_path: { type: 'string' } } } } }]
  const request = prepare({ model: 'opencode/big-pickle', messages: [{ role: 'user', content: 'hi' }], tools }, MODELS)
  const message = decode(JSON.stringify({
    content: '',
    tool_calls: [{ type: 'function', function: { name: 'Read', arguments: { file_path: '/a.txt' } } }],
  }), request)
  assert.equal(message.tool_calls.length, 1)
  assert.equal(JSON.parse(message.tool_calls[0].function.arguments).file_path, '/a.txt')
})

test('decode parses stringified arguments', () => {
  const tools = [{ type: 'function', function: { name: 'Read', parameters: { type: 'object', properties: { file_path: { type: 'string' } } } } }]
  const request = prepare({ model: 'opencode/big-pickle', messages: [{ role: 'user', content: 'hi' }], tools }, MODELS)
  const message = decode(JSON.stringify({ content: '', calls: [{ name: 'Read', arguments: '{"file_path":"/a.txt"}' }] }), request)
  assert.equal(JSON.parse(message.tool_calls[0].function.arguments).file_path, '/a.txt')
})

test('decode rejects a tool the request did not offer', () => {
  const request = prepare({ model: 'opencode/big-pickle', messages: [{ role: 'user', content: 'hi' }] }, MODELS)
  assert.throws(
    () => decode(JSON.stringify({ content: '', calls: [{ name: 'Bash', arguments: { command: 'rm -rf /' } }] }), request),
    error => error.code === 'invalid_tool_call',
  )
})

test('decode rejects calls when tool_choice is none', () => {
  const tools = [{ type: 'function', function: { name: 'Read', parameters: { type: 'object', properties: { file_path: { type: 'string' } } } } }]
  const request = prepare({ model: 'opencode/big-pickle', messages: [{ role: 'user', content: 'hi' }], tools, tool_choice: 'none' }, MODELS)
  assert.throws(
    () => decode(JSON.stringify({ content: '', calls: [{ name: 'Read', arguments: { file_path: '/a' } }] }), request),
    error => error.code === 'invalid_tool_call',
  )
})

test('decode rejects parallel calls when disabled', () => {
  const tools = [{ type: 'function', function: { name: 'Read', parameters: { type: 'object', properties: { file_path: { type: 'string' } } } } }]
  const request = prepare({
    model: 'opencode/big-pickle',
    messages: [{ role: 'user', content: 'hi' }],
    tools,
    parallel_tool_calls: false,
  }, MODELS)
  assert.throws(
    () => decode(JSON.stringify({
      content: '',
      calls: [{ name: 'Read', arguments: { file_path: '/a' } }, { name: 'Read', arguments: { file_path: '/b' } }],
    }), request),
    error => error.code === 'invalid_tool_call',
  )
})

test('decode rejects a malformed envelope', () => {
  const request = prepare({ model: 'opencode/big-pickle', messages: [{ role: 'user', content: 'hi' }] }, MODELS)
  assert.throws(() => decode('not json', request), error => error.code === 'invalid_model_output')
  assert.throws(() => decode('{"content":123}', request), error => error.code === 'invalid_model_output')
})

test('decode rejects an envelope with both call spellings', () => {
  const request = prepare({ model: 'opencode/big-pickle', messages: [{ role: 'user', content: 'hi' }] }, MODELS)
  assert.throws(
    () => decode('{"content":"","calls":[],"tool_calls":[]}', request),
    error => error.code === 'invalid_tool_call',
  )
})

test('completion totals cache and reasoning tokens like OpenAI', () => {
  const result = completion('m', { role: 'assistant', content: 'hi' }, {
    input: 10, output: 5, cache: { read: 2, write: 1 }, reasoning: 3,
  })
  assert.equal(result.usage.prompt_tokens, 13)
  assert.equal(result.usage.completion_tokens, 8)
  assert.equal(result.usage.total_tokens, 21)
})

test('completion marks a tool reply with finish_reason tool_calls', () => {
  const result = completion('m', { role: 'assistant', content: null, tool_calls: [{ id: 'x' }] }, undefined)
  assert.equal(result.choices[0].finish_reason, 'tool_calls')
})

test('buildHandoff maps a bash command onto the external Bash tool', () => {
  const tools = [{
    type: 'function',
    function: { name: 'Bash', parameters: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'] } },
  }]
  const handoff = buildHandoff({ native: 'bash', input: { command: 'ls -la' }, tools })
  assert.deepEqual(handoff, { name: 'Bash', arguments: { command: 'ls -la' } })
})

test('buildHandoff renames read filePath to the schema spelling', () => {
  const tools = [{
    type: 'function',
    function: { name: 'Read', parameters: { type: 'object', properties: { file_path: { type: 'string' } }, required: ['file_path'] } },
  }]
  const handoff = buildHandoff({ native: 'read', input: { filePath: '/a.txt' }, tools })
  assert.deepEqual(handoff, { name: 'Read', arguments: { file_path: '/a.txt' } })
})

test('buildHandoff drops arguments the target schema does not declare', () => {
  const tools = [{
    type: 'function',
    function: { name: 'Bash', parameters: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'] } },
  }]
  const handoff = buildHandoff({ native: 'bash', input: { command: 'ls', secret: 'nope' }, tools })
  assert.deepEqual(handoff, { name: 'Bash', arguments: { command: 'ls' } })
})

test('buildHandoff refuses when a required argument is missing', () => {
  const tools = [{
    type: 'function',
    function: { name: 'Write', parameters: { type: 'object', properties: { file_path: { type: 'string' }, content: { type: 'string' } }, required: ['file_path', 'content'] } },
  }]
  assert.equal(buildHandoff({ native: 'write', input: { filePath: '/a.txt' }, tools }), null)
})

test('buildHandoff refuses an unknown native tool', () => {
  const tools = [{
    type: 'function',
    function: { name: 'Bash', parameters: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'] } },
  }]
  assert.equal(buildHandoff({ native: 'mystery', input: { command: 'x' }, tools }), null)
})

test('buildHandoff refuses when the external client offered no such tool', () => {
  assert.equal(buildHandoff({ native: 'bash', input: { command: 'ls' }, tools: [] }), null)
})

test('handoffInput fills arguments from the approval metadata', () => {
  const input = handoffInput({ input: {} }, { metadata: { command: 'echo hi' } })
  assert.equal(input.command, 'echo hi')
})

test('handoffInput prefers the tool part over the metadata', () => {
  const input = handoffInput({ input: { command: 'real' } }, { metadata: { command: 'stale' } })
  assert.equal(input.command, 'real')
})

test('validateAction refuses a tool the receiver did not offer', () => {
  assert.throws(
    () => validateAction({ name: 'Bash', arguments: {} }, []),
    error => error.code === 'invalid_tool_call',
  )
})

test('validateAction refuses an undeclared argument', () => {
  const tools = [{
    type: 'function',
    function: { name: 'Read', parameters: { type: 'object', properties: { file_path: { type: 'string' } }, required: ['file_path'] } },
  }]
  assert.throws(
    () => validateAction({ name: 'Read', arguments: { file_path: '/a', extra: 1 } }, tools),
    error => error.code === 'invalid_tool_call',
  )
})

test('validateAction accepts a well-formed action', () => {
  const tools = [{
    type: 'function',
    function: { name: 'Read', parameters: { type: 'object', properties: { file_path: { type: 'string' } }, required: ['file_path'] } },
  }]
  assert.deepEqual(validateAction({ name: 'read', arguments: { file_path: '/a' } }, tools), {
    name: 'Read', arguments: { file_path: '/a' },
  })
})

test('freeModels keeps only models whose every cost dimension is zero', () => {
  const providers = {
    all: [{
      id: 'opencode',
      models: {
        'free-one': { name: 'Free One', cost: { input: 0, output: 0 }, capabilities: {}, limit: {} },
        paid: { name: 'Paid', cost: { input: 1, output: 0 }, capabilities: {}, limit: {} },
        'cache-paid': { name: 'Cache Paid', cost: { input: 0, output: 0, cache: { read: 0.1 } }, capabilities: {}, limit: {} },
        deprecated: { name: 'Old', cost: { input: 0, output: 0 }, capabilities: {}, limit: {}, status: 'deprecated' },
      },
    }],
  }
  const models = freeModels(providers)
  assert.deepEqual(models.map(m => m.id), ['opencode/free-one'])
})

test('freeModels throws when the runtime has no opencode provider', () => {
  assert.throws(() => freeModels({ all: [] }), /opencode provider/)
})

test('reasoningEfforts exposes only advertised levels', () => {
  const efforts = reasoningEfforts({
    reasoning: true,
    variants: {
      low: { reasoningEffort: 'low' },
      high: { reasoningEffort: 'high' },
      broken: { reasoningEffort: 'nonsense' },
      off: { reasoningEffort: 'low', disabled: true },
    },
  })
  assert.deepEqual(efforts, { low: 'low', high: 'high' })
})

test('reasoningEfforts is empty for a non-reasoning model', () => {
  assert.deepEqual(reasoningEfforts({ reasoning: false, variants: { low: { reasoningEffort: 'low' } } }), {})
})
