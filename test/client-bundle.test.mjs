/**
 * Headless verification of the browser half.
 *
 * Loads `lib/client.js` the way the host does — through
 * `window.__ModuleLoader__.load` — with a minimal React stand-in, then asserts
 * the bundle registers a `settings.section` page with the right options.
 *
 * This catches the failures that would otherwise only appear as a blank page in
 * the browser: a bundle that never registers, an `apply` that throws, or a
 * registration whose id/order/label the settings shell cannot project.
 *
 *   node test/client-bundle.test.mjs
 */

import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const bundlePath = path.join(root, 'lib', 'client.js')

let failures = 0
const check = (label, condition, detail) => {
  if (condition) { console.log(`  ok   ${label}`) }
  else { console.log(`  FAIL ${label}${detail === undefined ? '' : ` — ${detail}`}`); failures += 1 }
}

// --- A minimal React stand-in: enough to construct an element tree. ---
const element = (type, props, ...children) => ({ type, props: props ?? {}, children })
const React = {
  createElement: element,
  useState: initial => [typeof initial === 'function' ? initial() : initial, () => {}],
  useEffect: () => {},
  useRef: value => ({ current: value }),
  useCallback: fn => fn,
  useMemo: fn => fn(),
}

/** Registry capturing what the bundle registered. */
const registrations = []
const localeRegistrations = []
const effects = []

const slots = {
  // Real semantics: `slots.inject(key, cb)` runs `cb` synchronously through
  // `ctx.effect` once the slot is declared, and returns an idempotent disposer.
  inject: (key, callback) => {
    const dispose = ctx.effect(callback, `slots.inject(${JSON.stringify(key)})`)
    return () => { dispose?.() }
  },
  register: (options, component) => {
    registrations.push({ options, component })
    return () => {}
  },
}

const locale = {
  register: (namespace, dictionaries) => { localeRegistrations.push({ namespace, dictionaries }); return () => {} },
  bind: namespace => (key, params) => {
    const table = localeRegistrations.find(entry => entry.namespace === namespace)?.dictionaries?.zh ?? {}
    const text = table[key] ?? key
    return params === undefined ? text : String(text).replace(/\{(\w+)\}/g, (m, k) => (k in params ? String(params[k]) : m))
  },
}

const ctx = {
  // Real cordis: the callback runs immediately and its return value is the disposer.
  effect: (fn, label) => {
    effects.push(label ?? 'effect')
    const dispose = fn()
    return () => { if (typeof dispose === 'function') dispose() }
  },
  slots,
  locale,
  get: () => undefined,
  logger: console,
}

// --- Load the bundle the way the host does. ---
const moduleTable = new Map([
  ['react', React],
  ['react/jsx-runtime', { jsx: element, jsxs: element }],
])

const sandbox = {
  console,
  setTimeout,
  clearTimeout,
  setInterval,
  clearInterval,
  fetch: async () => ({ ok: false, status: 503, json: async () => ({}) }),
  queueMicrotask,
  document: undefined,
  window: {},
}
sandbox.window.__ModuleLoader__ = {
  load: registration => { sandbox.__registration = registration },
}
sandbox.globalThis = sandbox

const source = fs.readFileSync(bundlePath, 'utf8')
vm.createContext(sandbox)
try {
  vm.runInContext(source, sandbox, { filename: 'lib/client.js' })
} catch (error) {
  console.error(`bundle threw while loading: ${error.message}`)
  process.exit(1)
}

console.log('module-loader contract:')
const registration = sandbox.__registration
check('calls window.__ModuleLoader__.load', registration !== undefined)
check('declares an id', typeof registration?.id === 'string', String(registration?.id))
check('declares a factory', typeof registration?.factory === 'function')

const mod = registration.factory(spec => {
  if (moduleTable.has(spec)) return moduleTable.get(spec)
  throw new Error(`unexpected require("${spec}") — not a platform seed`)
})

console.log('\nmodule exports:')
check('exports name', typeof mod.name === 'string', String(mod.name))
check('exports inject array', Array.isArray(mod.inject), JSON.stringify(mod.inject))
check('exports apply', typeof mod.apply === 'function')

// Only services present on every host line may be injected, or `apply` never runs.
console.log('\ninject gate:')
const allowed = new Set(['slots', 'locale'])
check('injects only always-present services', (mod.inject ?? []).every(name => allowed.has(name)), JSON.stringify(mod.inject))

console.log('\napply():')
try {
  mod.apply(ctx)
  check('apply did not throw', true)
} catch (error) {
  check('apply did not throw', false, error.message)
}

check('registered locale copy', localeRegistrations.length === 1, JSON.stringify(localeRegistrations.map(r => r.namespace)))
check('locale namespace is settings.*', String(localeRegistrations[0]?.namespace).startsWith('settings.'), String(localeRegistrations[0]?.namespace))
check('registers a settings.section page', registrations.length === 1, String(registrations.length))

const options = registrations[0]?.options ?? {}
console.log(`  options: ${JSON.stringify({ name: options.name, id: options.id, order: options.order, label: typeof options.label, inject: typeof options.inject })}`)
check('slot name is settings.section', options.name === 'settings.section', String(options.name))
check('carries an id (required by a list slot)', typeof options.id === 'string' && options.id !== '', String(options.id))
check('carries a numeric order', Number.isFinite(options.order), String(options.order))
check('label is a thunk (so it follows locale changes)', typeof options.label === 'function')
check('inject is a function (its result spreads into props)', typeof options.inject === 'function')

const injected = options.inject()
check('inject() supplies a translator', typeof injected?.t === 'function')

// The shell projects label by calling it; a thunk that throws would blank the nav row.
try {
  const label = options.label()
  check('label() resolves to non-empty text', typeof label === 'string' && label.length > 0, JSON.stringify(label))
} catch (error) {
  check('label() resolves to non-empty text', false, error.message)
}

// --- Render one frame to prove the component tree builds. ---
console.log('\nrender:')
const Page = registrations[0].component
try {
  const tree = Page({ ...injected })
  check('component renders a tree', tree !== undefined && tree !== null)
  const className = tree?.props?.className ?? ''
  check('renders the page shell', String(className).includes('dsm-ocxb-page'), String(className))
} catch (error) {
  check('component renders a tree', false, error.message)
}

// --- Copy completeness: every key the component asks for must exist in zh. ---
console.log('\ncopy:')
const zh = localeRegistrations[0]?.dictionaries?.zh ?? {}
const en = localeRegistrations[0]?.dictionaries?.en ?? {}
const zhKeys = Object.keys(zh).sort()
const enKeys = Object.keys(en).sort()
check('zh and en have identical key sets', zhKeys.join('|') === enKeys.join('|'),
  `zh-only=${zhKeys.filter(k => !enKeys.includes(k)).join(',')} en-only=${enKeys.filter(k => !zhKeys.includes(k)).join(',')}`)
check('copy table is non-empty', zhKeys.length > 20, String(zhKeys.length))

// Any t('literal') the component uses must be present, or the UI shows raw keys.
const source2 = fs.readFileSync(path.join(root, 'src', 'client', 'index.js'), 'utf8')
const used = new Set()
for (const match of source2.matchAll(/\bt\(\s*'([^']+)'\s*\)/g)) used.add(match[1])
const missing = [...used].filter(key => !(key in zh))
check(`every literal t() key exists (${used.size} used)`, missing.length === 0, missing.join(', '))

console.log(failures === 0 ? '\nCLIENT BUNDLE OK' : `\nCLIENT BUNDLE FAILED (${failures})`)
process.exit(failures === 0 ? 0 : 1)
