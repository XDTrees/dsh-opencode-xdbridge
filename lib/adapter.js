/**
 * The `opencode-xdbridge` pi-ai provider: one loopback-backed adapter registered
 * into the Harness LLM seam.
 *
 * Assembly (`createProvider` + `openAICompletionsApi` + an inert auth plane +
 * the shim's in-process secret as apiKey) follows the pattern already validated
 * against this host by the other loopback-backed Harness providers.
 *
 * @module dsh-opencode-xdbridge/adapter
 */

import { createProvider } from '@earendil-works/pi-ai'
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy'
import { resolveImageAttachmentAccess, resolveRetryPolicy } from '@deepseek-ai/dsh-llm'
import { PiAiAdapter } from '@deepseek-ai/dsh-llm-pi-ai'

/** Provider route this plugin owns. */
export const BRIDGE_PROVIDER = 'opencode-xdbridge'

/** Display name shown in the model picker. */
export const BRIDGE_DISPLAY_NAME = 'OpenCode 免费模型'

/** Idle ceiling while one stream read is outstanding. */
export const BRIDGE_STREAM_IDLE_TIMEOUT_MS = 300_000

/** Image-request budgets at the dsh-llm-pi-ai defaults. */
const REQUEST_IMAGE_BUDGETS = {
  maxRequestImageBytes: 20_971_520,
  requestImagePixelBudget: 4_194_304,
  requestImageMaxBytes: 1_048_576,
}

/**
 * Inert pi-ai auth plane.
 *
 * The route authenticates only through the shim's per-process secret, so
 * pi-ai's own credential lifecycle must never manufacture a credential for it.
 */
const INERT_AUTH = {
  credentials: {
    async read() { return undefined },
    async list() { return [] },
    async modify() {
      throw new Error('dsh-opencode-xdbridge: this route has no pi-ai credential lifecycle')
    },
    async delete() {},
  },
  authContext: {
    async env() { return undefined },
    async fileExists() { return false },
  },
}

/** These models are free, so per-token pricing is zero by definition. */
const NO_COST = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }

/** pi-ai input modalities: images only when the catalog advertises them. */
function modelInput(info) {
  return info.images ? ['text', 'image'] : ['text']
}

/**
 * Map only the reasoning levels this model really exposes.
 *
 * Undeclared levels map to `null` (off) so the picker cannot offer a level the
 * runtime would reject with a 400.
 */
function thinkingLevelMap(info) {
  const efforts = info.supportedEfforts
  if (efforts === undefined || efforts.length === 0) return undefined
  const map = {}
  for (const level of ['minimal', 'low', 'medium', 'high', 'xhigh', 'max']) {
    map[level] = efforts.includes(level) ? level : null
  }
  map.off = null
  return map
}

/** Build one pi-ai model descriptor pointing at the loopback shim. */
function toPiModel(info, baseUrl) {
  const map = thinkingLevelMap(info)
  return {
    id: info.id,
    name: info.name,
    api: 'openai-completions',
    provider: BRIDGE_PROVIDER,
    baseUrl,
    input: modelInput(info),
    cost: NO_COST,
    contextWindow: info.contextWindow,
    maxTokens: info.maxOutputTokens,
    reasoning: map !== undefined,
    ...(map === undefined ? {} : { thinkingLevelMap: map }),
    compat: { supportsReasoningEffort: map !== undefined },
  }
}

/**
 * Assemble the adapter.
 *
 * `getModels` re-reads the live catalog, and every model's `baseUrl` is
 * re-resolved on each read so the shim's ephemeral port applies from the first
 * snapshot after startup.
 */
export function createBridgeAdapter({ shim, catalog, ctx }) {
  const buildModels = () => {
    const baseUrl = `${shim.baseUrl()}/v1`
    return catalog.visible().map(info => toPiModel(info, baseUrl))
  }

  const base = createProvider({
    id: BRIDGE_PROVIDER,
    name: BRIDGE_DISPLAY_NAME,
    auth: {
      apiKey: {
        name: 'OpenCode Bridge loopback secret',
        async resolve({ credential }) {
          const apiKey = credential?.key
          return apiKey === undefined || apiKey.length === 0
            ? undefined
            : { auth: { apiKey }, source: 'OpenCode Bridge' }
        },
      },
    },
    models: buildModels(),
    api: openAICompletionsApi(),
  })

  const provider = { ...base, getModels: () => buildModels() }

  const profile = {
    provider: BRIDGE_PROVIDER,
    displayName: BRIDGE_DISPLAY_NAME,
    streamIdleTimeoutMs: BRIDGE_STREAM_IDLE_TIMEOUT_MS,
    retryPolicy: resolveRetryPolicy(undefined, 'dsh-opencode-xdbridge retryPolicy'),
    configuredMaxTokens: new Map(),
    // Required by dsh-llm-pi-ai >= 0.1.5-rc.2: the host adapter reads
    // profile.modelErrors on every model resolution. The catalog comes from the
    // live runtime, so there are no pre-known failures.
    modelErrors: new Map(),
    ...REQUEST_IMAGE_BUDGETS,
    piProvider: provider,
  }

  const profiles = new Map([[BRIDGE_PROVIDER, profile]])

  const adapter = new PiAiAdapter({
    profiles: () => profiles,
    auth: INERT_AUTH,
    // The shim's per-process secret is the OpenAI apiKey; the shim validates it.
    resolveApiKey: async () => shim.token(),
    // A route that advertises image input must wire both hooks up, otherwise the
    // host adapter refuses every request carrying an image.
    resolveAttachments: () => ctx.get('attachments'),
    resolveImageAccess: (attachments, ref) =>
      resolveImageAttachmentAccess(attachments, hostPath => ctx.get('fs')?.processPathFromHostPath(hostPath), ref),
  })

  return {
    providerId: BRIDGE_PROVIDER,
    displayName: BRIDGE_DISPLAY_NAME,
    adapter,
    buildModels,
    invalidate: () => {
      profiles.set(BRIDGE_PROVIDER, profile)
    },
  }
}
