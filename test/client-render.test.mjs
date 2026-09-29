/**
 * Render the settings page headlessly and assert what the user actually sees:
 * the nav label, the page title, the inline mark, and the per-model
 * recommended-use line.
 *
 * A minimal hook runtime is provided so the component's real state machine runs
 * — `useState` + `useEffect` — which is what makes the populated model list
 * appear rather than only the empty shell.
 *
 *   node test/client-render.test.mjs
 */

import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

let failures = 0
const check = (label, condition, detail) => {
  if (condition) console.log(`  ok   ${label}`)
  else { console.log(`  FAIL ${label}${detail === undefined ? '' : ` — ${detail}`}`); failures += 1 }
}

// --- Minimal hook runtime -----------------------------------------------
/** Hooks for the component currently rendering. */
/**
 * Hooks are stored PER COMPONENT, not per render pass.
 *
 * Rendering a child component must not clobber the parent's state — otherwise
 * clicking a row would be lost the moment the list re-renders, and the test
 * would silently measure an empty tree.
 */
const hookStore = new Map()
let hooks = []
let hookIndex = 0
let pendingRender = false

const element = (type, props, ...children) => ({ type, props: props ?? {}, children })

function scheduleRender() { pendingRender = true }

const React = {
  createElement: element,
  useState(initial) {
    const i = hookIndex++
    if (hooks.length <= i) hooks[i] = { value: typeof initial === 'function' ? initial() : initial }
    const cell = hooks[i]
    return [cell.value, next => {
      cell.value = typeof next === 'function' ? next(cell.value) : next
      scheduleRender()
    }]
  },
  useEffect(fn, deps) {
    const i = hookIndex++
    const prev = hooks[i]
    const changed = prev === undefined || deps === undefined
      || deps.length !== prev.deps.length || deps.some((d, k) => d !== prev.deps[k])
    if (!changed) return
    if (prev?.cleanup) { try { prev.cleanup() } catch {} }
    hooks[i] = { deps, cleanup: undefined }
    // Effects run after the render pass.
    const cell = hooks[i]
    pendingEffects.push(() => { cell.cleanup = fn() })
  },
  useRef(v) { const i = hookIndex++; if (hooks.length <= i) hooks[i] = { current: v }; return hooks[i] },
  useCallback(fn) { return fn },
  useMemo(fn) { return fn() },
}

let pendingEffects = []

/** Render one component instance, preserving its own hook cells. */
function render(Component, props) {
  hooks = hookStore.get(Component) ?? []
  hookStore.set(Component, hooks)
  for (let pass = 0; pass < 50; pass++) {
    hookIndex = 0
    pendingRender = false
    const tree = Component(props)
    for (const effect of pendingEffects.splice(0)) effect()
    if (!pendingRender) return tree
  }
  throw new Error(`render did not settle for ${Component.name}`)
}

// --- Module loader sandbox ----------------------------------------------
const registrations = []
const localeRegistrations = []
const effects = []

const ctx = {
  effect: (fn, label) => { effects.push(label); const d = fn(); return () => { if (typeof d === 'function') d() } },
  slots: {
    inject: (key, callback) => { const d = ctx.effect(callback, `slots.inject(${key})`); return () => d?.() },
    register: (options, component) => { registrations.push({ options, component }); return () => {} },
  },
  locale: {
    register: (namespace, dictionaries) => { localeRegistrations.push({ namespace, dictionaries }); return () => {} },
    bind: namespace => (key, params) => {
      const table = localeRegistrations.find(e => e.namespace === namespace)?.dictionaries?.zh ?? {}
      const text = table[key] ?? key
      return params === undefined ? text : String(text).replace(/\{(\w+)\}/g, (m, k) => (k in params ? String(params[k]) : m))
    },
    getSnapshot: () => ({ active: 'zh' }),
  },
  get: () => undefined,
  logger: console,
}

/** The status document the fake host serves. */
const STATUS = {
  phase: 'ready',
  message: '运行中 · 2 个免费模型',
  runtimeVersion: '1.18.33',
  endpoint: 'http://127.0.0.1:51337/',
  dataDir: 'D:\\deep harness\\opencode-xdbridge',
  provider: 'opencode-xdbridge',
  probe: { running: false, pending: [] },
  activity: [],
  metrics: { discovered: 2, available: 1, pending: 1, unusable: 0 },
  models: [
    {
      id: 'opencode/big-pickle', name: 'Big Pickle', contextWindow: 200000, maxOutputTokens: 32000,
      supportsImages: false, supportsTools: true, supportsReasoning: true, supportedEfforts: [],
      lastResult: { ok: true, source: 'probe', time: Date.now(), durationMs: 5900 },
    },
    {
      id: 'opencode/longcat-2.5-preview-free', name: 'LongCat 2.5 Preview Free',
      contextWindow: 1000000, maxOutputTokens: 131072, supportsImages: true, supportsTools: true,
      supportsReasoning: true, supportedEfforts: ['low', 'medium', 'high'],
    },
  ],
}

const sandbox = {
  console, setTimeout, clearTimeout, setInterval, clearInterval, queueMicrotask,
  fetch: async url => ({
    ok: true,
    status: 200,
    json: async () => (String(url).includes('/status') ? STATUS : { ok: true, count: 2 }),
  }),
  document: undefined,
  window: { __ModuleLoader__: { load: r => { sandbox.__reg = r } } },
}
sandbox.globalThis = sandbox
vm.createContext(sandbox)
vm.runInContext(fs.readFileSync(path.join(root, 'lib', 'client.js'), 'utf8'), sandbox, { filename: 'lib/client.js' })

const mod = sandbox.__reg.factory(spec => {
  if (spec === 'react') return React
  if (spec === 'react/jsx-runtime') return { jsx: element, jsxs: element }
  throw new Error(`unexpected require ${spec}`)
})
mod.apply(ctx)

const options = registrations[0].options

// --- Assertions ----------------------------------------------------------
console.log('nav + title:')
check('nav label is "OpenCode-XD"', options.label() === 'OpenCode-XD', JSON.stringify(options.label()))

const injected = options.inject()
let tree = render(registrations[0].component, injected)

// The page loads its status through `fetch` in an effect, so the populated
// render only exists after those promises settle. Drain the microtask queue and
// re-render until the state stops changing.
for (let i = 0; i < 20; i++) {
  await new Promise(resolve => setImmediate(resolve))
  tree = render(registrations[0].component, injected)
}

/** Collect every rendered string. */
function texts(node, out = []) {
  if (node === null || node === undefined || typeof node === 'boolean') return out
  if (typeof node === 'string' || typeof node === 'number') { out.push(String(node)); return out }
  if (Array.isArray(node)) { for (const c of node) texts(c, out); return out }
  if (typeof node === 'object') {
    if (node.props?.dangerouslySetInnerHTML?.__html) out.push(node.props.dangerouslySetInnerHTML.__html)
    if (typeof node.type === 'function') {
      // Render child components with the same hook runtime.
      const props = { ...node.props, children: undefined }
      texts(render(node.type, props), out)
      return out
    }
    for (const c of node.children ?? []) texts(c, out)
  }
  return out
}

const all = texts(tree)
const joined = all.join('\n')

console.log('\npage header:')
check('page title is "OpenCode-XDbridge"', all.includes('OpenCode-XDbridge'), JSON.stringify(all.slice(0, 10)))
check('renders the inline svg mark', all.some(s => s.includes('<svg')), 'no svg found')

console.log('\nstatus + metrics:')
check('shows the runtime version', joined.includes('1.18.33'))
check('shows the endpoint', joined.includes('http://127.0.0.1:51337/'))
check('shows the data dir', joined.includes('opencode-xdbridge'))
check('shows all four metric labels',
  ['已发现', '可用', '待检测', '不可用'].every(k => joined.includes(k)))

console.log('\nmodel rows:')
check('lists Big Pickle', joined.includes('Big Pickle'))
check('lists LongCat', joined.includes('LongCat 2.5 Preview Free'))
check('shows the measured response time', /5\.9 s/.test(joined), 'expected "5.9 s"')
check('shows 推荐用途 for big-pickle', joined.includes('通用对话与轻量编码'), 'curated note missing')
check('shows 推荐用途 for longcat', joined.includes('100 万上下文 + 图片输入'), 'curated note missing')
check('shows the capability badges', joined.includes('推理') && joined.includes('图片'))

console.log('\nlayout regression:')
// The blank band came from reusing the flex-grow header class on the card title.
const css = fs.readFileSync(path.join(root, 'src', 'client', 'index.js'), 'utf8')
const headCopyUses = (css.match(/dsm-ocxb-headcopy/g) ?? []).length
check('header copy uses its own class (not the card title)', headCopyUses >= 2, String(headCopyUses))
const titleOnCard = /className: 'dsm-ocxb-copy'/.test(css)
check('no card title reuses the header flex-grow class', titleOnCard === false)

// --- Expanded detail anchors to its own row ------------------------------
console.log('\nrow-anchored detail:')

/** Find a node by predicate, depth-first. */
function findNode(node, predicate) {
  if (node === null || typeof node !== 'object') return undefined
  if (Array.isArray(node)) { for (const c of node) { const f = findNode(c, predicate); if (f) return f } return undefined }
  if (predicate(node)) return node
  if (typeof node.type === 'function') return undefined
  for (const c of node.children ?? []) { const f = findNode(c, predicate); if (f) return f }
  return undefined
}

// Drive the real component: click the second model's row, then re-render.
const listNode = findNode(tree, n => typeof n.type === 'function' && n.type.name === 'ModelList')
check('model list is rendered', listNode !== undefined)

/**
 * Walk the tree, rendering function components along the way.
 *
 * `texts()` and friends must not stop at a component boundary: the rows live
 * inside `ModelList`, so a shallow walk would find nothing.
 */
function walk(node, visit) {
  if (node === null || node === undefined || typeof node === 'boolean') return
  if (Array.isArray(node)) { for (const c of node) walk(c, visit); return }
  if (typeof node !== 'object') return
  if (typeof node.type === 'function') {
    const props = { ...node.props, children: undefined }
    walk(render(node.type, props), visit)
    return
  }
  visit(node)
  for (const c of node.children ?? []) walk(c, visit)
}

const rowButtons = []
walk(tree, node => {
  if (node.props?.['aria-expanded'] !== undefined && typeof node.props.onClick === 'function') rowButtons.push(node)
})
check('every model has a clickable row', rowButtons.length === STATUS.models.length, String(rowButtons.length))

// Click the second row, then let the state settle and re-render.
rowButtons[1].props.onClick()
await new Promise(resolve => setImmediate(resolve))
const openedTree = render(registrations[0].component, injected)

const openedRows = []
walk(openedTree, node => { if (node.props?.className === 'dsm-ocxb-item') openedRows.push(node) })

check('each model is its own list item', openedRows.length === STATUS.models.length, String(openedRows.length))

const openItem = openedRows.find(item =>
  (item.children ?? []).some(child => child?.props?.['aria-expanded'] === 'true'))
check('exactly one item is expanded', openItem !== undefined)

if (openItem !== undefined) {
  // The item's children are [row, <ModelDetail/>]. The detail element is a
  // component, so render it to reach the panel it produces.
  const parts = openItem.children ?? []
  const rowIndex = parts.findIndex(c => c?.props?.['aria-expanded'] !== undefined)
  const detailIndex = parts.findIndex(c => c?.type !== undefined && c.type.name === 'ModelDetail')

  check('the detail panel sits inside that item', detailIndex !== -1)
  check('the detail comes after its own row', detailIndex > rowIndex, `row=${rowIndex} detail=${detailIndex}`)

  const detailNode = detailIndex === -1 ? undefined : parts[detailIndex]
  const rendered = detailNode === undefined ? undefined : render(detailNode.type, detailNode.props)
  const detailText = rendered === undefined ? '' : texts(rendered).join('\n')

  check('the rendered detail is the panel element',
    rendered?.props?.className === 'dsm-ocxb-detail', String(rendered?.props?.className))
  check('detail shows the clicked model id', detailText.includes(STATUS.models[1].id), detailText.slice(0, 90))
  check('detail repeats the recommended use', detailText.includes('推荐用途'))
  check('detail lists the context window', detailText.includes('上下文'))

  // The panel must belong to the clicked model, not merely exist somewhere.
  const rowText = texts(parts[rowIndex]).join(' ')
  check('the open row is the clicked model', rowText.includes('LongCat'), rowText.slice(0, 80))
}

// The old layout appended the detail after the entire list.
const strayAfterList = (openedTree.children ?? []).find(c => c?.props?.className === 'dsm-ocxb-detail')
check('no detail is appended after the whole list', strayAfterList === undefined)

console.log(failures === 0 ? '\nRENDER CHECK OK' : `\nRENDER CHECK FAILED (${failures})`)
process.exit(failures === 0 ? 0 : 1)
