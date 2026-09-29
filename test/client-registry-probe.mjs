/**
 * Ask the host's own client-module registry whether it discovers this plugin's
 * browser half.
 *
 * The registry is what decides whether a page appears in the Settings nav, so
 * this is the check that matters. It exercises the real scan (package manifest
 * -> `dsh.client` -> `exports["./client"]`) rather than a reading of the docs.
 *
 * The registry is a cordis Service, so it cannot be constructed standalone.
 * Its scanning methods are pure enough to borrow through the prototype.
 */

import path from 'node:path'
import fs from 'node:fs'
import { pathToFileURL } from 'node:url'

const HOME = process.argv[2] ?? 'D:\\deep seek harness\\dsh-home'
const PLUGIN = process.argv[3] ?? 'dsh-opencode-xdbridge'
const APP = 'D:/DSH/DSH Desktop/resources/app/node_modules'

const installed = path.join(HOME, 'profiles', 'desktop', 'node_modules', PLUGIN)
console.log(`installed at: ${installed}`)
console.log(`  package.json exists: ${fs.existsSync(path.join(installed, 'package.json'))}`)

const mod = await import(`file:///${APP}/@deepseek-ai/dsh-client-modules/lib/index.js`)
const proto = mod.ClientModuleRegistry.prototype

// `locatePkgJson` needs only a loader face; give it the minimum it reads.
const fakeSelf = {
  ctx: { loader: { internal: undefined } },
  pkgMeta: new Map(),
  sourceKey: (name, base) => `${name}\0${base}`,
}

const baseUrl = pathToFileURL(path.join(HOME, 'profiles', 'desktop', 'node_modules') + path.sep).href
const loaderName = PLUGIN

console.log('\n--- locatePkgJson ---')
let located
try {
  located = proto.locatePkgJson.call(fakeSelf, loaderName, baseUrl)
  console.log(JSON.stringify(located, null, 2))
} catch (error) {
  console.log(`threw: ${error.message}`)
}

console.log('\n--- resolveMeta ---')
try {
  const meta = proto.resolveMeta.call(fakeSelf, loaderName, baseUrl)
  console.log(JSON.stringify(meta, null, 2))
} catch (error) {
  console.log(`threw: ${error.message}`)
}

// Independent shape check, in case the prototype call needs more state.
console.log('\n--- independent shape check ---')
const pkg = JSON.parse(fs.readFileSync(path.join(installed, 'package.json'), 'utf8'))
console.log(`name        = ${pkg.name}`)
console.log(`dsh.client  = ${JSON.stringify(pkg.dsh?.client)}`)
console.log(`exports[./client] = ${JSON.stringify(pkg.exports?.['./client'])}`)
const clientRel = pkg.exports?.['./client']
const clientPath = path.join(installed, typeof clientRel === 'string' ? clientRel : clientRel?.default ?? '')
console.log(`client file = ${clientPath}`)
console.log(`exists      = ${fs.existsSync(clientPath)}`)
if (fs.existsSync(clientPath)) {
  const text = fs.readFileSync(clientPath, 'utf8')
  const id = /__ModuleLoader__\.load\(\{\s*id:\s*"([^"]+)"/.exec(text)?.[1]
  console.log(`bundle id   = ${id}`)
  console.log(`id matches  = ${id === pkg.name}`)
}

const ok = located !== undefined
  && pkg.dsh?.client?.platform === 'web'
  && fs.existsSync(clientPath)
  && /__ModuleLoader__\.load/.test(fs.readFileSync(clientPath, 'utf8'))

console.log(ok ? '\nREGISTRY PROBE OK' : '\nREGISTRY PROBE FAILED')
process.exit(ok ? 0 : 1)
