# STELLARIS-7 GitHub Presence — Design

Date: 2026-09-16
Status: Approved (design phase complete)
Scope: README + visual assets, and a GitHub Pages landing page with a live interactive HUD demo.

## 1. Problem

The repository's front door understates the work. The README is already
detailed, but the visual identity is a raw screenshot plus default-style
badges, and the only way to experience the product is to clone it and run two
processes. There is no hosted, shareable artifact that shows what STELLARIS-7
actually looks like running.

Two concrete defects also surfaced during discovery:

1. The badge `deps · 0 audit vulns` is **false**. `npm audit --omit=dev`
   reports 3 moderate advisories (`express` depends on a vulnerable `qs`).
2. The README and favicon use `#00e5ff`, but the real design token in
   `src/style.css` is `--cyan: #00f0ff`. The documents drift from the app.

## 2. Goals

- Give the project a premium, cohesive visual identity that is clearly *of*
  the product rather than applied to it.
- Publish a hosted landing page and a clickable HUD demo so the work can be
  evaluated without a local setup.
- Frame the project honestly: what it is, what it is not, and what is
  simulated versus real.
- Make claim-bearing numbers verifiable and drift-proof.

## 3. Non-goals

- Building a SaaS or adding any server-side hosting.
- Changing the repository description or topics, or creating a profile README.
  Enabling Pages and (optionally) setting the repository homepage are required
  or explicitly optional manual steps described in Section 9, not part of the
  automated deliverable.
- Adding runtime dependencies.
- Making the demo appear to be a live deployment of a real starship or a real
  multi-tenant service.
- Shipping the demo as anything other than the real HUD running in its
  existing offline simulation path.

## 4. Audience

Primary: developers, recruiters, and peers evaluating engineering craft.
The themed voice is kept, but every claim must be backed by something in the
repository, and simulation must be labeled as simulation.

## 5. Visual system

Direction: **dual-tone blueprint**, using the real HUD tokens.

| Element | Specification |
| --- | --- |
| Base | `#02040c` |
| Panels | `rgba(8,14,22,.78)` over a 20px cyan grid at 6–7% alpha |
| Structure | Cyan `#00f0ff` — grid, corner brackets, borders, wordmark, primary CTA |
| Annotation | Amber `#ffb347` — figure labels, callouts, secondary CTA, comments |
| Status | ok `#39ff88`, warn `#ffb347`, crit `#ff4d5e` — reserved for real state |
| Display type | Orbitron |
| UI type | Rajdhani |
| Data/label type | Share Tech Mono (figure numbers, code, all annotations) |
| Panels | `clip-path` cut corners, 1px dashed callout borders, amber left-rule for notes |
| Motion | Slow scan sweep and grid drift, gated behind `prefers-reduced-motion` |
| Accessibility | Skip link, semantic landmarks, visible focus rings, body text ≥7:1 on base |

Rationale: the earlier candidates were a diegetic HUD banner, a cinematic
product banner, a blueprint schematic, and a CRT terminal. The HUD banner was
the most on-brand; the blueprint was the best designed and the strongest
honesty signal. The chosen direction is the blueprint treatment recolored into
the HUD palette so it reads as part of the same design system.

## 6. Deliverables

### 6.1 New files

```
site/
  index.html              landing page (hand-authored, no framework)
  style.css               landing styles and blueprint components
  tokens.css              mirror of src/style.css :root tokens
  app.js                  vanilla enhancements (gallery lightbox, mobile nav)
assets/brand/
  banner.svg              single-source hero banner (dual-tone blueprint)
  banner.png              rendered from banner.svg so README gets real fonts
  mark.svg                cleaned-up emblem (four-point star)
  social-preview.png      1280x640 GitHub social preview card
scripts/
  build-pages.mjs         assembles _site/ (landing + HUD demo + shared assets)
  render-brand.mjs        authoring-time SVG -> PNG rendering via Playwright
.github/workflows/pages.yml
test/brand.test.mjs
```

### 6.2 Modified files

```
README.md                 banner hero, verifiable badges, demo link, token fix
index.html                favicon #00e5ff -> #00f0ff
package.json              add build:pages and preview:pages scripts
CHANGELOG.md              new entry
.gitignore                add _site/
docs/DEVELOPER.md         section on building and previewing the site
.github/workflows/ci.yml  derive the suite-count reference instead of typing it
```

### 6.3 `_site/` output layout

```
_site/
  index.html              landing page
  style.css tokens.css app.js
  assets/brand/… assets/screenshots/… assets/video/…
  demo/                   the real HUD build
```

## 7. Landing page sections

1. **Hero** — blueprint banner, one-sentence description, status chip
   (`v2.2.0 · MIT · runs offline`), CTAs to the demo and the source.
2. **Launch band** — sets the seed-data expectation before the demo loads.
3. **What it is / What it isn't** — explicit scope in two columns.
4. **Signature capabilities** — six cards, each naming the mechanism and its
   source file: superstep DAG (`server/planner.js`), checkpoints/rollback
   (`server/checkpoints.js`), single-holder interrupt, span traces
   (`server/trace.js`), typed channels (`src/channels.js`), filesystem vault
   (`server/vault.js`).
5. **Live integrations** — the existing GitHub/Hermes/LLM/comms table, with an
   explicit "off until you supply credentials" note.
6. **Gallery** — 12-view grid with a lightbox.
7. **Architecture** — module-flow diagram redrawn as a blueprint figure.
8. **Quickstart** — the three commands, copyable.
9. **Footer** — docs links, license, honest closing line.

## 8. Build pipeline

`scripts/build-pages.mjs`, standard library only:

1. Resolve `base = process.env.PAGES_BASE || '/starship-hud/'`.
2. `vite build` with `--base=<base>demo/` into a temp directory.
3. Copy `site/*` into `_site/`.
4. Copy the built HUD into `_site/demo/`.
5. Copy `assets/brand`, `assets/screenshots`, `assets/video` into
   `_site/assets/`.
6. Stamp the resolved demo URL and version into `_site/index.html`.

The base path is derived because this is a GitHub *project* Pages site served
under `https://genpozi.github.io/starship-hud/`, not at a domain root.
Hardcoding `/demo/` would break every asset.

`package.json` gains `build:pages` and `preview:pages`; the latter serves
`_site/` locally so the full site is testable without pushing.

## 9. Deployment

`.github/workflows/pages.yml` triggers on push to `master` and on
`workflow_dispatch`. Jobs: `npm ci` → `npm test` → `npm run build:pages` →
`actions/upload-pages-artifact` → `actions/deploy-pages`, with
`permissions: pages: write, id-token: write` and a `concurrency` group. A red
test suite prevents deployment.

Manual step required from the repository owner: enable Pages with
**Source: GitHub Actions**, and optionally set the repository homepage to the
Pages URL. These are settings changes outside the repository.

## 10. Verification

| Check | Method |
| --- | --- |
| Tests green | `npm test` → 19/19 |
| Production build green | `npm run build` |
| Site builds | `npm run build:pages`; assert `_site/index.html` and `_site/demo/index.html` exist |
| Demo boots | Playwright: serve `_site/`, load the demo, wait for `NOMINAL`, assert no `pageerror`, screenshot |
| Landing renders | Playwright: load landing, assert hero and sections, no font 404s |
| Brand assets correct | `banner.png` dimensions; `social-preview.png` is 1280×640 |
| Tokens in sync | `test/brand.test.mjs` parses `src/style.css` vs `site/tokens.css` |
| Suite count truthful | `test/brand.test.mjs` compares README and CI text against `SUITES.length` |
| Badge claims true | `npm audit` parsed; badges and tests reflect reality |
| No dead links | link check over `_site` |

## 11. Risks and mitigations

- **~14 MB of assets** (12 screenshots ≈ 13 MB, video ≈ 700 KB). The gallery
  would be slow. Mitigation: generate 720px-wide PNG derivatives for the grid
  and keep the full-resolution originals for click-through and lightbox. The
  measured target is a gallery payload under 3 MB. ffmpeg here has no WebP
  encoder and there is no cwebp or ImageMagick, so WebP is not promised; if the
  target cannot be met without new dependencies, the outcome is reported with
  measured numbers rather than claiming an unverified improvement.
- **Three.js bundle size** makes the demo a heavy first load. Mitigation: an
  explicit loading state in the demo shell; the landing page stays small so
  the marketing surface stays fast.
- **Fonts in SVG** are stripped by GitHub's image proxy, so the README uses the
  rendered PNG; the site loads web fonts normally.
- **Simulation honesty** — the demo may display `STANDBY — OFFLINE SIM`. This
  is correct and is labeled in the UI, not hidden.
- **README risk** — this touches the repository's front door. All work lands on
  one branch as a single reviewable, revertable pull request.

## 12. Decisions log

| Decision | Choice |
| --- | --- |
| Surfaces | README + visual assets; GitHub Pages landing page |
| Audience | Portfolio showcase, honest framing |
| Pages content | Landing page plus live interactive HUD demo |
| Visual direction | Dual-tone blueprint in HUD tokens |
| Pages mechanism | GitHub Actions deploy |
| Landing sections | Full story with explicit "what it isn't" |
| Badges | Make every badge verifiable; drop the false one |
| Banner asset | One SVG source; PNG for README, SVG for the site |
| Build approach | Node orchestration script (`scripts/build-pages.mjs`) |
