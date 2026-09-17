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
