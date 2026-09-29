/**
 * Validate this package's client declaration against the host's own scanner.
 *
 * Rather than trusting a reading of the docs, this imports the host's real
 * `dsh-client-modules` helper and asks it to resolve our `dsh.client` block and
 * `exports["./client"]` exactly as the boot scan would.
 *
 *   node test/client-declaration.test.mjs
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const APP = 'D:/DSH/DSH Desktop/resources/app/node_modules'

let failures = 0
const check = (label, condition, detail) => {
  if (condition) console.log(`  ok   ${label}`)
  else { console.log(`  FAIL ${label}${detail === undefined ? '' : ` — ${detail}`}`); failures += 1 }
}

const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
console.log(`package: ${pkg.name}`)

console.log('\ndsh.client declaration:')
check('declares dsh.client', pkg.dsh?.client !== undefined, JSON.stringify(pkg.dsh?.client))
check('platform is web', pkg.dsh?.client?.platform === 'web', String(pkg.dsh?.client?.platform))

// The host rejects a declaration whose exports lack ./client.
console.log('\nexports["./client"]:')
const clientExport = pkg.exports?.['./client']
check('exports "./client"', clientExport !== undefined, JSON.stringify(clientExport))
const rel = typeof clientExport === 'string' ? clientExport : clientExport?.default
check('resolves to a relative path string', typeof rel === 'string', String(rel))
const clientFile = path.join(root, rel ?? '')
check('that file exists', fs.existsSync(clientFile), clientFile)

// Ask the host's own resolver to do the work.
console.log('\nhost scanner:')
try {
  const mod = await import(`file:///${APP}/@deepseek-ai/dsh-client-modules/lib/index.js`)
  const { orderByModuleGraph, stripClientSuffix } = mod

  // The real gate: the host composes the boot graph with this function, and it
  // rejects a row that requests itself or creates a cycle. Running our own row
  // through it is the closest thing to a boot without booting.
  if (typeof orderByModuleGraph === 'function') {
    const row = {
      id: pkg.name,
      url: `/plugins/${pkg.name}/client.js`,
      rev: 'test',
      external: [],
      inject: [],
    }
    const ordered = orderByModuleGraph([row])
    check('orderByModuleGraph accepts our row', ordered.length === 1 && ordered[0].id === pkg.name)
  } else {
    console.log('  (orderByModuleGraph not exported)')
  }
  if (typeof stripClientSuffix === 'function') {
    check('stripClientSuffix maps "<pkg>/client" to the bare id',
      stripClientSuffix(`${pkg.name}/client`) === pkg.name)
  }
} catch (error) {
  console.log(`  could not import host scanner (${error.message})`)
  failures += 1
}

// The bundle must register itself under the package name the host keys rows by.
console.log('\nbundle registration id:')
const bundle = fs.readFileSync(clientFile, 'utf8')
const idMatch = /__ModuleLoader__\.load\(\{\s*id:\s*"([^"]+)"/.exec(bundle)
check('bundle declares an id', idMatch !== null)
check('bundle id equals the package name', idMatch?.[1] === pkg.name, `${idMatch?.[1]} vs ${pkg.name}`)

// The host plugin entry id must match what the client half looks for.
console.log('\ncordis patch entry id:')
const patch = fs.readFileSync(path.join(root, 'cordis.patch.yml'), 'utf8')
const entryId = /- id:\s*(\S+)/.exec(patch)?.[1]
check('patch declares an entry id', entryId !== undefined, String(entryId))
const clientSource = fs.readFileSync(path.join(root, 'src', 'client', 'index.js'), 'utf8')
const declared = /const ENTRY_ID = '([^']+)'/.exec(clientSource)?.[1]
check('client ENTRY_ID matches the patch entry id', declared === entryId, `${declared} vs ${entryId}`)

console.log(failures === 0 ? '\nCLIENT DECLARATION OK' : `\nCLIENT DECLARATION FAILED (${failures})`)
process.exit(failures === 0 ? 0 : 1)
