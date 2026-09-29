/**
 * Reproduce the "a failed model can never be re-probed" bug.
 *
 * The probe prepares its request against `catalog.visible()`, which EXCLUDES
 * models already marked unusable. So the second time a sweep runs, any model
 * that failed before is no longer in the list the request is validated
 * against, `prepare` rejects it with `model_not_found`, and it can never
 * recover — the badge is stuck on 不可用 forever.
 */

import { BridgeCatalog } from '../lib/catalog.js'
import { prepare } from '../lib/protocol.js'
import { probeBody } from '../lib/probe.js'

const catalog = new BridgeCatalog()
catalog.replace([
  { id: 'opencode/good', name: 'Good', context: 100000, output: 8000, toolcall: true, reasoning: true },
  { id: 'opencode/bad', name: 'Bad', context: 100000, output: 8000, toolcall: true, reasoning: true },
])

let failures = 0
const check = (label, condition, detail) => {
  if (condition) console.log(`  ok   ${label}`)
  else { console.log(`  FAIL ${label}${detail === undefined ? '' : ` — ${detail}`}`); failures += 1 }
}

// First sweep: `bad` fails.
catalog.record('opencode/bad', { ok: false, source: 'probe', category: 'timeout', error: '超时' })

console.log('after a failed first sweep:')
check('visible() excludes the failed model', catalog.visible().length === 1, String(catalog.visible().length))
check('all() still knows about it', catalog.all().length === 2, String(catalog.all().length))

console.log('\nre-probing the failed model, as the sweep does:')
const model = catalog.all().find(m => m.id === 'opencode/bad')
let threw
try {
  prepare(probeBody(model, 'tok'), catalog.visible())
} catch (error) {
  threw = error
}
check('prepare() must accept a known model', threw === undefined,
  threw === undefined ? '' : `${threw.code}: ${threw.message}`)

console.log('\nwith all() as the validation list:')
let threwWithAll
try {
  prepare(probeBody(model, 'tok'), catalog.all())
} catch (error) {
  threwWithAll = error
}
check('prepare() accepts it against all()', threwWithAll === undefined,
  threwWithAll === undefined ? '' : `${threwWithAll.code}: ${threwWithAll.message}`)

console.log(failures === 0 ? '\nNO BUG' : `\nBUG REPRODUCED (${failures} failing checks)`)
process.exit(0)
