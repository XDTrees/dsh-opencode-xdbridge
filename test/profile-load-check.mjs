/**
 * Validate a DSH profile through the desktop app's own bundle loader.
 *
 * This is the same code path the app runs at startup, so it catches a broken
 * bundle entry, a failed resolution, or a compatibility gate before a restart.
 *
 *   node test/profile-load-check.mjs [profileName] [homeDir]
 *
 * Defaults target the profile this machine actually runs.
 */

import path from 'node:path'
import fs from 'node:fs'
import { loadProfile, readProfileManifest } from 'file:///D:/DSH/DSH%20Desktop/resources/app/node_modules/@deepseek-ai/dsh-app-boot/lib/index.js'

const installAnchor = 'D:\\DSH\\DSH Desktop\\resources\\app\\package.json'

/**
 * Candidate Harness homes, most-likely first.
 *
 * A machine can carry more than one (an older `~/.dsh` beside the active
 * `dsh-home`), and editing the wrong one is exactly how a plugin appears
 * "installed" while the running app never sees it.
 */
const CANDIDATES = [
  process.argv[3],
  process.env.DSH_HOME,
  'D:\\deep seek harness\\dsh-home',
  path.join(process.env.USERPROFILE ?? '', '.dsh'),
].filter(Boolean)

const home = CANDIDATES.find(candidate => fs.existsSync(path.join(candidate, 'profiles')))
if (home === undefined) {
  console.error(`no Harness home found; tried:\n${CANDIDATES.join('\n')}`)
  process.exit(1)
}
const profileName = process.argv[2] ?? 'desktop'
const profileDir = path.join(home, 'profiles', profileName)

console.log(`home    = ${home}`)
console.log(`profile = ${profileDir}\n`)

const manifest = readProfileManifest('dsh', profileDir)
console.log('profile bundles:', JSON.stringify(manifest.dsh?.profile?.bundles, null, 2))

const profile = loadProfile('dsh', profileName, installAnchor, home, { userLayer: false })

console.log('\nloaded layers:')
for (const layer of profile.layers) console.log(`  ${layer.packageName}`)

console.log('\nskipped bundles:')
if (profile.skippedBundles.length === 0) console.log('  (none)')
for (const skipped of profile.skippedBundles) {
  console.log(`  ${skipped.packageName}: ${skipped.reason.slice(0, 400)}`)
}

const loaded = profile.layers.map(l => l.packageName)
const wanted = process.env.EXPECT_BUNDLE ?? 'dsh-opencode-xdbridge'
const ok = loaded.includes(wanted) && profile.skippedBundles.length === 0
console.log(ok ? `\nPROFILE LOAD OK (${wanted} present)` : `\nPROFILE LOAD FAILED (want ${wanted})`)
process.exit(ok ? 0 : 1)
