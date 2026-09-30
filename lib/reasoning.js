/**
 * Reasoning-effort mapping between the runtime's OpenCode variants and the
 * effort ids the Harness sends.
 *
 * @module dsh-opencode-xdbridge/reasoning
 */

/**
 * Level names, weakest first, exactly as the Harness spells them.
 *
 * These are the Harness's own ids rather than OpenAI's: the lowest is `off`,
 * meaning "do not reason", and it is what a request carries when the user takes
 * the default. This list used to say `none`, so `off` was unrecognised and
 * every request carrying it — including a plain default — came back
 * `400 unsupported_reasoning_effort`.
 */
export const EFFORT_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']

/** The level that means "no reasoning level requested". */
export const EFFORT_OFF = 'off'

/**
 * Map effort ids onto this model's real OpenCode variants.
 *
 * Only variants the runtime actually advertises are exposed, so a level the
 * model cannot honour is never offered to the client.
 *
 * @returns {Record<string, string>} effort id -> variant name
 */
export function reasoningEfforts(model) {
  if (!model.reasoning) return {}
  return Object.fromEntries(
    Object.entries(model.variants ?? {})
      .filter(([, options]) => !options.disabled && EFFORT_LEVELS.includes(options.reasoningEffort))
      .map(([variant, options]) => [options.reasoningEffort, variant]),
  )
}
