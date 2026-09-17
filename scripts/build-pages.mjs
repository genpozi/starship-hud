/**
 * PAGES BUILDER // assembles _site/ for GitHub Pages.
 *
 *   npm run build:pages
 *
 * Layout produced:
 *   _site/index.html   landing page      -> /starship-hud/
 *   _site/demo/        real HUD (Vite)   -> /starship-hud/demo/
 *   _site/assets/      brand + captures
 *
 * The demo base is derived because this is a project Pages site served from a
 * subpath, not a domain root. Override with PAGES_BASE.
 */
import { cpSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { spawnSync } from 'node:child_process'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SITE = join(ROOT, '_site')
const TMP = join(ROOT, '.pages-tmp')
const BASE = process.env.PAGES_BASE || '/starship-hud/'
const DEMO_URL = `${BASE}demo/`
const REPO_URL = 'https://github.com/genpozi/starship-hud'
const VERSION = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf-8')).version

// suite count is authoritative in test/run-all.mjs
const runner = readFileSync(join(ROOT, 'test', 'run-all.mjs'), 'utf-8')
const suitesMatch = runner.match(/const SUITES = \[([\s\S]*?)\]/)
const SUITES = (suitesMatch[1].match(/'[^']+'/g) || []).length

// 1. clean
rmSync(SITE, { recursive: true, force: true })
rmSync(TMP, { recursive: true, force: true })

// 2. build the HUD with the derived base
const vite = join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js')
const build = spawnSync(
  process.execPath,
  [vite, 'build', '--base', DEMO_URL, '--outDir', TMP, '--emptyOutDir'],
  { cwd: ROOT, stdio: 'inherit' }
)
if (build.status !== 0) {
  console.error('pages: vite build failed')
  process.exit(1)
}

// 3. landing page -> _site/
mkdirSync(SITE, { recursive: true })
cpSync(join(ROOT, 'site'), SITE, { recursive: true })

// 4. built HUD -> _site/demo/
cpSync(TMP, join(SITE, 'demo'), { recursive: true })

// 5. shared assets -> _site/assets/
for (const dir of ['brand', 'screenshots', 'video']) {
  const from = join(ROOT, 'assets', dir)
  if (existsSync(from)) cpSync(from, join(SITE, 'assets', dir), { recursive: true })
}

// 6. stamp placeholders
const landing = join(SITE, 'index.html')
let html = readFileSync(landing, 'utf-8')
html = html
  .replaceAll('{{DEMO_URL}}', DEMO_URL)
  .replaceAll('{{REPO_URL}}', REPO_URL)
  .replaceAll('{{VERSION}}', VERSION)
  .replaceAll('{{SUITES}}', String(SUITES))
writeFileSync(landing, html)

rmSync(TMP, { recursive: true, force: true })

console.log(`pages: built _site/  version=${VERSION}  suites=${SUITES}  demo=${DEMO_URL}`)
console.log('pages: serve locally with  npm run preview:pages')
