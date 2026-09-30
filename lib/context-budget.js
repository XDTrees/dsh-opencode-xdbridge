/**
 * How much of a model's context window the Harness may actually fill.
 *
 * The runtime reports a window and an output limit. Reporting the raw window to
 * the Harness is what allowed a 1.44M-token conversation to be built for a model
 * that declares 200K — the Harness had no reason to compact, sent it, and the
 * far end answered with a bare `invalid_request_error` that names nothing.
 *
 * The usable figure is the window minus what a reply needs, minus a margin for
 * the two things that make a request bigger than it looks:
 *
 *   - tokenisers disagree, and CJK text runs about one token per character
 *     rather than one per four characters, so a byte-based estimate undercounts
 *     Chinese badly;
 *   - the reply itself is generated into the same window.
 *
 * Reporting this smaller, honest number is what makes the Harness compact before
 * the request becomes impossible, instead of after it has already failed.
 *
 * @module dsh-opencode-xdbridge/context-budget
 */

/**
 * Share of the window kept free for estimation error and protocol overhead.
 *
 * 15% is deliberately generous: the cost of compacting slightly early is a
 * little lost context, while the cost of being late is a request that cannot
 * succeed at all.
 */
export const SAFETY_MARGIN = 0.15

/** Smallest sensible budget, so a tiny model still gets a usable number. */
const MIN_BUDGET = 4_000

/**
 * The context window to advertise for a model, in tokens.
 *
 * @param {{context?: number, input?: number, output?: number}} model runtime model
 * @returns {number} tokens the Harness may fill, always positive
 */
export function usableContextWindow(model) {
  const window = Number(model?.context ?? model?.input ?? 0)
  if (!Number.isFinite(window) || window <= 0) return 128_000

  const output = Number(model?.output ?? 0)
  // Reserve the reply's own share of the window, but never more than half of it:
  // a model that declares a huge output limit should not starve the prompt.
  const reserve = Number.isFinite(output) && output > 0 ? Math.min(output, window * 0.5) : 0

  const budget = (window - reserve) * (1 - SAFETY_MARGIN)
  return Math.max(MIN_BUDGET, Math.floor(budget))
}

/**
 * Whether a request is larger than the model's window, and by how much.
 *
 * Used to answer with a message that says what is actually wrong. The upstream's
 * own reply is a bare `invalid request`, which tells the user nothing and sends
 * them looking for a fault in the plugin.
 *
 * @param {number} estimatedTokens rough size of the outgoing request
 * @param {{context?: number, input?: number}} model runtime model
 * @returns {{over: boolean, estimated: number, window: number}}
 */
export function checkContextFit(estimatedTokens, model) {
  const window = Number(model?.context ?? model?.input ?? 0)
  return {
    over: Number.isFinite(window) && window > 0 && estimatedTokens > window,
    estimated: estimatedTokens,
    window,
  }
}

/**
 * Roughly how many tokens a string occupies.
 *
 * Deliberately simple and deliberately conservative, because the two easy
 * mistakes go in opposite directions:
 *
 *   - counting bytes/4 is fine for English and badly under-counts Chinese, where
 *     a character is 3 bytes in UTF-8 but about a whole token;
 *   - over-counting is safe here: the only consequence of a high estimate is an
 *     earlier "too long" message.
 *
 * CJK is therefore counted per character and everything else at four characters
 * per token.
 *
 * @param {string} text
 * @returns {number} estimated tokens
 */
export function estimateTokens(text) {
  if (typeof text !== 'string' || text === '') return 0
  let cjk = 0
  let other = 0
  for (const character of text) {
    const code = character.codePointAt(0)
    const isCjk = (code >= 0x3000 && code <= 0x9fff)   // punctuation, kana, CJK ideographs
      || (code >= 0xf900 && code <= 0xfaff)            // compatibility ideographs
      || (code >= 0xff00 && code <= 0xffef)            // fullwidth forms
      || (code >= 0x20000 && code <= 0x3ffff)          // extension planes
    if (isCjk) cjk += 1
    else other += 1
  }
  return cjk + Math.ceil(other / 4)
}

/**
 * Format a token count for a person: `200K`, `1.4M`.
 *
 * @param {number} tokens
 * @returns {string}
 */
export function formatTokens(tokens) {
  if (!Number.isFinite(tokens)) return '—'
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}K`
  return String(tokens)
}

