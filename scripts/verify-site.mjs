/**
 * SITE VERIFIER // loads the built _site/ the way GitHub Pages will.
 *
 *   npm run verify:pages      (requires a global playwright)
 *
 * Serves _site/ under PAGES_BASE so absolute asset URLs resolve exactly as
 * they do on genpozi.github.io/starship-hud/, then asserts the landing page
 * renders and the HUD demo boots into its offline simulation with no page
 * errors.
 */
import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join, normalize, extname } from 'node:path'
import { createRequire } from 'node:module'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SITE = join(ROOT, '_site')
const BASE = process.env.PAGES_BASE || '/starship-hud/'
const PORT = Number(process.env.VERIFY_PORT || 8096)

const require = createRequire(import.meta.url)
const { chromium } = require('playwright')

const TYPES = {
  '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.webm': 'video/webm',
  '.json': 'application/json', '.ico': 'image/x-icon'
}

const server = createServer(async (req, res) => {
  let url = decodeURIComponent((req.url || '/').split('?')[0])
  if (url.startsWith(BASE)) url = url.slice(BASE.length - 1)
  if (url.endsWith('/')) url += 'index.html'
  const file = join(SITE, normalize(url).replace(/^(\.\.[/\\])+/, ''))
  try {
    const info = await stat(file)
    if (info.isDirectory()) throw new Error('dir')
    const body = await readFile(file)
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' })
    res.end(body)
  } catch {
    res.writeHead(404).end('not found')
  }
})

await new Promise((r) => server.listen(PORT, r))
const origin = `http://127.0.0.1:${PORT}`
console.log(`verify: serving ${SITE} at ${origin}${BASE}`)

const browser = await chromium.launch()
const results = []
const pass = (name, cond) => results.push(`${cond ? 'PASS' : 'FAIL'} ${name}`)

// --- landing page ---
{
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  const errs = []
  const bad = []
  page.on('pageerror', (e) => errs.push(String(e)))
  page.on('response', (r) => { if (r.status() >= 400) bad.push(r.url()) })
  await page.goto(`${origin}${BASE}`, { waitUntil: 'networkidle' })
  for (const sel of ['#capabilities', '#integrations', '#gallery', '#architecture', '#quickstart']) {
    pass(`landing has ${sel}`, (await page.locator(sel).count()) === 1)
  }
  pass('landing shows 12 gallery thumbnails', (await page.locator('.gallery .shot').count()) === 12)
  pass('landing has no page errors', errs.length === 0)
  pass('landing has no broken asset responses', bad.length === 0)
  pass('landing has no unstamped placeholders', !(await page.content()).includes('{{'))
  await page.close()
}

// --- HUD demo ---
{
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  const errs = []
  page.on('pageerror', (e) => errs.push(String(e)))
  await page.goto(`${origin}${BASE}demo/`, { waitUntil: 'load' })
  await page.waitForFunction(
    () => document.querySelector('#system-status')?.textContent?.match(/NOMINAL|OFFLINE SIM/),
    null,
    { timeout: 30000 }
  )
  const status = (await page.textContent('#system-status')) || ''
  pass('demo reaches a live status line', /NOMINAL|OFFLINE SIM/.test(status))
  pass('demo has no page errors', errs.length === 0)
  console.log(`demo status: ${status.trim()}`)
  await page.close()
}

await browser.close()
server.close()

console.log(results.join('\n'))
const fails = results.filter((r) => r.startsWith('FAIL'))
console.log(fails.length ? `\n${fails.length} FAILURES` : '\nALL PASS')
process.exit(fails.length ? 1 : 0)
