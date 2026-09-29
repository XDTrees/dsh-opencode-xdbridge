/**
 * Node-free constants shared by the Host and browser halves of the OpenCode XD
 * Bridge settings page.
 *
 * This module must stay importable from the browser bundle, so it carries no
 * Node built-ins — only route paths. The JSON document the page renders is
 * described here in JSDoc so both halves agree on its shape without a build
 * step.
 *
 * @module dsh-opencode-xdbridge/status-paths
 */

/** Plugin-owned read-only status endpoint. */
export const BRIDGE_STATUS_PATH = '/plugins/dsh-opencode-xdbridge/status'

/** Re-read the free-model roster from the running OpenCode runtime. */
export const BRIDGE_REFRESH_PATH = '/plugins/dsh-opencode-xdbridge/models/refresh'

/** Re-probe every model with a real request, one at a time. */
export const BRIDGE_PROBE_PATH = '/plugins/dsh-opencode-xdbridge/models/probe'

/** Restart the managed runtime (the provider stays registered). */
export const BRIDGE_RESTART_PATH = '/plugins/dsh-opencode-xdbridge/runtime/restart'

/** Fetch one model's detail row, including its last observed activity. */
export const BRIDGE_MODEL_PATH = '/plugins/dsh-opencode-xdbridge/model'

/**
 * One model's last observed outcome.
 *
 * @typedef {object} BridgeWebModelResult
 * @property {boolean} ok
 * @property {'probe'|'request'} source `probe` for a detection run, `request` for real traffic
 * @property {number} time epoch milliseconds
 * @property {number} [durationMs]
 * @property {string} [category] coarse failure class, when the run failed
 * @property {string} [error]
 * @property {boolean} [chatOnly] published for plain conversation only
 * @property {number} [calls] tool calls the model returned on its last real turn
 * @property {number} [nativeAttempts] native actions the bridge had to refuse
 * @property {number} [steps] upstream turns that turn needed
 * @property {string} [handoff] external tool a blocked native action became
 */

/**
 * One model row, as the page renders it.
 *
 * @typedef {object} BridgeWebModel
 * @property {string} id runtime id, e.g. `opencode/big-pickle`
 * @property {string} name display name shown in the picker
 * @property {number} contextWindow
 * @property {number} maxOutputTokens
 * @property {boolean} supportsImages
 * @property {boolean} supportsTools
 * @property {boolean} supportsReasoning
 * @property {string[]} supportedEfforts reasoning levels the runtime advertises
 * @property {BridgeWebModelResult} [lastResult] absent means "not exercised yet"
 */

/**
 * One in-flight request, for the page's activity line.
 *
 * @typedef {object} BridgeWebActivity
 * @property {string} model
 * @property {string} status
 * @property {number} waitedMs
 * @property {number} [attempt]
 * @property {string} [error]
 */

/**
 * The whole status document the page polls.
 *
 * @typedef {object} BridgeWebStatus
 * @property {'starting'|'ready'|'error'|'stopped'} phase
 * @property {string} message one-line state, shown next to the status dot
 * @property {string} [runtimeVersion] OpenCode version of the managed runtime
 * @property {string} [endpoint] loopback endpoint the pi-ai provider points at
 * @property {string} dataDir where the managed runtime and logs live
 * @property {string} provider provider id this plugin registered
 * @property {BridgeWebModel[]} models
 * @property {{running: boolean, current?: string, pending: string[]}} probe
 * @property {BridgeWebActivity[]} activity newest first
 * @property {{discovered: number, available: number, pending: number, unusable: number}} metrics
 */
