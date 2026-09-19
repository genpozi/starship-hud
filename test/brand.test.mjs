/**
 * BRAND SUITE // Landing-page token parity + claim truthfulness.
 *
 * Guards that site/tokens.css mirrors src/style.css and that the README,
 * CI, and PR template advertise the real suite count.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(join(ROOT, p), 'utf-8')

const results = []
const pass = (name, cond) => results.push(`${cond ? 'PASS' : 'FAIL'} ${name}`)

/** Extract `--name: value;` pairs from the first :root block. */
function rootTokens(css) {
  const start = css.indexOf(':root')
  if (start === -1) return {}
  const open = css.indexOf('{', start)
  const close = css.indexOf('}', open)
  const body = css.slice(open + 1, close)
  const out = {}
  const re = /--([a-z0-9-]+)\s*:\s*([^;]+);/gi
  let m
  while ((m = re.exec(body))) out[m[1]] = m[2].replace(/\s+/g, ' ').trim()
  return out
}

// --- token parity -----------------------------------------------------------
const appTokens = rootTokens(read('src/style.css'))
const siteTokens = rootTokens(read('site/tokens.css'))
const missing = Object.keys(appTokens).filter((k) => !(k in siteTokens))
const drifted = Object.keys(appTokens).filter(
  (k) => k in siteTokens && siteTokens[k] !== appTokens[k]
)
pass('tokens.css parses a full token set', Object.keys(siteTokens).length > 20)
pass('tokens.css mirrors every app token', missing.length === 0)
pass('tokens.css has no drifted values', drifted.length === 0)
pass('tokens.css has no extra tokens', Object.keys(siteTokens).length === Object.keys(appTokens).length)

// --- suite count ------------------------------------------------------------
const runner = read('test/run-all.mjs')
const suitesMatch = runner.match(/const SUITES = \[([\s\S]*?)\]/)
const suiteCount = suitesMatch ? (suitesMatch[1].match(/'[^']+'/g) || []).length : 0
pass('suite count is discoverable', suiteCount > 0)

const readme = read('README.md')
pass(
  `README states the real suite count (${suiteCount})`,
  readme.includes(`${suiteCount} headless suites`) &&
    readme.includes(`tests-${suiteCount}%20suites`)
)
pass('README does not hardcode a stale count', !/19 headless suites/.test(readme))

const ci = read('.github/workflows/ci.yml')
pass('CI does not hardcode a suite count', !/all \d+ suites/.test(ci))

const prTemplate = read('.github/PULL_REQUEST_TEMPLATE.md')
pass('PR template does not hardcode a suite count', !/all \d+ suites/.test(prTemplate))

const contributing = read('CONTRIBUTING.md')
pass('CONTRIBUTING does not hardcode a suite count', !/all \d+ suites/.test(contributing))

// --- brand + gallery assets -------------------------------------------------
function pngSize(p) {
  const buf = readFileSync(join(ROOT, p))
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) }
}

pass('banner.svg source exists', existsSync(join(ROOT, 'assets/brand/banner.svg')))
pass('mark.svg source exists', existsSync(join(ROOT, 'assets/brand/mark.svg')))

const banner = pngSize('assets/brand/banner.png')
pass('banner.png is a wide 2x render', banner.w === 2560 && banner.h === 720)
const social = pngSize('assets/brand/social-preview.png')
pass('social-preview.png is 1280x640', social.w === 1280 && social.h === 640)

const shots = readdirSync(join(ROOT, 'assets/screenshots')).filter((f) => f.endsWith('.png'))
pass('12 gallery screenshots present', shots.length === 12)
const badThumbs = shots.filter((f) => {
  const p = `assets/screenshots/thumbs/${f}`
  try {
    return pngSize(p).w !== 720
  } catch {
    return true
  }
})
pass('every screenshot has a 720px thumbnail', badThumbs.length === 0)

// --- claim truthfulness -----------------------------------------------------
pass(
  'README does not claim zero audit vulns',
  !/0(%20|\s)audit(%20|\s)vulns/i.test(readme)
)
pass('README does not claim production-ready status', !/status-production/i.test(readme))
pass('README links the live demo', readme.includes('genpozi.github.io/starship-hud'))
pass(
  'landing page labels the offline simulation',
  /offline simulation/i.test(read('site/index.html'))
)

console.log(results.join('\n'))
const fails = results.filter((r) => r.startsWith('FAIL'))
console.log(fails.length ? `\n${fails.length} FAILURES` : '\nALL PASS')
process.exit(fails.length ? 1 : 0)
