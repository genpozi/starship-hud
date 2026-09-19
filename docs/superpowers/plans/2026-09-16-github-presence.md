# GitHub Presence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give STELLARIS-7 a premium, honest GitHub presence — a blueprint-branded README plus a GitHub Pages landing page with a live interactive HUD demo.

**Architecture:** The landing page is plain hand-authored HTML/CSS in `site/`, sharing the HUD's design tokens via a mirrored `site/tokens.css`. The HUD demo is the existing SPA built by Vite with a derived `base` path. A stdlib-only Node script (`scripts/build-pages.mjs`) assembles both into `_site/`, and a thin GitHub Actions workflow deploys it. Playwright is authoring-time only and never ships.

**Tech Stack:** Node 20+ stdlib, Vite 7 (existing), vanilla HTML/CSS/JS, GitHub Actions Pages actions, Playwright (global, authoring-time and local-verification only).

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-09-16-github-presence-design.md`.
- **No new runtime or dev dependencies.** `package.json` `dependencies` stays `express`, `three`, `ws`; `devDependencies` stays `vite`. Do not add Playwright or any image library.
- **`npm test` and `npm run build` must be green at the end of every task.** Test assertions must be introduced in the same task as the artifact they assert, never earlier.
- **Adding the `brand` suite takes the count from 19 to 20.** The count is authoritative in `test/run-all.mjs`; prose elsewhere must stop hardcoding it.
- **Design tokens are authoritative in `src/style.css`.** Never edit token values to match the site; the site mirrors the app.
- **Pages base path is derived, never hardcoded.** Default `/starship-hud/`, overridable with `PAGES_BASE`.
- **Simulation must be labeled.** Any surface showing the HUD without an orbit server must say it is an offline simulation on seed data.
- **No emoji characters** anywhere in created files (repository rule).
- **Copy tone:** honest framing. No claim may exceed what the repository can demonstrate. Never describe the demo as a live service or a real starship.
- **Fonts:** Orbitron (display), Rajdhani (UI), Share Tech Mono (data) — same three as `index.html:11`.
- **Real HUD tokens:** `--cyan: #00f0ff`, `--amber: #ffb347`, `--ok: #39ff88`, `--crit: #ff4d5e`, `--bg: #05070c`, `--bg-deep: #02040c`, `--text-main: #d8faff`, `--text-dim: #6fb8cc`.
- **Test file style:** PASS/FAIL strings collected in `results`, printed, `process.exit(fails.length ? 1 : 0)`. Follow `test/vault.test.mjs`.
- **Commits:** conventional style, matching existing history.
- **`CHANGELOG.md:51` is historical** — it describes the 2.2.0 cut when there were 19 suites. Do not rewrite it.

---

### Task 1: Token mirror, brand test, and suite-count truth

Adds the 20th suite, so this task also removes every stale hardcoded suite count. After this task `npm test` is green at 20 suites.

**Files:**
- Create: `site/tokens.css`
- Create: `test/brand.test.mjs`
- Modify: `test/run-all.mjs` (append `'brand'` to `SUITES`)
- Modify: `README.md:15`, `README.md:206`, `README.md:253`
- Modify: `.github/workflows/ci.yml:28`
- Modify: `.github/PULL_REQUEST_TEMPLATE.md:15`
- Modify: `docs/CONTEXT.md:23`, `docs/DEVELOPER.md:267`, `docs/DEVELOPER.md:283`, `docs/DEPLOYMENT.md:102`

**Interfaces:**
- Consumes: nothing.
- Produces: `site/tokens.css`, a mirror of the `:root` custom properties from `src/style.css`. `test/brand.test.mjs` runs standalone via `node test/brand.test.mjs`, and becomes suite 20.

**Key fact:** the `:root` block in `src/style.css` is lines 15–93 and contains no nested braces, so extracting from `:root {` to the next `}` is safe.

- [ ] **Step 1: Create `site/tokens.css`**

An exact copy of all 62 custom properties from the `src/style.css` `:root` block (lines 15–93), including the JS-facing aliases, so the parity check is a true mirror. The parser was verified against `src/style.css` and finds 62 tokens:

```css
/* ============================================================================
   STELLARIS-7 // GH-PAGES DESIGN TOKENS
   Mirrored from src/style.css :root — that file is authoritative.
   test/brand.test.mjs fails if these drift.
   ============================================================================ */
:root {
  /* palette */
  --cyan: #00f0ff;
  --cyan-dim: rgba(0, 240, 255, 0.35);
  --cyan-hi: #7df9ff;
  --amber: #ffb347;
  --amber-dim: rgba(255, 179, 71, 0.35);
  --amber-hi: #ffd28a;
  --magenta: #ff4fd8;
  --magenta-dim: rgba(255, 79, 216, 0.35);
  --ok: #39ff88;
  --ok-dim: rgba(57, 255, 136, 0.4);
  --warn: #ffb347;
  --crit: #ff4d5e;
  --crit-dim: rgba(255, 77, 94, 0.4);

  /* surfaces */
  --bg: #05070c;
  --bg-deep: #02040c;
  --panel-bg: rgba(8, 14, 22, 0.78);
  --panel-bg-dim: rgba(8, 14, 22, 0.55);
  --panel-bg-solid: rgba(6, 12, 20, 0.94);
  --panel-bg-bleed: rgba(0, 240, 255, 0.04);
  --tbl-head-bg: rgba(6, 12, 20, 0.97);
  --border-alpha: 0.16;
  --panel-border: rgba(0, 240, 255, var(--border-alpha));
  --panel-border-strong: rgba(0, 240, 255, 0.4);
  --track-bg: rgba(111, 184, 204, 0.15);
  --divider: rgba(111, 184, 204, 0.12);

  /* text */
  --text-main: #d8faff;
  --text-dim: #6fb8cc;
  --text-faint: #3d6b7a;

  /* glow system */
  --glow-cyan: 0 0 6px rgba(0, 240, 255, 0.55), 0 0 14px rgba(0, 240, 255, 0.28), 0 0 26px rgba(0, 240, 255, 0.12);
  --glow-cyan-soft: 0 0 4px rgba(0, 240, 255, 0.4), 0 0 10px rgba(0, 240, 255, 0.2), 0 0 18px rgba(0, 240, 255, 0.08);
  --glow-amber: 0 0 6px rgba(255, 179, 71, 0.55), 0 0 14px rgba(255, 179, 71, 0.28), 0 0 26px rgba(255, 179, 71, 0.12);
  --glow-ok: 0 0 6px rgba(57, 255, 136, 0.5), 0 0 14px rgba(57, 255, 136, 0.25), 0 0 26px rgba(57, 255, 136, 0.1);
  --glow-crit: 0 0 6px rgba(255, 77, 94, 0.55), 0 0 14px rgba(255, 77, 94, 0.28), 0 0 26px rgba(255, 77, 94, 0.12);
  --shadow-panel: 0 0 0 1px rgba(0, 240, 255, 0.05), 0 0 22px rgba(0, 240, 255, 0.07), inset 0 0 26px rgba(0, 240, 255, 0.045);

  /* type */
  --font-display: 'Orbitron', 'Segoe UI', sans-serif;
  --font-ui: 'Rajdhani', 'Segoe UI', sans-serif;
  --font-mono: 'Share Tech Mono', 'Courier New', monospace;
  --tracking-label: 0.14em;
  --tracking-wide: 0.2em;

  /* geometry */
  --cut-sm: 6px;
  --cut-md: 10px;
  --cut-lg: 14px;
  --frame-inset: 2px;
  --blur: 2px;
  --gap: 10px;

  /* spacing scale */
  --sp-1: 4px;
  --sp-2: 8px;
  --sp-3: 12px;
  --sp-4: 16px;
  --sp-5: 20px;
  --sp-6: 24px;

  /* motion */
  --ease-out: cubic-bezier(0.65, 0, 0.35, 1);
  --dur-fast: 0.2s;
  --dur-data: 0.4s;
  --scan-time: 9s;

  /* aliases — referenced by JS inline styles (main.js / views.js) */
  --line-cyan: var(--cyan);
  --line-cyan-dim: var(--cyan-dim);
  --line-amber: var(--amber);
  --line-amber-dim: var(--amber-dim);
  --line-magenta: var(--magenta);
  --bg-panel: var(--panel-bg);
  --bg-panel-solid: var(--panel-bg-solid);
}
```

- [ ] **Step 2: Write `test/brand.test.mjs`**

This task's version covers token parity and suite-count truth only. Later tasks append their own assertions.

```js
/**
 * BRAND SUITE // Landing-page token parity + claim truthfulness.
 *
 * Guards that site/tokens.css mirrors src/style.css and that the README,
 * CI, and PR template advertise the real suite count.
 */
import { readFileSync } from 'node:fs'
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

// --- suite count ------------------------------------------------------------
const runner = read('test/run-all.mjs')
const suitesMatch = runner.match(/const SUITES = \[([\s\S]*?)\]/)
const suiteCount = (suitesMatch[1].match(/'[^']+'/g) || []).length
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

console.log(results.join('\n'))
const fails = results.filter((r) => r.startsWith('FAIL'))
console.log(fails.length ? `\n${fails.length} FAILURES` : '\nALL PASS')
process.exit(fails.length ? 1 : 0)
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `node test/brand.test.mjs`
Expected: FAIL, because `README.md` still says `19 headless suites` while `SUITES` has 19 entries and the badge says `tests-19%20suites`. The token-parity lines should already PASS.

- [ ] **Step 4: Register the suite**

In `test/run-all.mjs`, append `'brand'` so the array ends:

```js
const SUITES = ['hermes', 'hermes-ingest', 'phase4', 'github', 'planner', 'skills', 'chat', 'regression', 'views', 'superstep', 'channels', 'checkpoints', 'interrupt', 'trace', 'comms', 'cli', 'operators', 'vault', 'integration', 'brand']
```

Add a line to the suite comment block at the top of the same file:

```js
 *   brand        — landing tokens parity + suite-count truthfulness
```

- [ ] **Step 5: Update the README's two suite-count references**

`README.md:15` — change the tests badge to:

```html
  <img src="https://img.shields.io/badge/tests-20%20suites-39ff88" alt="tests"/>
```

`README.md:206` — change:

```markdown
19 headless suites, each isolated with a fresh `STELLARIS_DATA_DIR` and a fresh Hermes mock:
```
to:
```markdown
20 headless suites, each isolated with a fresh `STELLARIS_DATA_DIR` and a fresh Hermes mock:
```

`README.md:253` — remove the number so it cannot drift:

```markdown
├── test/                 # suites + run-all.mjs (fresh mock per suite)
```

Also add a row to the suite table in the Testing section:

```markdown
| `brand` | landing token parity, suite-count truth, brand asset sizes |
```

- [ ] **Step 6: Remove hardcoded counts elsewhere**

`.github/workflows/ci.yml:28`:
```yaml
      - name: Test suite
```

`.github/PULL_REQUEST_TEMPLATE.md:15`:
```markdown
- [ ] `npm test` green (all suites)
```

`docs/CONTEXT.md:23`:
```markdown
- `npm test` (all suites) and `npm run build` stay green.
```

`docs/DEVELOPER.md:267`:
```markdown
# run-all.mjs → fresh mock on :8788 → all suites
```

`docs/DEVELOPER.md:283` — replace the suite list sentence with:

```markdown
- The suites: `hermes`, `hermes-ingest`, `phase4`, `github`, `planner`,
```

and append `brand` to the end of that enumeration.

`docs/DEPLOYMENT.md:102`:
```markdown
# all suites (isolated STELLARIS_DATA_DIR + fresh Hermes mock)
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `node test/brand.test.mjs`
Expected: `ALL PASS`.

- [ ] **Step 8: Run the full suite**

Run: `npm test`
Expected: 20 suites, `OVERALL: ALL SUITES GREEN`.

- [ ] **Step 9: Commit**

```bash
git add site/tokens.css test/brand.test.mjs test/run-all.mjs README.md \
  .github/workflows/ci.yml .github/PULL_REQUEST_TEMPLATE.md \
  docs/CONTEXT.md docs/DEVELOPER.md docs/DEPLOYMENT.md
git commit -m "test(brand): enforce site token parity and truthful suite counts"
```

---

### Task 2: Brand assets and gallery thumbnails

**Files:**
- Create: `assets/brand/mark.svg`, `assets/brand/banner.svg`, `scripts/render-brand.mjs`
- Generate (committed): `assets/brand/banner.png`, `assets/brand/social-preview.png`, `assets/screenshots/thumbs/*.png` (12)
- Modify: `test/brand.test.mjs` (append asset assertions)

**Interfaces:**
- Consumes: the cyan `#00f0ff` / amber `#ffb347` tokens mirrored in Task 1.
- Produces: the committed assets that Task 3's landing page references by path, and that this task's appended assertions verify.

**Important:** the banner deliberately carries **no test counts or pass ratios**, so it cannot go stale. `scripts/render-brand.mjs` requires a globally installed Playwright and is authoring-time only; its outputs are committed so CI never needs Playwright.

- [ ] **Step 1: Create `assets/brand/mark.svg`**

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32" role="img" aria-label="STELLARIS-7 emblem">
  <path d="M16 2l3 9 9 3-9 3-3 9-3-9-9-3 9-3z" fill="#00f0ff" fill-opacity="0.9"/>
</svg>
```

- [ ] **Step 2: Create `assets/brand/banner.svg`**

1280x360 dual-tone blueprint: cyan grid, corner brackets, and wordmark; amber figure label and annotation rule.

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 360" width="1280" height="360" role="img" aria-label="STELLARIS-7 Starship HUD Mission Control">
  <defs>
    <pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse">
      <path d="M20 0H0V20" fill="none" stroke="#00f0ff" stroke-opacity="0.07" stroke-width="1"/>
    </pattern>
    <linearGradient id="rule" x1="0" x2="1">
      <stop offset="0" stop-color="#00f0ff"/>
      <stop offset="0.55" stop-color="#ffb347"/>
      <stop offset="1" stop-color="#ffb347" stop-opacity="0"/>
    </linearGradient>
    <style>
      .fig { font: 400 13px 'Share Tech Mono', monospace; letter-spacing: .22em; fill: #6fb8cc; }
      .fig-a { fill: #ffb347; }
      .word { font: 700 54px 'Orbitron', sans-serif; letter-spacing: .10em; fill: #d8faff; }
      .sub { font: 400 15px 'Share Tech Mono', monospace; letter-spacing: .14em; fill: #00f0ff; }
      .note { font: 400 13px 'Share Tech Mono', monospace; fill: #8fd4e2; }
      .note-a { fill: #d6bd93; }
    </style>
  </defs>

  <rect width="1280" height="360" fill="#02040c"/>
  <rect width="1280" height="360" fill="url(#grid)"/>

  <g stroke="#00f0ff" stroke-width="2" fill="none">
    <path d="M2 30V2h28"/><path d="M1250 2h28v28"/>
    <path d="M1278 330v28h-28"/><path d="M30 358H2v-28"/>
  </g>

  <text class="fig" x="48" y="72">FIG. 01 &#8212; <tspan class="fig-a">SYSTEM OVERVIEW</tspan></text>

  <text class="word" x="48" y="152">STELLARIS-7</text>
  <text class="sub" x="48" y="186">STARSHIP HUD MISSION CONTROL</text>

  <rect x="48" y="212" width="1184" height="2" fill="url(#rule)"/>

  <g class="note">
    <text x="48" y="252">browser &#8596; orbit &#8596; planner &#8596; skills</text>
    <text class="note-a" x="48" y="278">WS snapshot/delta &#183; 12 views &#183; 6 agents &#183; offline-first</text>
  </g>

  <g font-family="'Share Tech Mono', monospace" font-size="13">
    <rect x="48" y="302" width="104" height="30" fill="#00f0ff"/>
    <text x="66" y="322" fill="#02040c">LAUNCH</text>
    <rect x="164" y="302" width="104" height="30" fill="none" stroke="#00f0ff" stroke-opacity="0.5"/>
    <text x="182" y="322" fill="#00f0ff">SOURCE</text>
    <rect x="280" y="302" width="132" height="30" fill="none" stroke="#39ff88" stroke-opacity="0.45"/>
    <text x="298" y="322" fill="#39ff88">&#9679; CI GATED</text>
  </g>

  <g fill="none" stroke="#ffb347" stroke-opacity="0.45" stroke-dasharray="5 5">
    <rect x="1006" y="112" width="226" height="132"/>
  </g>
  <text class="fig fig-a" x="1018" y="104">MODULE MAP</text>
  <g font-family="'Share Tech Mono', monospace" font-size="12" fill="#8fd4e2">
    <text x="1022" y="140">src/main.js &#8594; boot</text>
    <text x="1022" y="162">src/views.js &#8594; 12 views</text>
    <text x="1022" y="184">server/orchestrator.js</text>
    <text x="1022" y="206">data/state.json</text>
    <text x="1022" y="228" fill="#d6bd93">ws:// &#8230;/ws</text>
  </g>
</svg>
```

- [ ] **Step 3: Write `scripts/render-brand.mjs`**

```js
/**
 * BRAND RENDERER // authoring-time asset generation.
 *
 * Requires a GLOBAL playwright (never a project dependency):
 *   NODE_PATH=$(npm root -g) node scripts/render-brand.mjs
 *
 * Outputs (all committed, so CI never needs Playwright):
 *   assets/brand/banner.png            from assets/brand/banner.svg (2x)
 *   assets/brand/social-preview.png    composed 1280x640 card
 *   assets/screenshots/thumbs/*.png    720x450 gallery derivatives
 */
import { readFileSync, mkdirSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { createRequire } from 'node:module'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const { chromium } = require('playwright')

const FONTS =
  'https://fonts.googleapis.com/css2?family=Orbitron:wght@400;500;600;700;800;900&family=Rajdhani:wght@400;500;600;700&family=Share+Tech+Mono&display=swap'

async function settle(page) {
  await page.evaluate((href) => {
    const l = document.createElement('link')
    l.rel = 'stylesheet'
    l.href = href
    document.head.appendChild(l)
  }, FONTS)
  await page.waitForLoadState('networkidle')
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(300)
}

const bannerSvg = readFileSync(join(ROOT, 'assets/brand/banner.svg'), 'utf-8')
const browser = await chromium.launch()

// 1. banner.png at 2x so the README gets crisp baked fonts.
{
  const page = await browser.newPage({
    viewport: { width: 1280, height: 360 },
    deviceScaleFactor: 2
  })
  await page.setContent(
    `<body style="margin:0;background:#02040c">${bannerSvg}</body>`,
    { waitUntil: 'load' }
  )
  await settle(page)
  mkdirSync(join(ROOT, 'assets/brand'), { recursive: true })
  await page.screenshot({ path: join(ROOT, 'assets/brand/banner.png') })
  await page.close()
  console.log('wrote assets/brand/banner.png (2560x720)')
}

// 2. social-preview.png, 1280x640.
{
  const page = await browser.newPage({
    viewport: { width: 1280, height: 640 },
    deviceScaleFactor: 1
  })
  const scaled = bannerSvg.replace('width="1280" height="360"', 'width="1080" height="304"')
  await page.setContent(
    `<body style="margin:0;background:#02040c;display:flex;align-items:center;justify-content:center;height:640px"><div>${scaled}</div></body>`,
    { waitUntil: 'load' }
  )
  await settle(page)
  await page.screenshot({ path: join(ROOT, 'assets/brand/social-preview.png') })
  await page.close()
  console.log('wrote assets/brand/social-preview.png (1280x640)')
}

// 3. gallery thumbs at 720x450 (source captures are 1440x900).
{
  const src = join(ROOT, 'assets/screenshots')
  const out = join(src, 'thumbs')
  mkdirSync(out, { recursive: true })
  for (const f of readdirSync(src).filter((x) => x.endsWith('.png'))) {
    const data = readFileSync(join(src, f)).toString('base64')
    const page = await browser.newPage({
      viewport: { width: 720, height: 450 },
      deviceScaleFactor: 1
    })
    await page.setContent(
      `<body style="margin:0"><img src="data:image/png;base64,${data}" width="720" height="450" style="display:block"></body>`,
      { waitUntil: 'load' }
    )
    await page.screenshot({ path: join(out, f) })
    await page.close()
    console.log(`wrote assets/screenshots/thumbs/${f} (720x450)`)
  }
}

await browser.close()
console.log('brand render complete')
```

- [ ] **Step 4: Append asset assertions to `test/brand.test.mjs`**

Insert before the final `console.log(results.join('\n'))` line:

```js
// --- brand + gallery assets -------------------------------------------------
function pngSize(p) {
  const buf = readFileSync(join(ROOT, p))
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) }
}

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
```

Add the two imports this needs at the top of the file:

```js
import { existsSync, readFileSync, readdirSync } from 'node:fs'
```

and, alongside the existing `avatar`-style `pass` helper, a small existence check:

```js
pass('banner.svg source exists', existsSync(join(ROOT, 'assets/brand/banner.svg')))
pass('mark.svg source exists', existsSync(join(ROOT, 'assets/brand/mark.svg')))
```

- [ ] **Step 5: Run the test to verify the new assertions fail**

Run: `node test/brand.test.mjs`
Expected: FAIL on the asset lines (files do not exist yet). Token lines still PASS.

- [ ] **Step 6: Render the assets**

Run: `NODE_PATH=$(npm root -g) node scripts/render-brand.mjs`
Expected: `wrote assets/brand/banner.png (2560x720)`, `wrote assets/brand/social-preview.png (1280x640)`, 12 thumb lines, `brand render complete`.

If Playwright is unavailable:
```bash
npm i -g playwright && npx playwright install chromium && npx playwright install-deps chromium
```

- [ ] **Step 7: Verify and measure**

Run: `node test/brand.test.mjs`
Expected: `ALL PASS`.

Run: `du -sh assets/screenshots/thumbs assets/brand`
Expected: `thumbs` well under 3 MB total, the spec's gallery-payload target. Record the measured number; if it exceeds 3 MB, report it rather than claim the target was met.

- [ ] **Step 8: Run the full suite**

Run: `npm test`
Expected: 20 suites green.

- [ ] **Step 9: Commit**

```bash
git add assets/brand assets/screenshots/thumbs scripts/render-brand.mjs test/brand.test.mjs
git commit -m "feat(brand): add blueprint banner, social card, and gallery thumbnails"
```

---

### Task 3: Landing page

**Files:**
- Create: `site/index.html`, `site/style.css`, `site/app.js`

**Interfaces:**
- Consumes: `site/tokens.css` (Task 1) and the asset paths produced in Task 2.
- Produces: `site/index.html` containing the literal placeholders `{{DEMO_URL}}`, `{{REPO_URL}}`, `{{VERSION}}`, and `{{SUITES}}`, which Task 4's build script replaces.

**Copy rule:** the demo is the real HUD running in offline simulation on seed data. Say so.

- [ ] **Step 1: Write `site/index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>STELLARIS-7 // Starship HUD Mission Control</title>
    <meta name="description" content="STELLARIS-7 is a realtime starship HUD wrapping a real multi-agent orchestrator: superstep DAG scheduling, checkpoints, single-holder interrupt, and span traces over WebSocket. Runs fully offline." />
    <meta property="og:title" content="STELLARIS-7 // Starship HUD Mission Control" />
    <meta property="og:description" content="A real multi-agent orchestrator wrapped in a starship HUD. Runs fully offline; 12 live views." />
    <meta property="og:image" content="assets/brand/social-preview.png" />
    <meta property="og:type" content="website" />
    <link rel="icon" type="image/svg+xml" href="assets/brand/mark.svg" />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Orbitron:wght@400;500;600;700;800;900&family=Rajdhani:wght@400;500;600;700&family=Share+Tech+Mono&display=swap" rel="stylesheet" />
    <link rel="stylesheet" href="tokens.css" />
    <link rel="stylesheet" href="style.css" />
  </head>
  <body>
    <a class="skip" href="#main">Skip to content</a>

    <header class="nav">
      <span class="nav-brand">STELLARIS-7</span>
      <nav aria-label="Primary">
        <a href="#capabilities">Capabilities</a>
        <a href="#integrations">Integrations</a>
        <a href="#gallery">Gallery</a>
        <a href="#quickstart">Quickstart</a>
      </nav>
      <a class="btn btn-primary" href="{{DEMO_URL}}">Launch demo</a>
    </header>

    <main id="main">
      <section class="hero">
        <img class="hero-banner" src="assets/brand/banner.svg" alt="STELLARIS-7 blueprint banner: starship HUD mission control, module map, and status chips" width="1280" height="360" />
        <p class="hero-lede">
          A real multi-agent orchestrator &mdash; superstep DAG scheduling, checkpoints and
          rollback, single-holder interrupts, span-level traces &mdash; wrapped in a starship HUD
          with a live 3D galaxy. One Node orbit server owns the state; 12 views mirror it over
          WebSocket.
        </p>
        <p class="chips">
          <span class="chip chip-ok">v{{VERSION}}</span>
          <span class="chip">MIT</span>
          <span class="chip">{{SUITES}} test suites</span>
          <span class="chip chip-amber">runs fully offline</span>
        </p>
        <p class="cta">
          <a class="btn btn-primary" href="{{DEMO_URL}}">Launch live demo</a>
          <a class="btn" href="{{REPO_URL}}">View source</a>
        </p>
      </section>

      <section class="band">
        <p class="label">FIG. 00 &mdash; BEFORE YOU CLICK</p>
        <p>
          The demo is the <strong>real HUD</strong>, built and served as static files. With no
          orbit server reachable it falls back to its built-in <strong>offline simulation on seed
          data</strong> &mdash; every panel is live and clickable, but the numbers are synthetic.
          Run it locally with an orbit server to drive it for real.
        </p>
      </section>

      <section class="split" aria-labelledby="scope-heading">
        <h2 id="scope-heading">What it is, and what it isn't</h2>
        <div class="split-cols">
          <div class="panel panel-ok">
            <h3>What it is</h3>
            <ul>
              <li>A working orchestrator: six agents with state machines, retry policies, and typed tools.</li>
              <li>Superstep DAG scheduling &mdash; a step starts only when every dependency is complete.</li>
              <li>Real transport: WebSocket snapshot/delta with sequence numbers, gap detection, and resync.</li>
              <li>Checkpoints, rollback, single-holder interrupt, and span-level trace telemetry.</li>
              <li>A headless test suite per subsystem, including a full REST + WebSocket integration suite.</li>
              <li>Optional live integrations: GitHub, Hermes WebUI, an LLM planner, and Gmail/Graph/ICS/CalDAV comms.</li>
            </ul>
          </div>
          <div class="panel panel-amber">
            <h3>What it isn't</h3>
            <ul>
              <li>Not a hosted service. There is no account, no billing, and no cloud backend.</li>
              <li>Not a real starship. The HUD is a deliberate interface metaphor for observability.</li>
              <li>Not a distributed system. One orbit server process owns the state; it is single-node.</li>
              <li>Not an LLM product by default. The planner is a deterministic heuristic unless you supply a key.</li>
              <li>No IMAP/SMTP, no GitHub issue write-back, no binary attachment download.</li>
              <li>The demo is seed data, not your data.</li>
            </ul>
          </div>
        </div>
      </section>

      <section id="capabilities" aria-labelledby="cap-heading">
        <h2 id="cap-heading">Signature capabilities</h2>
        <p class="label">FIG. 02 &mdash; MECHANISMS</p>
        <div class="cards">
          <article class="card">
            <p class="card-fig">P8</p>
            <h3>Superstep DAG scheduling</h3>
            <p>Goals decompose into steps with <code>dependsOn</code> chains; a step is never dispatched until its dependencies complete.</p>
            <p class="src">server/planner.js</p>
          </article>
          <article class="card">
            <p class="card-fig">P10</p>
            <h3>Checkpoints and rollback</h3>
            <p>A boot-guard snapshot plus on-demand full-state captures in a capped ledger. SNAP and REWIND restore state and report which slices were reverted.</p>
            <p class="src">server/checkpoints.js</p>
          </article>
          <article class="card">
            <p class="card-fig">P11</p>
            <h3>Single-holder interrupt</h3>
            <p>Pause halts dispatch while in-flight steps finish. A second operator receives <code>409</code> until the holder resumes.</p>
            <p class="src">server/orchestrator.js</p>
          </article>
          <article class="card">
            <p class="card-fig">P12</p>
            <h3>Span traces</h3>
            <p>Every run and tool call records a span with duration and token accounting, streamed as typed events into the Health view.</p>
            <p class="src">server/trace.js</p>
          </article>
          <article class="card">
            <p class="card-fig">P9</p>
            <h3>Typed event channels</h3>
            <p>Non-state frames fold through client-side reducers. Unknown frame types are ignored, so a newer server never breaks an older client.</p>
            <p class="src">src/channels.js</p>
          </article>
          <article class="card">
            <p class="card-fig">P14</p>
            <h3>Filesystem knowledge vault</h3>
            <p>Markdown with front matter on disk. Writes hit the file first, then state; boot hydrates files back onto the state slice.</p>
            <p class="src">server/vault.js</p>
          </article>
        </div>
      </section>

      <section id="integrations" aria-labelledby="int-heading">
        <h2 id="int-heading">Optional live integrations</h2>
        <p class="label">FIG. 03 &mdash; OFF UNTIL YOU SUPPLY CREDENTIALS</p>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Source</th><th>What it syncs</th><th>Environment</th></tr></thead>
            <tbody>
              <tr><td>GitHub</td><td>Issues and PRs onto the kanban board, incremental via ETag and rate-limit guarded</td><td><code>GITHUB_TOKEN</code>, <code>GITHUB_OWNER</code>, <code>GITHUB_REPO</code></td></tr>
              <tr><td>Hermes WebUI</td><td>Real agent delegation, the approval bridge, and reverse ingestion of sessions and crons</td><td><code>USER_HERMES_URL</code>, <code>USER_HERMES_PASSWORD</code></td></tr>
              <tr><td>LLM planner</td><td>Goal decomposition into orchestrated steps, with a heuristic fallback</td><td><code>USER_LLM_API_KEY</code>, <code>USER_LLM_BASE_URL</code>, <code>USER_LLM_MODEL</code></td></tr>
              <tr><td>Email and calendar</td><td>Inbox and a seven-day week via Gmail, Microsoft Graph, ICS, CalDAV, or an inbound webhook</td><td><code>USER_COMMS_*</code>, <code>USER_GOOGLE_*</code>, <code>USER_MS_*</code>, <code>USER_ICS_*</code>, <code>USER_CALDAV_*</code></td></tr>
            </tbody>
          </table>
        </div>
        <p class="note">Credentials live in <code>.env</code> or <code>.stellaris.json</code>, both never committed. Missing credentials leave the corresponding view on its seed fallback.</p>
      </section>

      <section id="gallery" aria-labelledby="gal-heading">
        <h2 id="gal-heading">All twelve views</h2>
        <p class="label">FIG. 04 &mdash; CAPTURED LIVE, SEED DATA, 1440&times;900</p>
        <div class="gallery">
          <a class="shot" href="assets/screenshots/mission-control.png"><img src="assets/screenshots/thumbs/mission-control.png" alt="Mission Control rollup" loading="lazy" width="720" height="450"><span>Mission Control</span></a>
          <a class="shot" href="assets/screenshots/kanban.png"><img src="assets/screenshots/thumbs/kanban.png" alt="Kanban board" loading="lazy" width="720" height="450"><span>Kanban</span></a>
          <a class="shot" href="assets/screenshots/items.png"><img src="assets/screenshots/thumbs/items.png" alt="Open items" loading="lazy" width="720" height="450"><span>Open Items</span></a>
          <a class="shot" href="assets/screenshots/scheduler.png"><img src="assets/screenshots/thumbs/scheduler.png" alt="Scheduler" loading="lazy" width="720" height="450"><span>Scheduler</span></a>
          <a class="shot" href="assets/screenshots/chat.png"><img src="assets/screenshots/thumbs/chat.png" alt="Agent chat" loading="lazy" width="720" height="450"><span>Agent Chat</span></a>
          <a class="shot" href="assets/screenshots/graphs.png"><img src="assets/screenshots/thumbs/graphs.png" alt="Graphs and analytics" loading="lazy" width="720" height="450"><span>Graphs</span></a>
          <a class="shot" href="assets/screenshots/vault.png"><img src="assets/screenshots/thumbs/vault.png" alt="Vault and knowledge" loading="lazy" width="720" height="450"><span>Vault</span></a>
          <a class="shot" href="assets/screenshots/email.png"><img src="assets/screenshots/thumbs/email.png" alt="Email" loading="lazy" width="720" height="450"><span>Email</span></a>
          <a class="shot" href="assets/screenshots/calendar.png"><img src="assets/screenshots/thumbs/calendar.png" alt="Calendar" loading="lazy" width="720" height="450"><span>Calendar</span></a>
          <a class="shot" href="assets/screenshots/alerts.png"><img src="assets/screenshots/thumbs/alerts.png" alt="Alerts" loading="lazy" width="720" height="450"><span>Alerts</span></a>
          <a class="shot" href="assets/screenshots/health.png"><img src="assets/screenshots/thumbs/health.png" alt="System health and traces" loading="lazy" width="720" height="450"><span>System Health</span></a>
          <a class="shot" href="assets/screenshots/reports.png"><img src="assets/screenshots/thumbs/reports.png" alt="Research reports" loading="lazy" width="720" height="450"><span>Research Reports</span></a>
        </div>
        <details class="video">
          <summary>Walkthrough video (33s, webm)</summary>
          <video src="assets/video/walkthrough.webm" width="880" controls preload="metadata" loop></video>
        </details>
      </section>

      <section id="architecture" aria-labelledby="arch-heading">
        <h2 id="arch-heading">Architecture</h2>
        <p class="label">FIG. 05 &mdash; SINGLE SOURCE OF TRUTH</p>
        <pre class="diagram"><code>Browser (Vite SPA)                 Orbit server (Node, :3001)
+----------------------+    WS    +--------------------------------+
| src/main.js   boot   |&lt;--------&gt;| server/index.js   express + ws |
| src/store.js  state  |   /ws    | server/orchestrator.js  engine |
| src/views.js  views  |   REST   | server/planner.js  LLM/heuris. |
| src/api.js    bridge |  /api/*  | server/skills.js   tool reg.   |
| src/channels.js typed|          | server/trace.js    span tree   |
| src/galaxy.js 3D bg  |          | server/checkpoints.js snapshots |
| src/config.js seed   |          | server/store.js    persistence |
+----------------------+          | server/vault.js    md files    |
                                  | data/state.json + vault/*.md   |
                                  +--------------------------------+</code></pre>
        <p class="note">The orbit server owns canonical state. The browser mirrors it over WebSocket and mutates it over REST. If the server is unreachable the HUD switches to the offline simulation described above.</p>
      </section>

      <section id="quickstart" aria-labelledby="qs-heading">
        <h2 id="qs-heading">Quickstart</h2>
        <p class="label">FIG. 06 &mdash; NODE 20+, ZERO EXTERNAL SERVICES</p>
        <pre class="code"><code># 1. Install dependencies
npm install

# 2. Orbit server: REST + WebSocket on :3001, owns fleet state
npm run dev:server

# 3. In a second terminal: Vite dev server on :5173
npm run dev</code></pre>
        <p class="note">Production: <code>npm run build</code> then <code>npm start</code>. Or the packaged CLI: <code>npx stellaris-hud serve</code>.</p>
      </section>
    </main>

    <footer>
      <p class="label">STELLARIS-7 &mdash; MIT</p>
      <nav aria-label="Documentation">
        <a href="{{REPO_URL}}/blob/master/docs/MANUAL.md">Operator manual</a>
        <a href="{{REPO_URL}}/blob/master/docs/ARCHITECTURE.md">Architecture</a>
        <a href="{{REPO_URL}}/blob/master/docs/API.md">API</a>
        <a href="{{REPO_URL}}/blob/master/CHANGELOG.md">Changelog</a>
      </nav>
      <p class="note">A mission-control reference for observable, human-in-the-loop agent orchestration. The starship is a metaphor; the orchestration is real.</p>
    </footer>

    <script src="app.js" defer></script>
  </body>
</html>
```

- [ ] **Step 2: Write `site/style.css`**

```css
/* ============================================================================
   STELLARIS-7 // GH-PAGES LANDING
   Dual-tone blueprint built on the HUD tokens in tokens.css.
   ============================================================================ */

*, *::before, *::after { box-sizing: border-box; }

:root {
  --page-max: 1160px;
  --grid: linear-gradient(rgba(0, 240, 255, 0.06) 1px, transparent 1px),
          linear-gradient(90deg, rgba(0, 240, 255, 0.06) 1px, transparent 1px);
}

html { scroll-behavior: smooth; }

body {
  margin: 0;
  background-color: var(--bg-deep);
  background-image: var(--grid);
  background-size: 20px 20px;
  color: var(--text-main);
  font-family: var(--font-ui);
  font-size: 17px;
  line-height: 1.65;
  -webkit-font-smoothing: antialiased;
}

a { color: var(--cyan); }

:focus-visible { outline: 2px solid var(--cyan); outline-offset: 3px; }

.skip {
  position: absolute; left: -9999px; top: 0;
  background: var(--cyan); color: var(--bg-deep);
  padding: 10px 16px; z-index: 100;
}
.skip:focus { left: 12px; top: 12px; }

.label {
  font-family: var(--font-mono);
  font-size: 12px;
  letter-spacing: var(--tracking-wide);
  color: var(--text-dim);
  margin: 0 0 var(--sp-3);
}

h1, h2, h3 { font-family: var(--font-display); line-height: 1.2; margin: 0 0 var(--sp-3); }
h2 { font-size: 27px; letter-spacing: 0.06em; }
h3 { font-size: 18px; letter-spacing: 0.04em; }
p { margin: 0 0 var(--sp-4); }

code, pre { font-family: var(--font-mono); }

/* --- nav -------------------------------------------------------------- */
.nav {
  position: sticky; top: 0; z-index: 20;
  display: flex; align-items: center; gap: var(--sp-5);
  max-width: var(--page-max); margin: 0 auto;
  padding: var(--sp-3) var(--sp-5);
  background: var(--panel-bg-solid);
  border-bottom: 1px solid var(--panel-border);
  backdrop-filter: blur(var(--blur));
}
.nav-brand {
  font-family: var(--font-display); font-weight: 700;
  letter-spacing: 0.14em; color: var(--text-main);
  text-shadow: var(--glow-cyan-soft);
}
.nav nav { display: flex; gap: var(--sp-5); margin-left: auto; }
.nav nav a { color: var(--text-dim); text-decoration: none; font-size: 15px; }
.nav nav a:hover { color: var(--cyan); }

/* --- buttons ---------------------------------------------------------- */
.btn {
  display: inline-block;
  font-family: var(--font-mono); font-size: 13px;
  letter-spacing: var(--tracking-label);
  padding: 10px 18px; text-decoration: none;
  color: var(--cyan); background: transparent;
  border: 1px solid var(--panel-border-strong);
  clip-path: polygon(0 0, calc(100% - var(--cut-sm)) 0, 100% var(--cut-sm), 100% 100%, 0 100%);
  transition: background var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out);
}
.btn:hover { background: var(--panel-bg-bleed); box-shadow: var(--glow-cyan-soft); }
.btn-primary { background: var(--cyan); color: var(--bg-deep); border-color: var(--cyan); }
.btn-primary:hover { background: var(--cyan-hi); color: var(--bg-deep); }

/* --- layout ----------------------------------------------------------- */
main { max-width: var(--page-max); margin: 0 auto; padding: 0 var(--sp-5); }
section { padding: var(--sp-6) 0; border-bottom: 1px solid var(--divider); }

/* --- hero ------------------------------------------------------------- */
.hero { padding-top: var(--sp-6); }
.hero-banner {
  width: 100%; height: auto; display: block;
  border: 1px solid var(--panel-border);
}
.hero-lede { font-size: 19px; color: var(--text-main); margin-top: var(--sp-5); max-width: 74ch; }

.chips { display: flex; flex-wrap: wrap; gap: var(--sp-2); margin: 0 0 var(--sp-4); }
.chip {
  font-family: var(--font-mono); font-size: 12px;
  letter-spacing: var(--tracking-label);
  padding: 4px 10px;
  color: var(--cyan); border: 1px solid var(--panel-border-strong);
}
.chip-ok { color: var(--ok); border-color: var(--ok-dim); }
.chip-amber { color: var(--amber); border-color: var(--amber-dim); }

.cta { display: flex; flex-wrap: wrap; gap: var(--sp-3); }

/* --- band ------------------------------------------------------------- */
.band {
  border-left: 2px solid var(--amber);
  border-bottom: 1px solid var(--divider);
  padding-left: var(--sp-5);
}
.band p:last-child { margin-bottom: 0; color: var(--text-main); }

/* --- panels ----------------------------------------------------------- */
.panel {
  background: var(--panel-bg);
  border: 1px solid var(--panel-border);
  padding: var(--sp-5);
  backdrop-filter: blur(var(--blur));
  clip-path: polygon(0 0, calc(100% - var(--cut-md)) 0, 100% var(--cut-md), 100% 100%, 0 100%);
}
.panel h3 { margin-top: 0; }
.panel-ok { border-left: 2px solid var(--ok-dim); }
.panel-amber { border-left: 2px solid var(--amber-dim); }
.panel ul { margin: 0; padding-left: var(--sp-5); }
.panel li { margin-bottom: var(--sp-2); }

.split-cols { display: grid; grid-template-columns: 1fr 1fr; gap: var(--sp-5); }

/* --- cards ------------------------------------------------------------ */
.cards { display: grid; grid-template-columns: repeat(3, 1fr); gap: var(--sp-4); }
.card {
  background: var(--panel-bg-dim);
  border: 1px dashed var(--panel-border-strong);
  padding: var(--sp-4);
}
.card h3 { font-size: 16px; }
.card p { font-size: 15px; color: var(--text-dim); }
.card-fig { font-family: var(--font-mono); font-size: 12px; color: var(--amber); margin: 0 0 var(--sp-2); }
.card .src { font-family: var(--font-mono); font-size: 12px; color: var(--cyan); margin: 0; }

/* --- table ------------------------------------------------------------ */
.table-wrap { overflow-x: auto; border: 1px solid var(--panel-border); }
table { border-collapse: collapse; width: 100%; font-size: 15px; }
th, td { text-align: left; padding: var(--sp-3) var(--sp-4); border-bottom: 1px solid var(--divider); vertical-align: top; }
th { font-family: var(--font-mono); font-size: 12px; letter-spacing: var(--tracking-label); color: var(--amber); background: var(--tbl-head-bg); }
tbody tr:last-child td { border-bottom: none; }
td code, p code, li code { color: var(--cyan); }

/* --- gallery ---------------------------------------------------------- */
.gallery { display: grid; grid-template-columns: repeat(3, 1fr); gap: var(--sp-3); }
.shot { position: relative; display: block; border: 1px solid var(--panel-border); text-decoration: none; }
.shot img { display: block; width: 100%; height: auto; transition: transform var(--dur-data) var(--ease-out); }
.shot:hover img { transform: scale(1.03); }
.shot span {
  display: block; padding: 6px 10px;
  font-family: var(--font-mono); font-size: 12px;
  letter-spacing: var(--tracking-label);
  color: var(--text-dim); background: var(--panel-bg-solid);
  border-top: 1px solid var(--divider);
}
.shot:hover span { color: var(--cyan); }

.video { margin-top: var(--sp-5); }
.video summary { font-family: var(--font-mono); font-size: 13px; color: var(--cyan); cursor: pointer; }
.video video { display: block; width: 100%; max-width: 880px; margin-top: var(--sp-3); border: 1px solid var(--panel-border); }

/* --- code and diagram ------------------------------------------------- */
.diagram, .code {
  overflow-x: auto;
  background: var(--panel-bg-solid);
  border: 1px solid var(--panel-border);
  border-left: 2px solid var(--amber);
  padding: var(--sp-4);
  font-size: 13px; line-height: 1.6;
  color: var(--cyan-hi);
}
.note { color: var(--text-dim); font-size: 15px; }

/* --- footer ----------------------------------------------------------- */
footer {
  max-width: var(--page-max); margin: 0 auto;
  padding: var(--sp-6) var(--sp-5) 64px;
}
footer nav { display: flex; flex-wrap: wrap; gap: var(--sp-5); margin-bottom: var(--sp-4); }
footer nav a { font-size: 15px; text-decoration: none; }
footer nav a:hover { text-decoration: underline; }

/* --- lightbox --------------------------------------------------------- */
.lightbox {
  position: fixed; inset: 0; z-index: 50;
  display: flex; align-items: center; justify-content: center;
  padding: var(--sp-5);
  background: rgba(2, 4, 12, 0.94);
}
.lightbox[hidden] { display: none; }
.lightbox img {
  max-width: 100%; max-height: 100%;
  border: 1px solid var(--panel-border-strong);
}
.lightbox-close {
  position: absolute; top: var(--sp-4); right: var(--sp-5);
  background: transparent; border: 1px solid var(--panel-border-strong);
  color: var(--cyan); font-family: var(--font-mono); font-size: 22px;
  line-height: 1; padding: 6px 12px; cursor: pointer;
}
.lightbox-close:hover { background: var(--panel-bg-bleed); }

/* --- responsive ------------------------------------------------------- */
@media (max-width: 900px) {
  .cards, .gallery { grid-template-columns: repeat(2, 1fr); }
  .split-cols { grid-template-columns: 1fr; }
}
@media (max-width: 620px) {
  body { font-size: 16px; }
  .cards, .gallery { grid-template-columns: 1fr; }
  .nav nav { display: none; }
  h2 { font-size: 22px; }
}

@media (prefers-reduced-motion: reduce) {
  html { scroll-behavior: auto; }
  .shot img { transition: none; }
  .btn { transition: none; }
}
```

- [ ] **Step 3: Write `site/app.js`**

```js
/**
 * STELLARIS-7 // landing enhancements.
 * Progressive: the page is fully usable with JavaScript disabled.
 * Gallery links open the full-resolution capture in an in-page lightbox
 * instead of navigating away.
 */
(() => {
  const shots = Array.from(document.querySelectorAll('.gallery .shot'))
  if (!shots.length) return

  const box = document.createElement('div')
  box.className = 'lightbox'
  box.setAttribute('role', 'dialog')
  box.setAttribute('aria-modal', 'true')
  box.setAttribute('aria-label', 'Screenshot viewer')
  box.hidden = true
  box.innerHTML =
    '<button class="lightbox-close" type="button" aria-label="Close">&times;</button>' +
    '<img alt="" />'
  document.body.appendChild(box)

  const img = box.querySelector('img')
  const close = box.querySelector('.lightbox-close')
  let opener = null

  function open(href, alt, el) {
    opener = el
    img.src = href
    img.alt = alt
    box.hidden = false
    document.body.style.overflow = 'hidden'
    close.focus()
  }

  function dismiss() {
    box.hidden = true
    img.removeAttribute('src')
    document.body.style.overflow = ''
    if (opener) opener.focus()
  }

  shots.forEach((shot) => {
    shot.addEventListener('click', (ev) => {
      ev.preventDefault()
      const thumb = shot.querySelector('img')
      open(shot.getAttribute('href'), thumb ? thumb.alt : '', shot)
    })
  })

  close.addEventListener('click', dismiss)
  box.addEventListener('click', (ev) => { if (ev.target === box) dismiss() })
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && !box.hidden) dismiss()
  })
})()
```

- [ ] **Step 4: Render-check the page**

Serve `site/` directly and load it:

```bash
NODE_PATH=$(npm root -g) node --input-type=module -e "
import { createRequire } from 'node:module'
import { spawn } from 'node:child_process'
const require = createRequire('file://$PWD/')
const { chromium } = require('playwright')
const srv = spawn('node', ['-e', \"const h=require('http'),f=require('fs'),p=require('path');const r=p.join(process.cwd(),'site');h.createServer((q,s)=>{let u=q.url.split('?')[0];if(u==='/')u='/index.html';f.readFile(p.join(r,u),(e,d)=>{if(e){s.statusCode=404;return s.end('nf')}s.end(d)})}).listen(8097)\"], { stdio: 'ignore' })
await new Promise((r) => setTimeout(r, 600))
const b = await chromium.launch()
const page = await b.newPage({ viewport: { width: 1440, height: 900 } })
const errs = []
page.on('pageerror', (e) => errs.push(String(e)))
const missing = []
page.on('response', (r) => { if (r.status() >= 400) missing.push(r.url()) })
await page.goto('http://localhost:8097/', { waitUntil: 'networkidle' })
for (const sel of ['.hero-banner', '#capabilities', '#integrations', '#gallery', '#architecture', '#quickstart', '.gallery .shot']) {
  console.log(sel, await page.locator(sel).count())
}
console.log('pageerrors:', errs.length)
console.log('bad responses:', missing.filter((u) => !u.includes('{{')).length)
await b.close(); srv.kill(); process.exit(0)
"
```

Expected: `.gallery .shot 12`, every section `1`, `pageerrors: 0`, `bad responses: 0`.

- [ ] **Step 5: Commit**

```bash
git add site/index.html site/style.css site/app.js
git commit -m "feat(site): add blueprint landing page with gallery and lightbox"
```

---

### Task 4: Pages build orchestration and local verification

**Files:**
- Create: `scripts/build-pages.mjs`, `scripts/verify-site.mjs`
- Modify: `package.json`, `.gitignore`

**Interfaces:**
- Consumes: `site/*` (Task 3), `assets/*` (Task 2), and the `SUITES` array in `test/run-all.mjs` (Task 1).
- Produces: `_site/index.html` plus `_site/demo/index.html`, with `{{DEMO_URL}}`, `{{REPO_URL}}`, `{{VERSION}}` and `{{SUITES}}` replaced. Adds `npm run build:pages`, `npm run preview:pages`, `npm run verify:pages`.

**Critical:** this is GitHub **project** Pages served at `https://genpozi.github.io/starship-hud/`, so the demo lives under that subpath. The Vite `base` is derived, never hardcoded to `/demo/`.

- [ ] **Step 1: Write `scripts/build-pages.mjs`**

```js
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
```

- [ ] **Step 2: Write `scripts/verify-site.mjs`**

Serves `_site/` under the real project-Pages subpath `/starship-hud/` and checks both the landing page and the demo with Playwright. Requires a global Playwright; not part of `npm test`.

```js
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
```

- [ ] **Step 3: Add the scripts to `package.json`**

In the `scripts` block add:

```json
    "build:pages": "node scripts/build-pages.mjs",
    "preview:pages": "vite preview _site --port 4173",
    "verify:pages": "node scripts/verify-site.mjs",
```

- [ ] **Step 4: Ignore the build output**

Append to `.gitignore`:

```gitignore
# Pages build output
_site/
.pages-tmp/
```

- [ ] **Step 5: Build and check the layout**

Run: `npm run build:pages`
Expected: vite build output, then `pages: built _site/  version=2.2.0  suites=20  demo=/starship-hud/demo/`.

```bash
ls _site/index.html _site/demo/index.html _site/assets/brand/banner.svg
grep -c "{{" _site/index.html
```
Expected: three paths listed, then `0`.

- [ ] **Step 6: Verify the built site**

Run: `NODE_PATH=$(npm root -g) npm run verify:pages`
Expected: `landing has ...` all PASS, `landing shows 12 gallery thumbnails PASS`, `demo reaches a live status line PASS`, `demo has no page errors PASS`, then `ALL PASS`. The printed demo status will contain `OFFLINE SIM` since no orbit server is running, which is correct.

- [ ] **Step 7: Confirm the suite still passes**

Run: `npm test`
Expected: 20 suites green.

- [ ] **Step 8: Commit**

```bash
git add scripts/build-pages.mjs scripts/verify-site.mjs package.json .gitignore
git commit -m "feat(pages): assemble and verify the landing page and HUD demo"
```

---

### Task 5: GitHub Actions Pages workflow

**Files:**
- Create: `.github/workflows/pages.yml`

**Interfaces:**
- Consumes: `npm run build:pages` (Task 4).
- Produces: a deploy job publishing `_site/` to GitHub Pages on push to `master`.

- [ ] **Step 1: Write the workflow**

```yaml
name: Pages

on:
  push:
    branches: [master]
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: true

jobs:
  build:
    name: Build site
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm

      - name: Install dependencies
        run: npm ci

      - name: Test suite
        run: npm test

      - name: Build pages site
        run: npm run build:pages

      - uses: actions/configure-pages@v5

      - uses: actions/upload-pages-artifact@v3
        with:
          path: _site

  deploy:
    name: Deploy site
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - id: deployment
        uses: actions/deploy-pages@v4
```

The test step gates the deploy: a red suite cannot publish a site.

- [ ] **Step 2: Validate the YAML is wired correctly**

Run: `node -e "const f=require('fs').readFileSync('.github/workflows/pages.yml','utf-8');const need=['actions/deploy-pages@v4','actions/upload-pages-artifact@v3','pages: write','npm run build:pages','path: _site'];const miss=need.filter(n=>!f.includes(n));if(miss.length){console.error('missing:',miss);process.exit(1)}console.log('pages.yml ok')"`
Expected: `pages.yml ok`

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/pages.yml
git commit -m "ci(pages): deploy _site to GitHub Pages behind the test gate"
```

---

### Task 6: README, changelog, and docs

**Files:**
- Modify: `README.md` (banner hero, badge row, scope note, docs row, token fix)
- Modify: `index.html:8` (favicon color)
- Modify: `CHANGELOG.md`
- Modify: `docs/DEVELOPER.md`, `docs/CONTEXT.md`
- Modify: `test/brand.test.mjs` (append claim assertions)

**Interfaces:**
- Consumes: `assets/brand/banner.png` (Task 2) and the Pages URL `https://genpozi.github.io/starship-hud/`.
- Produces: a README whose claims the appended `brand` assertions enforce.

- [ ] **Step 1: Append the claim assertions**

Insert before the final `console.log(results.join('\n'))` in `test/brand.test.mjs`:

```js
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
```

- [ ] **Step 2: Run it to verify the new assertions fail**

Run: `node test/brand.test.mjs`
Expected: FAIL on the audit-vulns and production-ready lines, which are still present in the README.

- [ ] **Step 3: Replace the README hero**

Replace the opening centered `<img>` block at `README.md:1-3` with:

```html
<p align="center">
  <img src="assets/brand/banner.png" alt="STELLARIS-7 blueprint banner: starship HUD mission control with a module map and status chips" width="880"/>
</p>

<p align="center">
  <a href="https://genpozi.github.io/starship-hud/"><strong>Live site</strong></a> ·
  <a href="https://genpozi.github.io/starship-hud/demo/">Interactive HUD demo</a> ·
  <a href="#getting-started">Run it locally</a>
</p>
```

- [ ] **Step 4: Fix the badge row**

Replace the badge block at `README.md:12-18` with:

```html
  <a href="https://github.com/genpozi/starship-hud/actions/workflows/ci.yml"><img src="https://github.com/genpozi/starship-hud/actions/workflows/ci.yml/badge.svg" alt="CI"/></a>
  <a href="https://genpozi.github.io/starship-hud/"><img src="https://img.shields.io/badge/demo-live%20HUD-00f0ff" alt="live demo"/></a>
  <img src="https://img.shields.io/badge/stack-Vite%20%2B%20Three.js-00f0ff" alt="stack"/>
  <img src="https://img.shields.io/badge/license-MIT-ffb347" alt="license"/>
  <img src="https://img.shields.io/badge/tests-20%20suites-39ff88" alt="tests"/>
  <img src="https://img.shields.io/badge/node-20%2B-83a598" alt="node"/>
  <img src="https://img.shields.io/badge/status-reference%20implementation-ffb347" alt="status"/>
```

Two removals are deliberate and test-enforced: the false `deps-0%20audit%20vulns` badge, and the unsupported `status-production--ready` claim.

- [ ] **Step 5: Add the honest-scope note**

Immediately after the intro paragraph (`README.md:8-9`), add:

```markdown
> **What this is.** A real multi-agent orchestrator with a starship HUD on top. One orbit server owns the state; the browser mirrors it over WebSocket. It runs fully offline on seed data and upgrades to live sources when you supply credentials. The starship is a metaphor — the orchestration, transport, persistence, and tests are real. The [live demo](https://genpozi.github.io/starship-hud/) is this HUD running in offline simulation on seed data.
```

- [ ] **Step 6: Fix the stale token value**

At `README.md:275`, change `--line-cyan: #00e5ff` to `--line-cyan: #00f0ff`, so the docs match `src/style.css`.

- [ ] **Step 7: Add a site row to the documentation table**

In the `## Documentation` table, add as the first row:

```markdown
| [Live site](https://genpozi.github.io/starship-hud/) | landing page + interactive HUD demo (offline simulation on seed data) |
```

- [ ] **Step 8: Fix the favicon color**

In `index.html:8`, change `fill='%2300e5ff'` to `fill='%2300f0ff'` to match the `--cyan` token. Do **not** change the in-app emblem at `index.html:23` or the colors in `src/galaxy.js` — those are intentional application visuals, out of scope.

- [ ] **Step 9: Update the changelog**

Add under `[Unreleased]` in `CHANGELOG.md`:

```markdown
### Added

- GitHub Pages landing page (`site/`) with a blueprinted hero, capability cards,
  a 12-view gallery with lightbox, an architecture figure, and a quickstart.
- `npm run build:pages` assembles the landing page and a live interactive HUD
  demo into `_site/`; `.github/workflows/pages.yml` deploys it behind the test gate.
- `scripts/verify-site.mjs` loads the built site under the real Pages subpath and
  asserts the demo boots with no page errors.
- `assets/brand/` banner (SVG source plus a 2x PNG for GitHub), emblem, and a
  1280x640 social preview card, generated by `scripts/render-brand.mjs`.
- 720x450 gallery thumbnails under `assets/screenshots/thumbs/`.
- `test/brand.test.mjs` — enforces landing-page token parity, truthful suite
  counts, claim truthfulness, and brand asset dimensions.

### Removed

- False `deps: 0 audit vulns` README badge (`npm audit` reports 3 moderate
  advisories via `express` -> `qs`).
- Unsupported `production-ready` status badge; replaced with `reference implementation`.

### Fixed

- README documented `--line-cyan: #00e5ff`; the real token is `#00f0ff`.
- Suite count is no longer hardcoded across docs, CI, and the PR template.
```

- [ ] **Step 10: Document the site build for developers**

Append to `docs/DEVELOPER.md`:

```markdown
## Building the Pages site

The GitHub Pages site is the landing page in `site/` plus the real HUD built
with a derived base path.

```bash
# Build _site/ (landing page + HUD demo + assets)
npm run build:pages

# Serve the built site at http://localhost:4173
npm run preview:pages

# Verify the built site the way Pages serves it (needs global playwright)
NODE_PATH=$(npm root -g) npm run verify:pages
```

The demo is served under `PAGES_BASE` (default `/starship-hud/`). Override it
with `PAGES_BASE=/ npm run build:pages`.

Brand assets and gallery thumbnails are **committed**, not built in CI. To
regenerate them you need a global Playwright:

```bash
npm i -g playwright && npx playwright install chromium
NODE_PATH=$(npm root -g) node scripts/render-brand.mjs
```

`test/brand.test.mjs` fails if `site/tokens.css` drifts from `src/style.css`,
if a suite count goes stale, if the README overclaims, or if a brand asset has
the wrong dimensions.
```

- [ ] **Step 11: Note the new surface in context**

In `docs/CONTEXT.md`, add under `## What this is`:

```markdown
**GitHub presence:** `site/` is the Pages landing page; `npm run build:pages`
emits `_site/` (landing page + HUD demo at `/starship-hud/demo/`), deployed by
`.github/workflows/pages.yml`. Landing tokens mirror `src/style.css` and are
guarded by `test/brand.test.mjs`. Brand assets are committed.
```

- [ ] **Step 12: Full verification**

Run these and confirm each result:

```bash
node test/brand.test.mjs
```
Expected: `ALL PASS`.

```bash
npm test
```
Expected: 20 suites, `OVERALL: ALL SUITES GREEN`.

```bash
npm run build
```
Expected: Vite build succeeds.

```bash
npm run build:pages
```
Expected: `pages: built _site/  version=2.2.0  suites=20  demo=/starship-hud/demo/`

```bash
NODE_PATH=$(npm root -g) npm run verify:pages
```
Expected: `ALL PASS`.

- [ ] **Step 13: Commit**

```bash
git add README.md index.html CHANGELOG.md docs/DEVELOPER.md docs/CONTEXT.md test/brand.test.mjs
git commit -m "docs(presence): banner hero, honest badges, demo links, dev guide"
```

---

## Manual step (repository owner, after merge)

GitHub Pages must be enabled once, and that is a repository setting this plan cannot change from the codebase:

1. Repository **Settings -> Pages -> Build and deployment -> Source: GitHub Actions**.
2. Optionally set **Settings -> General -> Homepage** to `https://genpozi.github.io/starship-hud/`.
3. Optionally upload `assets/brand/social-preview.png` under **Settings -> General -> Social preview**.

The first deploy runs automatically on the next push to `master`, or manually via the **Pages** workflow's `workflow_dispatch`.

## Self-Review

**Spec coverage**

| Spec section | Task |
| --- | --- |
| 5 Visual system (dual-tone blueprint, HUD tokens) | 1 (tokens), 2 (banner), 3 (page) |
| 6.1 New files (`site/`, `assets/brand/`, `scripts/`, workflow, test) | 1, 2, 3, 4, 5 |
| 6.2 Modified files | 1, 2, 4, 6 |
| 6.3 `_site/` layout | 4 |
| 7 Landing sections (9) | 3 |
| 8 Build pipeline (steps 1–6) | 4 |
| 9 Deployment + manual settings | 5, manual step |
| 10 Verification (all rows) | 1 (tokens, counts), 2 (asset sizes), 4 step 6 (demo boots, landing renders), 5 (workflow), 6 step 12 (all) |
| 11 Risks (asset weight, bundle, fonts, sim honesty, README risk) | 2 step 7 (measured thumbs), 3 (labeled simulation), 4 (build output ignored), 6 |

All spec sections map to a task. No gaps.

**Placeholder scan:** no `TBD`, `TODO`, "handle edge cases", or "similar to Task N". Every code step carries complete content.

**Ordering correctness (the defect this rewrite fixes):** the `brand` suite is registered in Task 1 where its assertions already pass; asset assertions arrive in Task 2 with the assets; claim assertions arrive in Task 6 with the README fix. `npm test` is green at the end of every task. Adding the 20th suite forces the count change in Task 1, so all six stale count references are corrected in that same task, and prose elsewhere stops hardcoding the number.

**Type consistency:** the test reads `assets/screenshots/thumbs/<file>.png`, exactly what `render-brand.mjs` writes and what `site/index.html` references. The four placeholders `{{DEMO_URL}}`, `{{REPO_URL}}`, `{{VERSION}}`, `{{SUITES}}` appear in `site/index.html` and are exactly the four replaced in `build-pages.mjs`. `rootTokens()` parses both CSS files with the same function. `pngSize()` is used on `banner.png`, `social-preview.png`, and every thumb.
