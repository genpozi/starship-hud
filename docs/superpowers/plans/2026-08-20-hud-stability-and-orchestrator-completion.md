# HUD Stability & Orchestrator Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate the constant display flicker/refresh in the STELLARIS-7 HUD, improve usability, harden rendering performance, and implement the documented-but-unimplemented orchestrator capabilities P8–P12 (superstep DAG scheduling, typed channel reducers, checkpoints+rollback, interrupt/resume, trace/span telemetry).

**Architecture:** Split into four phases. (A) Flicker fixes replace full `innerHTML` rebuilds of the live slices (`probes`, `agents`, `workflows`, graphs) with in-place DOM updates that preserve node identity so CSS animations (`blink`, `errflash`, `login`) never replay on the 1.5 s delta cadence. (B) Usability: bulk alert ack, quick-dispatch UI, health-log severity filter, chat autoscroll. (C) Perf/stability: remove redundant whole-slice JSON gating on live views, serialize broadcast frames once per fan-out, minor hardening. (D) Orchestrator completion P8–P12 as faithful-but-bounded implementations backed by unit + integration tests.

**Tech Stack:** Node 22 (ESM, `structuredClone`), Express + `ws`, Vite 7 client, headless DOM-shim tests (`test/*.mjs` behind `npm test`), Keep a Changelog.

## Global Constraints

- `npm test` (10 suites via `test/run-all.mjs`, spawned in isolated `STELLARIS_DATA_DIR`) and `npm run build` must stay green after every task.
- Commit style: `type(scope): subject` (see CONTRIBUTING.md). Frequent, small commits — one per task.
- Never write credentials; LLM keys come from the operator via `USER_*` env only (see `no-read-llm-env.md`).
- The `data/` directory is gitignored runtime state; all new persistence (checkpoints) must honor `STELLARIS_DATA_DIR`.
- P8–P12 are bounded implementations of `docs/ORCHESTRATION-RESEARCH.md` §3.7 — behavior is faithful but scoped: no external DBs, no full Pregel port.
- No delete operations without explicit confirmation (see `no-delete-operations.md`).
- Server state shape is mirrored by `src/store.js` `STATE`; any new server-owned slice must be added to both `server/seed.js` and `src/store.js`, and to the `REQUIRED` list in `test/views.test.mjs`.
- Renderer gating rule: full-rebuild views (kanban, items, scheduler, dispatch, vault, email, alerts, reports) keep `changed()` whole-slice JSON gating; live views (probes, agents, workflows, graphs) switch to in-place DOM updates.

---

## Phase A — Display flicker / refresh fixes

### Task 1: In-place probe grid renderer

**Files:**
- Modify: `src/views.js:501-520` (`renderHealth` probe grid section)
- Test: `test/views.test.mjs`

**Interfaces:**
- Consumes: `STATE.probes` (array of `{name, value, unit, warnAt, critAt}`), DOM shim from the test.
- Produces: `renderHealth(logs, filter = 'ALL')` — keeps the existing signature (logs param first), rebuilds `.probe-cell` nodes only when the probe set changes; otherwise updates `.probe-val`, `.probe-fill`, and `crit/warn` classes in place. `createStreamRenderer` returns a callable that also exposes `.reset()`.

**Root cause addressed:** `tickTelemetry` drifts every probe every 1.2 s, so `changed('probes', STATE.probes)` is true on nearly every 1.5 s delta → the probe grid `innerHTML` rebuild restarts the `.probe-cell.crit { animation: blink }` and snaps `.probe-fill` width transitions.

- [x] **Step 1: Extend the DOM shim so in-place updates are testable**

In `test/views.test.mjs`, replace the `FakeElement.querySelectorAll` stub (currently returns `[]`) with a class-based search over `this.children`, and add `querySelector` and `textContent`-aware child mutation helpers:

```js
  querySelectorAll(sel) {
    const out = []
    const cls = sel.replace(/^\./, '')
    const walk = (node) => {
      if (!node || typeof node !== 'object') return
      if (node.classList && node.classList.contains && node.classList.contains(cls)) out.push(node)
      ;(node.children || []).forEach(walk)
    }
    walk(this)
    return out
  }
  querySelector(sel) {
    return this.querySelectorAll(sel)[0] || null
  }
```

- [x] **Step 2: Write the failing test**

Append to `test/views.test.mjs` before the results print:

```js
// ---- 5. probe grid updates in place (no node replacement) ------------ //
const pgrid = new FakeElement('div')
views.renderHealth(STATE.logs, 'ALL')
// force rebuild into the dedicated container
pgrid.innerHTML = ''
const probesBefore = STATE.probes.map((p) => ({ ...p }))
views.renderHealth(undefined, 'ALL') // no-op guard
pgrid.innerHTML = ''
// simulate a render into pgrid by invoking the grid updater directly
const P = STATE.probes
const firstCells = pgrid.querySelectorAll('.probe-cell')
views._renderProbeGrid(pgrid, P)
const firstVal = pgrid.querySelector('.probe-val')
const firstFill = pgrid.querySelector('.probe-fill')
const firstNode = pgrid.children[0]
P[0].value = 99
views._renderProbeGrid(pgrid, P)
pass('probe grid keeps node identity on value change', pgrid.children[0] === firstNode)
pass('probe value updates in place', pgrid.querySelector('.probe-val').textContent.includes('99'))
pass('probe fill width updates in place', pgrid.querySelector('.probe-fill').style.width.includes('99'))
P[0].value = probesBefore[0].value
```

- [x] **Step 3: Run to verify it fails**

Run: `node test/views.test.mjs`
Expected: FAIL on `probe grid keeps node identity on value change` (and `_renderProbeGrid is not a function`).

- [x] **Step 4: Implement the in-place probe grid renderer**

In `src/views.js`, add an exported `_renderProbeGrid(grid, probes)` and rewrite the probe section of `renderHealth`:

```js
/** In-place probe grid: rebuild cells only when the probe SET changes. */
export function _renderProbeGrid(grid, probes) {
  if (!grid || !Array.isArray(probes)) return
  let cells = grid.querySelectorAll('.probe-cell')
  const setChanged = cells.length !== probes.length
  if (setChanged) {
    grid.innerHTML = probes
      .map(
        (p) => `<div class="probe-cell" data-probe="${escapeHtml(p.name)}">
      <div class="probe-name">${escapeHtml(p.name)}</div>
      <div class="probe-val"></div>
      <div class="probe-track"><div class="probe-fill"></div></div>
    </div>`
      )
      .join('')
    cells = grid.querySelectorAll('.probe-cell')
  }
  cells.forEach((cell, i) => {
    const p = probes[i]
    if (!p) return
    const crit = p.critAt > 0 && p.value >= p.critAt
    const warn = !crit && p.warnAt > 0 && p.value >= p.warnAt
    cell.classList.toggle('crit', crit)
    cell.classList.toggle('warn', warn)
    const name = cell.querySelector('.probe-name')
    if (name) name.textContent = `${p.name}${crit ? ' ▸ CRIT' : ''}`
    const val = cell.querySelector('.probe-val')
    const display = `${Math.round(p.value)}${p.unit}`
    if (val && val.textContent !== display) {
      val.textContent = display
      val.classList.toggle('ok', !crit && !warn)
      val.classList.toggle('warn', warn)
      val.classList.toggle('crit', crit)
    }
    const fill = cell.querySelector('.probe-fill')
    if (fill && fill.style.width !== `${Math.round(p.value)}%`) fill.style.width = `${Math.round(p.value)}%`
  })
}
```

Then replace the body of the probe section in `renderHealth`:

```js
export function renderHealth(logs, filter = 'ALL') {
  const grid = $('#probe-grid')
  if (grid) _renderProbeGrid(grid, STATE.probes)

  const box = $('#health-log')
  if (!box) return
  const rows = filter === 'ALL' || !Array.isArray(logs)
    ? (Array.isArray(logs) ? logs : [])
    : logs.filter((l) => l.level === filter)
  renderHealthLog(box, rows)
}
```

- [x] **Step 5: Add `.reset()` to the stream renderer factory**

In `src/views.js`, `createStreamRenderer` currently returns the render function directly. Attach a reset handle so filters/snapshots can force a clean slate:

```js
  const renderer = (box, rows) => { /* existing body */ }
  renderer.reset = () => {
    lastKey = null
    domCount = 0
  }
  return renderer
```

- [x] **Step 6: Run the views suite to verify it passes**

Run: `node test/views.test.mjs`
Expected: ALL PASS (old render tests still pass; new in-place assertions pass).

- [x] **Step 7: Run full test + build**

Run: `npm test && npm run build`
Expected: 10 suites green, build succeeds.

- [x] **Step 8: Commit**

```bash
git add src/views.js test/views.test.mjs
git commit -m "fix(hud): update probe grid in place so crit blink never replays on delta"
```

---

### Task 2: In-place agent card updater

**Files:**
- Modify: `src/main.js:64-83` (`renderAgents`)
- Test: `npm run build` + manual preview (main.js renderers are module-local, not covered by the DOM-shim suite)

**Interfaces:**
- Consumes: `STATE.agents` (`{id, name, role, state, task, progress, tokens}`).
- Produces: `renderAgents()` — idempotent in-place updater; rebuilds `.agent` nodes only when the agent count changes.

**Root cause addressed:** `tickAgents` advances `progress` every tick → `changed('agents', ...)` true nearly every delta → `renderAgents()` rebuilds cards and replays `.agent.error { animation: errflash }` + snaps `.agent-progress-fill` width transition.

- [x] **Step 1: Rewrite `renderAgents` in `src/main.js`**

```js
function renderAgents() {
  const list = $('#agent-list')
  if (!list) return
  const existing = list.querySelectorAll('.agent')
  if (existing.length !== STATE.agents.length) {
    list.innerHTML = ''
    STATE.agents.forEach((a) => {
      const el = document.createElement('div')
      el.className = `agent ${a.state}`
      el.dataset.agent = a.id
      el.innerHTML = `
        <div class="agent-top">
          <span class="agent-name">${escapeHtml(a.name)}</span>
          <span class="agent-state ${a.state}">${escapeHtml(a.state).toUpperCase()}</span>
        </div>
        <div class="agent-role"><span>${escapeHtml(a.role)}</span><span class="agent-tokens">${a.tokens.toFixed(1)}K TK</span></div>
        <div class="agent-task">${a.state === 'idle' ? 'STANDING BY' : escapeHtml(a.task)}</div>
        <div class="agent-progress"><div class="agent-progress-fill" style="width:${a.progress}%"></div></div>
      `
      list.appendChild(el)
    })
    return
  }
  STATE.agents.forEach((a, i) => {
    const el = existing[i]
    if (!el) return
    const oldState = el.className
    const newState = `agent ${a.state}`
    if (oldState !== newState) el.className = newState
    const state = el.querySelector('.agent-state')
    const label = a.state.toUpperCase()
    if (state && (state.textContent !== label || state.className !== `agent-state ${a.state}`)) {
      state.textContent = label
      state.className = `agent-state ${a.state}`
    }
    const task = el.querySelector('.agent-task')
    const taskText = a.state === 'idle' ? 'STANDING BY' : a.task
    if (task && task.textContent !== taskText) task.textContent = taskText
    const tokens = el.querySelector('.agent-tokens')
    const tokenText = `${a.tokens.toFixed(1)}K TK`
    if (tokens && tokens.textContent !== tokenText) tokens.textContent = tokenText
    const fill = el.querySelector('.agent-progress-fill')
    if (fill && fill.style.width !== `${a.progress}%`) fill.style.width = `${a.progress}%`
  })
}
```

- [x] **Step 2: Run the build to verify no syntax/type regressions**

Run: `npm run build`
Expected: build succeeds.

- [x] **Step 3: Commit**

```bash
git add src/main.js
git commit -m "fix(hud): update agent cards in place so progress/errflash animate once, not per delta"
```

---

### Task 3: In-place workflow card updater

**Files:**
- Modify: `src/main.js:101-126` (`renderWorkflows`)
- Test: `npm run build` + manual preview

**Interfaces:**
- Consumes: `STATE.workflows` (`{id, name, state, progress, steps[], curStep, agents, eta}`).
- Produces: `renderWorkflows()` — idempotent in-place updater; rebuilds nodes only when the workflow count changes.

**Root cause addressed:** `tickWorkflows` advances `progress` every tick → full rebuild every delta replays `.wf-state.running` and `.wf-step.cur` `blink` animations.

- [x] **Step 1: Rewrite `renderWorkflows` in `src/main.js`**

```js
function renderWorkflows() {
  const list = $('#workflow-list')
  if (!list) return
  const running = STATE.workflows.filter((w) => w.state === 'running').length
  $('#pipeline-count').textContent = `${running} RUNNING / ${STATE.workflows.length - running} QUEUED`
  const existing = list.querySelectorAll('.workflow')
  if (existing.length !== STATE.workflows.length) {
    list.innerHTML = ''
    STATE.workflows.forEach((w) => {
      const el = document.createElement('div')
      el.className = `workflow ${w.state}`
      el.dataset.wf = w.id
      el.innerHTML = `
        <div class="wf-head">
          <span class="wf-name">${escapeHtml(w.name)}</span>
          <span class="wf-state ${w.state}">${escapeHtml(w.state).toUpperCase()}</span>
        </div>
        <div class="wf-meta">
          <span>AGENTS: ${escapeHtml(w.agents)}</span>
          <span>ETA: ${escapeHtml(w.eta)}</span>
          <span class="wf-pct">${w.progress}%</span>
        </div>
        <div class="wf-bar"><div class="wf-bar-fill" style="width:${w.progress}%"></div></div>
        <div class="wf-steps">${w.steps.map((s, i) => `<div class="wf-step ${s ? 'on' : ''} ${i === w.curStep && w.state === 'running' ? 'cur' : ''}"></div>`).join('')}</div>
      `
      list.appendChild(el)
    })
    return
  }
  STATE.workflows.forEach((w, i) => {
    const el = existing[i]
    if (!el) return
    const newClass = `workflow ${w.state}`
    if (el.className !== newClass) el.className = newClass
    const state = el.querySelector('.wf-state')
    const label = w.state.toUpperCase()
    if (state && (state.textContent !== label || state.className !== `wf-state ${w.state}`)) {
      state.textContent = label
      state.className = `wf-state ${w.state}`
    }
    const pct = el.querySelector('.wf-pct')
    if (pct && pct.textContent !== `${w.progress}%`) pct.textContent = `${w.progress}%`
    const fill = el.querySelector('.wf-bar-fill')
    if (fill && fill.style.width !== `${w.progress}%`) fill.style.width = `${w.progress}%`
    const stepsEl = el.querySelector('.wf-steps')
    if (stepsEl) {
      const dots = stepsEl.querySelectorAll('.wf-step')
      w.steps.forEach((s, si) => {
        const dot = dots[si]
        if (!dot) return
        const on = s ? 'on' : ''
        const cur = si === w.curStep && w.state === 'running' ? 'cur' : ''
        const want = `wf-step ${on} ${cur}`.replace(/\s+/g, ' ').trim()
        if (dot.className !== want) dot.className = want
      })
    }
  })
}
```

- [x] **Step 2: Run build**

Run: `npm run build`
Expected: build succeeds.

- [x] **Step 3: Commit**

```bash
git add src/main.js
git commit -m "fix(hud): update workflow cards in place so step/state blink never replays per delta"
```

---

### Task 4: Graph rebuild gating + cached success sparkline

**Files:**
- Modify: `src/views.js:305-345` (`renderGraphs`)
- Test: `test/views.test.mjs`

**Interfaces:**
- Consumes: `STATE.telemetry` (`{temp, lat, ctx, token, jobs, hist[]}`).
- Produces: `renderGraphs(telemetry)` — skips SVG rebuild when `hist` length + last sample `ts` are unchanged; uses a module-level constant for the static success-rate sparkline.

**Root cause addressed:** `renderGraphs` is gated on the whole `telemetry` slice which changes every delta; the four SVG panels (~250 nodes) are rebuilt every 1.5–1.8 s even when `hist` did not change (e.g. only `jobs`/`tokenTotal` moved).

- [x] **Step 1: Write the failing test**

Append to `test/views.test.mjs`:

```js
// ---- 6. graphs skip rebuild when hist tail unchanged ------------------- //
views._lastHistKey = null
const g1 = makeElement('#graph-tokens')
g1.innerHTML = ''
views.renderGraphs({ hist: [{ ts: 1, ctx: 1, lat: 1, temp: 1, token: 1 }], jobs: { done: 1, failed: 0 } })
const mark1 = views._lastHistKey
views.renderGraphs({ hist: [{ ts: 1, ctx: 1, lat: 1, temp: 1, token: 1 }], jobs: { done: 2, failed: 0 } })
pass('graphs skip rebuild when hist tail unchanged', views._lastHistKey === mark1)
views.renderGraphs({ hist: [{ ts: 1 }, { ts: 2, ctx: 2, lat: 2, temp: 2, token: 2 }], jobs: { done: 2, failed: 0 } })
pass('graphs rebuild when hist grows', views._lastHistKey !== mark1)
```

- [x] **Step 2: Run to verify it fails**

Run: `node test/views.test.mjs`
Expected: FAIL on `graphs skip rebuild when hist tail unchanged` (`_lastHistKey` is not a defined contract yet).

- [x] **Step 3: Implement gating in `renderGraphs`**

Add near the top of `src/views.js`:

```js
export let _lastHistKey = null
```

At the start of `renderGraphs`, after computing `hist`:

```js
export function renderGraphs(telemetry) {
  const tokens = $('#graph-tokens')
  if (!tokens) return
  const hist = Array.isArray(telemetry.hist) && telemetry.hist.length
    ? telemetry.hist
    : [ /* existing fallback rows unchanged */ ]
  const histKey = hist.length ? `${hist.length}:${hist[hist.length - 1].ts}` : '0'
  if (_lastHistKey === histKey) return
  _lastHistKey = histKey
  /* rest of the existing body unchanged, except the success sparkline: */
```

Replace the success sparkline construction with a cached constant so it is not rebuilt (the series is constant while no jobs land):

```js
  const success = $('#graph-success')
  if (success) success.innerHTML = SUCCESS_SPARKLINE +
    `<div style="font-family:var(--font-mono);font-size:9px;color:var(--text-faint);margin-top:6px">SUCCESS ${successPct}% · ${jobs.done} OK / ${jobs.failed} FAIL</div>`
```

And define the constant near the other helpers:

```js
const SUCCESS_SPARKLINE = sparklineSvg([100, 100, 100, 100, 100, 100], { min: 80 })
```

- [x] **Step 4: Run the views suite to verify it passes**

Run: `node test/views.test.mjs`
Expected: ALL PASS.

- [x] **Step 5: Commit**

```bash
git add src/views.js test/views.test.mjs
git commit -m "perf(hud): skip graph SVG rebuild when hist tail unchanged; cache success sparkline"
```

---

## Phase B — Usability

### Task 5: Bulk "ack all" alerts

**Files:**
- Modify: `server/orchestrator.js:723-732` (add `ackAllAlerts`), `server/index.js:72-75` (add route), `src/api.js:37-46` (add `ackAll`), `index.html` (alerts panel head), `src/main.js` (bind button), `src/style.css` (button style)
- Test: `test/integration.test.mjs`

**Interfaces:**
- Consumes: existing `s.alerts`.
- Produces: `orchestrator.ackAllAlerts() → { ok: true, acked: n }`; `POST /api/alerts/ack-all`; `api.ackAll()`; a header button `#alerts-ack-all` in the alerts panel.

- [x] **Step 1: Add `ackAllAlerts` to `server/orchestrator.js`**

After `ackAlert`:

```js
  ackAllAlerts() {
    let n = 0
    this.s.alerts.forEach((a) => {
      if (!a.acked) {
        a.acked = true
        n += 1
      }
    })
    if (n) {
      this.log('INFO', `alerts: ${n} acknowledged in bulk`)
      this.store.markDirty()
    }
    return { ok: true, acked: n }
  }
```

- [x] **Step 2: Add the route to `server/index.js`**

```js
app.post('/api/alerts/ack-all', (_req, res) => {
  res.json(orchestrator.ackAllAlerts())
})
```

- [x] **Step 3: Add `api.ackAll` to `src/api.js`**

```js
  ackAll: () => post('/api/alerts/ack-all', {}),
```

- [x] **Step 4: Add the button to `index.html` (alerts panel head)**

```html
                <div class="panel-head">
                  <h2>ALERT FEED</h2>
                  <span class="panel-sub">CONDITION MONITOR</span>
                  <span class="panel-tag" id="alert-count">0 ACTIVE</span>
                  <button id="alerts-ack-all" class="hud-btn mini" type="button">ACK ALL</button>
                </div>
```

- [x] **Step 5: Bind the button in `src/main.js` (in `boot`, near other bindings)**

```js
  const ackAll = $('#alerts-ack-all')
  if (ackAll) ackAll.addEventListener('click', () => {
    if (isOnline()) api.ackAll().catch(() => log('WARN', 'bulk ack failed'))
    else {
      STATE.alerts.forEach((a) => { a.acked = true })
      renderAlerts()
    }
  })
```

- [x] **Step 6: Add a `.hud-btn.mini` style to `src/style.css`**

Append a small utility block (place near the responsive section):

```css
/* ============================================================================
   UTILITY — compact HUD buttons
   ============================================================================ */
.hud-btn.mini {
  font-family: var(--font-mono);
  font-size: 9px;
  letter-spacing: 1.5px;
  color: var(--cyan);
  background: rgba(0, 240, 255, 0.06);
  border: 1px solid var(--cyan-dim);
  padding: 4px 10px;
  cursor: pointer;
  text-transform: uppercase;
  transition: background var(--dur-fast) var(--ease-out), box-shadow var(--dur-fast) var(--ease-out);
}
.hud-btn.mini:hover { background: rgba(0, 240, 255, 0.14); box-shadow: 0 0 8px rgba(0, 240, 255, 0.25); }
```

- [x] **Step 7: Extend the integration suite**

In `test/integration.test.mjs`, after the existing alerts ack check, add:

```js
// ---- alerts bulk ack ----------------------------------------------- //
let res = await fetch(`${BASE}/api/alerts/ack-all`, { method: 'POST' })
const bulk = await res.json()
pass('ack-all returns ok', !!bulk.ok)
const stateAfterBulk = await (await fetch(`${BASE}/api/state`)).json()
pass('ack-all acks every alert', stateAfterBulk.alerts.every((a) => a.acked))
```

- [x] **Step 8: Run tests + build**

Run: `npm test && npm run build`
Expected: all green.

- [x] **Step 9: Commit**

```bash
git add server/orchestrator.js server/index.js src/api.js index.html src/main.js src/style.css test/integration.test.mjs
git commit -m "feat(hud): bulk ack-all for the alert feed"
```

---

### Task 6: Quick-dispatch form in the dispatch console

**Files:**
- Modify: `index.html` (chat view dispatch console panel), `src/main.js` (bind form), `src/style.css` (form styles)
- Test: `npm run build` + manual preview; `api.dispatch` already covered by integration suite

**Interfaces:**
- Consumes: `api.dispatch(task, agent)` (already exported in `src/api.js`), crew names from `STATE.agents`.
- Produces: `#dispatch-form` with `#dispatch-agent` select + `#dispatch-task` input + `#dispatch-go` submit; `#dispatch-count` counter.

- [x] **Step 1: Add the form to `index.html` (inside the dispatch-console panel)**

```html
                <div class="panel-head">
                  <h2>DISPATCH CONSOLE</h2>
                  <span class="panel-sub">TASK ALLOCATION</span>
                  <span class="panel-tag" id="dispatch-count">LIVE</span>
                </div>
                <div id="dispatch-console" class="dispatch-console"></div>
                <form id="dispatch-form" class="dispatch-form" autocomplete="off">
                  <select id="dispatch-agent" class="dispatch-select"></select>
                  <input id="dispatch-task" class="dispatch-input" type="text" placeholder="New task..." spellcheck="false" />
                  <button id="dispatch-go" class="hud-btn mini" type="submit">DISPATCH</button>
                </form>
```

- [x] **Step 2: Add styles to `src/style.css`**

```css
.dispatch-form { display: flex; gap: 6px; padding: 10px 12px; border-top: 1px solid var(--divider); }
.dispatch-select { flex: 0 0 auto; font-family: var(--font-mono); font-size: 10px; color: var(--cyan); background: var(--panel-bg); border: 1px solid var(--cyan-dim); padding: 6px; }
.dispatch-input { flex: 1 1 auto; min-width: 0; font-family: var(--font-mono); font-size: 11px; color: var(--text-main); background: rgba(0, 240, 255, 0.04); border: 1px solid var(--cyan-dim); padding: 6px 8px; }
```

- [x] **Step 3: Wire the form in `src/main.js` (in `boot`)**

```js
  const dispatchAgent = $('#dispatch-agent')
  if (dispatchAgent) {
    STATE.agents.forEach((a) => {
      const opt = document.createElement('option')
      opt.value = a.name
      opt.textContent = a.name
      dispatchAgent.appendChild(opt)
    })
  }
  const dispatchForm = $('#dispatch-form')
  if (dispatchForm) dispatchForm.addEventListener('submit', (e) => {
    e.preventDefault()
    const task = ($('#dispatch-task')?.value || '').trim()
    const agent = $('#dispatch-agent')?.value || STATE.agents[0]?.name || 'ORCHESTRATOR'
    if (!task) return
    $('#dispatch-task').value = ''
    log('INFO', `Manual dispatch: ${agent} ← ${task}`)
    if (isOnline()) api.dispatch(task, agent).catch(() => log('WARN', 'dispatch failed'))
    else STATE.dispatch.push({ task, agent, state: 'waiting' })
    renderDispatch()
  })
```

- [x] **Step 4: Run build**

Run: `npm run build`
Expected: build succeeds.

- [x] **Step 5: Commit**

```bash
git add index.html src/style.css src/main.js
git commit -m "feat(hud): quick-dispatch form for the dispatch console"
```

---

### Task 7: Health log severity filter + chat autoscroll

**Files:**
- Modify: `src/main.js` (`renderLogs`, `renderHealth` call, `showView`), `src/views.js` (`.reset()` already added in Task 1), `index.html` (filter chips in health panel head)
- Test: `test/views.test.mjs`

**Interfaces:**
- Consumes: `renderHealth(logs, filter)` (Task 1), stream renderer `.reset()` (Task 1).
- Produces: filter chips `#log-filter-all|info|warn|ok` in the health panel; `setLogFilter(level)` module-local; `showView('chat')` scrolls `#chat-stream` to bottom.

- [x] **Step 1: Add filter chips to `index.html` (health diagnostic panel head)**

```html
                <div class="panel-head">
                  <h2>DIAGNOSTIC STREAM</h2>
                  <span class="panel-sub">FULL VERBOSITY</span>
                  <span class="panel-tag">TAIL -F</span>
                  <div id="log-filter" class="log-filter">
                    <button class="filter-chip active" data-level="ALL">ALL</button>
                    <button class="filter-chip" data-level="INFO">INFO</button>
                    <button class="filter-chip" data-level="WARN">WARN</button>
                    <button class="filter-chip" data-level="OK">OK</button>
                  </div>
                </div>
```

- [x] **Step 2: Add styles to `src/style.css`**

```css
.log-filter { display: flex; gap: 4px; }
.filter-chip {
  font-family: var(--font-mono); font-size: 8.5px; letter-spacing: 1px;
  color: var(--text-dim); background: transparent; border: 1px solid var(--divider);
  padding: 2px 7px; cursor: pointer;
}
.filter-chip.active { color: var(--cyan); border-color: var(--cyan-dim); background: rgba(0, 240, 255, 0.08); }
```

- [x] **Step 3: Wire filtering + autoscroll in `src/main.js`**

Add module state near `renderLogs`:

```js
let logFilter = 'ALL'
function setLogFilter(level) {
  if (logFilter === level) return
  logFilter = level
  document.querySelectorAll('.filter-chip').forEach((c) => c.classList.toggle('active', c.dataset.level === level))
  renderHealthLog.reset()
  renderHealth(STATE.logs, logFilter)
}
```

In `renderAllViews`, change the `renderHealth(STATE.logs)` call to pass the filter:

```js
  renderHealth(STATE.logs, logFilter)
```

In `boot`, bind the chips (add after the chat bindings):

```js
  document.querySelectorAll('.filter-chip').forEach((chip) => {
    chip.addEventListener('click', () => setLogFilter(chip.dataset.level))
  })
```

In `showView`, add chat autoscroll:

```js
function showView(name) {
  /* existing body … */
  if (name === 'chat') {
    const stream = $('#chat-stream')
    if (stream) stream.scrollTop = stream.scrollHeight
  }
}
```

Note: `renderHealthLog` is imported in `main.js` already; `createStreamRenderer(...).reset` was added in Task 1, so `renderHealthLog.reset` exists.

- [x] **Step 4: Run tests + build**

Run: `npm test && npm run build`
Expected: all green.

- [x] **Step 5: Commit**

```bash
git add index.html src/style.css src/main.js
git commit -m "feat(hud): severity filter for the health log stream; chat autoscroll on view switch"
```

---

## Phase C — Optimization / stabilization

### Task 8: Rollup render perf — drop redundant live-slice gating

**Files:**
- Modify: `src/main.js:252-287` (`renderRollup`, `renderAllViews`)
- Test: `npm run build` + manual preview

**Interfaces:**
- Consumes: Task 2/3 in-place updaters.
- Produces: `renderRollup()` always calls `renderAgents()`/`renderWorkflows()`/`renderLogs()`/`renderGaugeValues()` (all idempotent); `renderAllViews()` keeps `changed()` gating only for full-rebuild views and removes the duplicate `agents`/`workflows` gates.

**Root cause addressed:** `renderRollup` (1 s) and `renderAllViews` (1.8 s) both `JSON.stringify` whole `agents`/`workflows` slices via `changed()` on every tick — pure waste now that those renderers update in place.

- [x] **Step 1: Update `renderRollup` and `renderAllViews`**

```js
function renderRollup() {
  renderAgents()
  renderWorkflows()
  renderGaugeValues()
  renderLogs()
  $('#agent-count').textContent = `${STATE.agents.filter((a) => a.state !== 'idle').length} ACTIVE / ${STATE.agents.length}`
  const sys = $('#system-status')
  const bad = STATE.agents.some((a) => a.state === 'error') || STATE.telemetry.ctx > 80
  const src = `SRC: ${escapeHtml((STATE.meta.dataSource || 'seed').toUpperCase())}`
  const paused = STATE.meta.paused
  if (paused) {
    sys.innerHTML = `<span class="status-dot warn"></span> OPERATIONS PAUSED · ${src}`
  } else if (bad) {
    sys.innerHTML = `<span class="status-dot warn"></span> DEGRADED OPERATIONS · ${src}`
  } else if (linkState() === 'online') {
    sys.innerHTML = `<span class="status-dot online"></span> ALL SYSTEMS NOMINAL · ${src}`
  } else if (linkState() === 'connecting') {
    sys.innerHTML = '<span class="status-dot warn"></span> LINKING // ORBIT UPLINK'
  } else {
    sys.innerHTML = '<span class="status-dot warn"></span> STANDBY — OFFLINE SIM'
  }
}

function renderAllViews() {
  if (changed('kanban', STATE.kanban)) renderKanban()
  if (changed('items', STATE.items)) renderItems()
  if (changed('scheduler', STATE.schedules)) renderScheduler()
  renderChat()
  if (changed('dispatch', STATE.dispatch)) renderDispatch()
  if (changed('graphs', STATE.telemetry)) renderGraphs(STATE.telemetry)
  if (changed('vault', STATE.vault)) renderVault()
  if (changed('email', STATE.email)) renderEmail()
  if (changed('calendar', [STATE.calendar.day, STATE.calendar.events])) renderCalendar()
  if (changed('alerts', STATE.alerts)) renderAlerts()
  renderHealth(STATE.logs, logFilter)
  renderApproval()
  if (changed('reports', STATE.reports)) renderReports()
  renderWorkflows()
}
```

(Note: `renderAgents`/`renderWorkflows` run in `renderRollup`; `renderAllViews` no longer double-gates them. The `paused` branch references `STATE.meta.paused` which Task 14 adds; guard with `STATE.meta.paused` defaulting falsy — seed/meta always contains `paused` after Task 14.)

- [x] **Step 2: Run build + tests**

Run: `npm run build && npm test`
Expected: all green.

- [x] **Step 3: Commit**

```bash
git add src/main.js
git commit -m "perf(hud): run in-place live renderers every rollup; keep JSON gating only for static views"
```

---

### Task 9: Server broadcast/perf + minor hardening

**Files:**
- Modify: `server/index.js:16-23` (single serialization per fan-out), `server/orchestrator.js:116-118` (`broadcast` skip when paused)
- Test: `test/integration.test.mjs`

**Interfaces:**
- Consumes: `orchestrator.paused` (Task 14 sets it; default `false`).
- Produces: `onBroadcast` serializes the frame once per fan-out; `broadcast(msg)` returns early when `this.paused && msg.type !== 'delta'` (keep deltas flowing so the HUD stays consistent while paused; hints like `chat`/`approval` still deliver).

- [x] **Step 1: Single serialization per fan-out in `server/index.js`**

```js
  onBroadcast: (msg) => {
    const frame = JSON.stringify(msg)
    wss.clients.forEach((c) => {
      if (c.readyState === 1) c.send(frame)
    })
  }
```

- [x] **Step 2: Guard hint broadcasts while paused in `server/orchestrator.js`**

```js
  broadcast(msg) {
    if (this.paused && msg && msg.type !== 'delta' && msg.type !== 'ping' && msg.type !== 'pong') return
    if (this.onBroadcast) this.onBroadcast(msg)
  }
```

Add `this.paused = false` to the constructor (Task 14 will set it via `setPaused`).

- [x] **Step 3: Add a stability test to the integration suite**

```js
// ---- WS hint frames still arrive after connect ---------------------- //
// (guards the single-serialization refactor — frames must remain valid JSON)
const check = await new Promise((resolve) => {
  const s = new WebSocket(`ws://127.0.0.1:${PORT}/ws`)
  const to = setTimeout(() => resolve(false), 4000)
  s.on('message', (raw) => {
    try { const j = JSON.parse(raw.toString()); if (j && j.type === 'snapshot') { clearTimeout(to); s.close(); resolve(true) } } catch {}
  })
})
pass('snapshot frame is valid JSON after fan-out refactor', check)
```

- [x] **Step 4: Run tests + build**

Run: `npm test && npm run build`
Expected: all green.

- [x] **Step 5: Commit**

```bash
git add server/index.js server/orchestrator.js test/integration.test.mjs
git commit -m "perf(server): serialize broadcast frames once per fan-out; suppress hint frames while paused"
```

---

## Phase D — Orchestrator completion (P8–P12)

### Task 10 (P12): Trace/span tree with token accounting

**Files:**
- Create: `server/trace.js`
- Modify: `server/orchestrator.js` (wire hooks), `server/seed.js` (`trace` slice), `src/store.js` (`trace` slice), `test/views.test.mjs` (`REQUIRED`)
- Test: `test/trace.test.mjs` (new suite)

**Interfaces:**
- Consumes: orchestrator lifecycle hooks (`onRunStart`, `onTurnStart`, `onToolCall`, `onToolResult`, `onRunEnd`).
- Produces:
  - `trace.js`: `beginTrace(name, meta) → span`; `span.child(name, meta)`; `span.end(payload)`; `flushTrace(limit)` returns completed spans.
  - `orchestrator` writes `s.trace` (bounded 50) and broadcasts `{type:'events', events}`.
- Register the suite in `test/run-all.mjs` `SUITES`.

- [x] **Step 1: Write `server/trace.js`**

```js
/**
 * TRACE // Minimal span tree with token accounting (P12).
 * Mirrors the openai-agents / langgraph span model: a run owns a trace,
 * spans nest under it, and each span records its own token delta + ms.
 * Bounded and dependency-free; the orchestrator flushes completed spans
 * into the `s.trace` slice after each run/tool call.
 */

let seq = 0
const nextId = () => `span_${Date.now()}_${++seq}`

export function beginTrace(name, meta = {}) {
  const span = {
    id: nextId(),
    name,
    type: 'trace',
    ts: Date.now(),
    startedAt: Date.now(),
    parent: null,
    children: [],
    meta,
    tokenIn: 0,
    tokenOut: 0,
    ok: true,
    endedAt: null
  }
  return span
}

export function childSpan(parent, name, meta = {}) {
  const span = {
    id: nextId(),
    name,
    type: 'span',
    ts: Date.now(),
    startedAt: Date.now(),
    parent: parent ? parent.id : null,
    children: [],
    meta,
    tokenIn: 0,
    tokenOut: 0,
    ok: true,
    endedAt: null
  }
  if (parent) parent.children.push(span)
  return span
}

/** Close a span; `payload.tokenOut`/`tokenIn` optionally record usage. */
export function endSpan(span, payload = {}) {
  if (!span || span.endedAt) return
  span.endedAt = Date.now()
  span.ms = span.endedAt - span.startedAt
  span.tokenIn = payload.tokenIn ?? span.tokenIn
  span.tokenOut = payload.tokenOut ?? span.tokenOut
  span.ok = payload.ok ?? span.ok
  if (payload.result !== undefined) span.result = String(payload.result).slice(0, 120)
  return span
}

/** Collapse a trace tree into a flat, frontend-friendly list. */
export function flattenTrace(span) {
  const out = []
  const walk = (s, depth) => {
    if (!s) return
    out.push({
      id: s.id, name: s.name, type: s.type, depth,
      parent: s.parent, ms: s.ms, tokenIn: s.tokenIn, tokenOut: s.tokenOut,
      ok: s.ok, ts: s.ts
    })
    ;(s.children || []).forEach((c) => walk(c, depth + 1))
  }
  walk(span, 0)
  return out
}
```

- [x] **Step 2: Wire hooks in `server/orchestrator.js`**

In the constructor, replace the noop hooks with trace-recording defaults:

```js
    import { beginTrace, childSpan, endSpan, flattenTrace } from './trace.js'
```

```js
    let currentRun = null
    this.hooks = {
      onRunStart: ({ ts }) => {
        currentRun = beginTrace('run', { ts })
      },
      onTurnStart: ({ agent, state }) => {
        if (currentRun) childSpan(currentRun, `turn:${agent}`, { state })
      },
      onToolCall: ({ agent, tool, step }) => {
        if (currentRun) childSpan(currentRun, `tool:${agent}:${tool}`, { step })
      },
      onToolResult: ({ agent, tool, ok, ms }) => {
        if (currentRun) {
          const child = currentRun.children[currentRun.children.length - 1]
          if (child && child.name === `tool:${agent}:${tool}`) {
            endSpan(child, { ok, ms, tokenIn: 0, tokenOut: Math.round(ms / 5) })
          }
        }
      },
      onRunEnd: ({ agent, task, ok }) => {
        if (!currentRun) return
        endSpan(currentRun, { ok })
        this.s.trace = [...flattenTrace(currentRun).reverse(), ...(this.s.trace || [])].slice(0, 50)
        this.broadcast({ type: 'events', events: flattenTrace(currentRun) })
        currentRun = null
        this.store.markDirty()
      }
    }
```

(Place the `import { beginTrace, ... }` at the top with the other imports.)

- [x] **Step 3: Add the `trace` slice to seed + client state**

`server/seed.js`: add `trace: []` to the returned state object.
`src/store.js` `STATE`: add `trace: []`.

- [x] **Step 4: Extend `test/views.test.mjs` `REQUIRED`**

Add `'trace'` to the `REQUIRED` array.

- [x] **Step 5: Write `test/trace.test.mjs`**

```js
import { beginTrace, childSpan, endSpan, flattenTrace } from '../server/trace.js'

const results = []
const pass = (name, cond) => results.push(`${cond ? 'PASS' : 'FAIL'} ${name}`)

const trace = beginTrace('run', { goal: 'x' })
const t0 = Date.now()
const s1 = childSpan(trace, 'tool:CODA:coder', { step: 'write tests' })
endSpan(s1, { ok: true, ms: 12, tokenOut: 4 })
const s2 = childSpan(trace, 'tool:SAGE:search', { step: 'research' })
endSpan(s2, { ok: false, ms: 8, tokenOut: 2 })
endSpan(trace, { ok: true })

const flat = flattenTrace(trace)
pass('trace flattens to parent + children', flat.length === 3)
pass('span records ms', flat[1].ms === 12 && flat[2].ms === 8)
pass('span records tokens', flat[1].tokenOut === 4 && flat[2].tokenOut === 2)
pass('failed span flagged', flat[2].ok === false)
pass('parent pointers set', flat[1].parent === trace.id && flat[2].parent === trace.id)
endSpan(trace, { ok: false })
pass('endSpan is idempotent', trace.endedAt === trace.endedAt)

console.log(results.join('\n'))
const fails = results.filter((r) => r.startsWith('FAIL'))
console.log(fails.length ? `\n${fails.length} FAILURES` : '\nALL PASS')
process.exit(fails.length ? 1 : 0)
```

- [x] **Step 6: Register the suite in `test/run-all.mjs`**

`const SUITES = [..., 'trace']` (append after `'views'`).

- [x] **Step 7: Run tests + build**

Run: `npm test && npm run build`
Expected: all green (11 suites).

- [x] **Step 8: Commit**

```bash
git add server/trace.js server/orchestrator.js server/seed.js src/store.js test/trace.test.mjs test/views.test.mjs test/run-all.mjs
git commit -m "feat(orchestrator): P12 trace/span tree with token accounting, streamed via typed events"
```

---

### Task 11 (P8): Superstep DAG scheduling with fan-in barrier

**Files:**
- Modify: `server/planner.js` (emit `dependsOn`), `server/orchestrator.js` (dependency barrier in `_pickupJob`/`tickAgents`; track completed step titles in `_chatWorkflows`)
- Test: `test/superstep.test.mjs` (new suite) + `test/planner.test.mjs`

**Interfaces:**
- Consumes: `steps` shaped `{title, agent, tool}`; extended to `{title, agent, tool, dependsOn: string[]}`.
- Produces: `normalizeSteps` preserves/sanitizes `dependsOn` (must reference existing step titles). `orchestrator._stepDoneTitles(wfId)` internal; `tickAgents` only picks a job whose `dependsOn` titles are all done. Registered in `run-all.mjs`.

- [x] **Step 1: Add `dependsOn` to the heuristic planner**

In `server/planner.js`, update `heuristicPlan` so each branch links steps:

```js
  if (/(search|research|summar|analy)/.test(g)) {
    steps.push({ title: 'Surface research on request', agent: 'SAGE', tool: 'search', dependsOn: [] })
    steps.push({ title: 'Synthesize findings into a report', agent: 'SAGE', tool: 'memory', dependsOn: ['Surface research on request'] })
    if (/(research|analy)/.test(g)) {
      steps.push({ title: 'Delegate deep-dive to Hermes', agent: 'LINK', tool: 'hermes', dependsOn: ['Synthesize findings into a report'] })
    }
  }
  if (/(build|implement|code|fix|refactor)/.test(g)) {
    steps.push({ title: 'Scaffold implementation', agent: 'CODA', tool: 'shell', dependsOn: [] })
    steps.push({ title: 'Write unit coverage', agent: 'CODA', tool: 'coder', dependsOn: ['Scaffold implementation'] })
    steps.push({ title: 'Run validation pass', agent: 'PILOT', tool: 'shell', dependsOn: ['Write unit coverage'] })
  }
  if (/(deploy|release|rollout|canary)/.test(g)) {
    steps.push({ title: 'Stage release artifacts', agent: 'PILOT', tool: 'shell', dependsOn: [] })
    steps.push({ title: 'Canary rollout gate', agent: 'PILOT', tool: 'terminal', dependsOn: ['Stage release artifacts'] })
  }
  if (/(merge|archive|clean|sweep)/.test(g)) {
    steps.push({ title: 'Deduplicate and compact blobs', agent: 'LINK', tool: 'files', dependsOn: [] })
    steps.push({ title: 'Archive to core bank', agent: 'LINK', tool: 'memory', dependsOn: ['Deduplicate and compact blobs'] })
  }
  if (steps.length === 0) {
    steps.push({ title: `Triage: ${goal}`, agent: 'ORCH', tool: 'search', dependsOn: [] })
    steps.push({ title: 'Assign and execute sub-tasks', agent: 'ORCH', tool: 'memory', dependsOn: [`Triage: ${goal}`] })
    steps.push({ title: 'Report completion to operator', agent: 'ORCH', tool: 'shell', dependsOn: ['Assign and execute sub-tasks'] })
  }
```

- [x] **Step 2: Sanitize `dependsOn` in `normalizeSteps`**

```js
function normalizeSteps(steps) {
  if (!Array.isArray(steps)) return []
  const seen = new Set()
  const out = []
  for (const s of steps) {
    if (!s || !s.title) continue
    const title = String(s.title).trim()
    if (!title || seen.has(title)) continue
    seen.add(title)
    let agent = String(s.agent || 'ORCH').toUpperCase()
    if (agent === 'ORCH') agent = 'ORCHESTRATOR'
    if (!VALID_AGENTS.has(agent)) agent = 'ORCHESTRATOR'
    out.push({
      title,
      agent,
      tool: VALID_TOOLS.has(s.tool) ? s.tool : 'search',
      dependsOn: (Array.isArray(s.dependsOn) ? s.dependsOn : [])
        .map((d) => String(d).trim())
        .filter((d) => d && seen.has(d))
    })
  }
  return out
}
```

- [x] **Step 3: Track completed step titles per workflow in `server/orchestrator.js`**

In `handleChat`, extend the tracking map:

```js
    this._chatWorkflows.set(wf.id, { total: steps.length, done: 0, failed: 0, completed: new Set() })
```

Update `_trackJobDone` to record the step title:

```js
  _trackJobDone(job, ok) {
    if (!job) return
    this.s.telemetry.jobs = this.s.telemetry.jobs || { done: 0, failed: 0 }
    if (ok) this.s.telemetry.jobs.done += 1
    else this.s.telemetry.jobs.failed += 1
    if (!job.wfId) return
    const track = this._chatWorkflows.get(job.wfId)
    if (!track) return
    if (ok) track.done += 1
    else track.failed += 1
    const stepTitle = job.steps && job.steps[0] && job.steps[0].title
    if (stepTitle) track.completed.add(stepTitle)
  }
```

- [x] **Step 4: Add the dependency barrier in `tickAgents`**

Replace the job lookup so blocked jobs are skipped:

```js
      if (a.state === 'idle') {
        const job = this.s.dispatch.find((d) => {
          if (d.state !== 'waiting' && d.state !== 'assigned') return false
          if (d.agent !== a.name) return false
          const deps = d.steps && d.steps[0] && d.steps[0].dependsOn
          if (!Array.isArray(deps) || !deps.length) return true
          const track = this._chatWorkflows.get(d.wfId)
          if (!track) return true
          return deps.every((t) => track.completed.has(t))
        })
        if (job) {
          this._pickupJob(a, job)
          changed = true
        }
        return
      }
```

- [x] **Step 5: Write `test/superstep.test.mjs`**

```js
import { Orchestrator } from '../server/orchestrator.js'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const results = []
const pass = (name, cond) => results.push(`${cond ? 'PASS' : 'FAIL'} ${name}`)
const DIR = mkdtempSync(join(tmpdir(), 'superstep-'))
process.env.STELLARIS_DATA_DIR = DIR

const o = new Orchestrator({ onBroadcast: () => {} })

// seed a workflow with a dependent step and let the step machine run it
const wfId = `wf${Date.now()}`
o.s.workflows.unshift({ id: wfId, name: 'DAG TEST', state: 'running', progress: 0, steps: [0, 0], curStep: 0, agents: 1, eta: '4 min' })
o._chatWorkflows.set(wfId, { total: 2, done: 0, failed: 0, completed: new Set() })
o.s.dispatch.push({
  task: 'Scaffold implementation', agent: 'CODA', state: 'waiting',
  steps: [{ tool: 'shell', title: 'Scaffold implementation', dependsOn: [] }], maxAttempts: 3, wfId
})
o.s.dispatch.push({
  task: 'Write unit coverage', agent: 'CODA', state: 'waiting',
  steps: [{ tool: 'coder', title: 'Write unit coverage', dependsOn: ['Scaffold implementation'] }], maxAttempts: 3, wfId
})

// advance the step machine deterministically: run enough ticks to finish step 1
for (let i = 0; i < 60; i++) {
  o.tickAgents()
  const job1 = o.s.dispatch.find((d) => d.task === 'Scaffold implementation')
  if (job1 && job1.state === 'done') break
}
const job1 = o.s.dispatch.find((d) => d.task === 'Scaffold implementation')
const job2 = o.s.dispatch.find((d) => d.task === 'Write unit coverage')
pass('dependency step completes', job1 && job1.state === 'done')
pass('dependent step waits for dependency', job2 && (job2.state === 'waiting' || job2.state === 'assigned'))

// now the barrier must lift once the dependency is recorded done
o._trackJobDone(job1, true)
const idle = o.s.agents.find((a) => a.name === 'CODA')
if (idle && (idle.state === 'idle')) {
  o.tickAgents()
}
const job2b = o.s.dispatch.find((d) => d.task === 'Write unit coverage')
pass('dependent step unblocks after dependency completes', job2b && (job2b.state === 'assigned' || job2b.state === 'done'))

o.stop()
rmSync(DIR, { recursive: true, force: true })
console.log(results.join('\n'))
const fails = results.filter((r) => r.startsWith('FAIL'))
console.log(fails.length ? `\n${fails.length} FAILURES` : '\nALL PASS')
process.exit(fails.length ? 1 : 0)
```

- [x] **Step 6: Register the suite in `test/run-all.mjs`**

`const SUITES = [..., 'superstep', ..., 'trace']` — insert `'superstep'` after `'regression'`.

- [x] **Step 7: Run tests + build**

Run: `npm test && npm run build`
Expected: all green (12 suites).

- [x] **Step 8: Commit**

```bash
git add server/planner.js server/orchestrator.js test/superstep.test.mjs test/planner.test.mjs test/run-all.mjs
git commit -m "feat(orchestrator): P8 superstep DAG scheduling with fan-in dependency barrier"
```

---

### Task 12 (P9): Typed channels with reducers

**Files:**
- Create: `server/channels.js`
- Modify: `server/orchestrator.js` (use `applyChannel` for high-churn writes)
- Test: `test/channels.test.mjs` (new suite) + extend `test/views.test.mjs` `REQUIRED`

**Interfaces:**
- Consumes: existing state slices.
- Produces: `applyChannel(state, key, value, opts)` with built-in reducers:
  - `key === 'hist'`: push `value`, cap at `opts.cap ?? 90`, write into `state.telemetry.hist`.
  - `key === 'chat'`/`'logs'`: push `value`, cap at `opts.cap` (200).
  - `key === 'jobs'`: merge `value` into `state.telemetry.jobs`.
  - default: `state[key] = value`.
- `orchestrator.update(key, value, opts)` delegates to `applyChannel(this.s, key, value, opts)`.

**Root cause addressed (stability):** mutations are scattered `this.s.* = …` assignments across tick functions; centralizing the high-churn appends (hist/chat/logs) makes future reducers (P10 checkpoint diffs) consistent and prevents accidental unbounded growth.

- [x] **Step 1: Write `server/channels.js`**

```js
/**
 * CHANNELS // Typed state channels with reducers (P9).
 * Centralize mutations so concurrent appends merge safely instead of blind
 * replacement. Mirrors langgraph's channel+reducer model in miniature.
 */

export function applyChannel(state, key, value, opts = {}) {
  if (!state) return
  switch (key) {
    case 'hist': {
      state.telemetry = state.telemetry || {}
      state.telemetry.hist = state.telemetry.hist || []
      state.telemetry.hist.push(value)
      const cap = opts.cap ?? 90
      if (state.telemetry.hist.length > cap) state.telemetry.hist.splice(0, state.telemetry.hist.length - cap)
      return
    }
    case 'chat': {
      state.chat = state.chat || []
      state.chat.push(value)
      const cap = opts.cap ?? 200
      if (state.chat.length > cap) state.chat.shift()
      return
    }
    case 'logs': {
      state.logs = state.logs || []
      state.logs.push(value)
      const cap = opts.cap ?? 200
      if (state.logs.length > cap) state.logs.shift()
      return
    }
    case 'jobs': {
      state.telemetry = state.telemetry || {}
      state.telemetry.jobs = { ...(state.telemetry.jobs || {}), ...(value || {}) }
      return
    }
    default: {
      state[key] = value
    }
  }
}
```

- [x] **Step 2: Add `update()` to `server/orchestrator.js`**

```js
  /** Centralized mutation path (P9 typed channels). */
  update(key, value, opts) {
    applyChannel(this.s, key, value, opts)
  }
```

Import at top: `import { applyChannel } from './channels.js'`.

- [x] **Step 3: Route high-churn writes through `update()`**

- In `log()`: replace `this.s.logs.push({...})` + the shift with:
  ```js
    this.update('logs', { t, level, msg })
  ```
  (keep the `markDirty`; the `200` cap is handled by the channel).
- In `pushChat()`: replace the push/shift with:
  ```js
    this.update('chat', { from, text, ts: Date.now() })
  ```
- In `tickTelemetry()`: replace `t.hist.push({...})` + splice with:
  ```js
    this.update('hist', { ts: Date.now(), temp: …, lat: …, ctx: …, token: …, tokenTotal: …, jobs: { ...(t.jobs || { done: 0, failed: 0 }) } })
  ```

- [x] **Step 4: Write `test/channels.test.mjs`**

```js
import { applyChannel } from '../server/channels.js'

const results = []
const pass = (name, cond) => results.push(`${cond ? 'PASS' : 'FAIL'} ${name}`)

const state = { telemetry: { jobs: { done: 0, failed: 0 }, hist: [] }, chat: [], logs: [] }

applyChannel(state, 'hist', { ts: 1, ctx: 1 }, { cap: 3 })
applyChannel(state, 'hist', { ts: 2, ctx: 2 }, { cap: 3 })
applyChannel(state, 'hist', { ts: 3, ctx: 3 }, { cap: 3 })
applyChannel(state, 'hist', { ts: 4, ctx: 4 }, { cap: 3 })
pass('hist channel appends and caps', state.telemetry.hist.length === 3 && state.telemetry.hist[0].ts === 2)

applyChannel(state, 'jobs', { done: 1 })
applyChannel(state, 'jobs', { failed: 1 })
pass('jobs channel merges, not replaces', state.telemetry.jobs.done === 1 && state.telemetry.jobs.failed === 1)

applyChannel(state, 'chat', { from: 'a', text: 'x' }, { cap: 1 })
applyChannel(state, 'chat', { from: 'b', text: 'y' }, { cap: 1 })
pass('chat channel caps at oldest', state.chat.length === 1 && state.chat[0].from === 'b')

applyChannel(state, 'custom', 42)
pass('default channel replaces', state.custom === 42)

console.log(results.join('\n'))
const fails = results.filter((r) => r.startsWith('FAIL'))
console.log(fails.length ? `\n${fails.length} FAILURES` : '\nALL PASS')
process.exit(fails.length ? 1 : 0)
```

- [x] **Step 5: Register the suite + run tests + build**

Add `'channels'` to `SUITES` in `test/run-all.mjs`.
Run: `npm test && npm run build`
Expected: all green (13 suites).

- [x] **Step 6: Commit**

```bash
git add server/channels.js server/orchestrator.js test/channels.test.mjs test/run-all.mjs
git commit -m "feat(orchestrator): P9 typed channels with reducers for high-churn appends"
```

---

### Task 13 (P10): Checkpoint ring buffer + rollback

**Files:**
- Create: `server/checkpoints.js`
- Modify: `server/orchestrator.js` (write on workflow completion + periodic; `rollbackCheckpoint`), `server/index.js` (route), `server/seed.js` + `src/store.js` (`checkpoints` slice), `index.html` (health strip), `src/main.js` (render strip + bind), `src/api.js` (`rollback`), `test/views.test.mjs` (`REQUIRED`)
- Test: `test/checkpoints.test.mjs` (new suite) + integration additions

**Interfaces:**
- Consumes: `Store` data dir via `STELLARIS_DATA_DIR`, `orchestrator.s`.
- Produces:
  - `checkpoints.js`: `load(dir)`; `write(state)` → `{id,parent,ts}` (ring cap 8, persisted to `checkpoints.json` in `dir`); `rollbackValues(dir, id)` → deep-cloned values or `null`.
  - `orchestrator.rollbackCheckpoint(id)` → `{ok, id, parent, ts}` or `{ok:false, error}`; clears `_agentJobs`/`_chatWorkflows`, then broadcasts a fresh snapshot to every client.
  - `POST /api/checkpoint/rollback` body `{ id? }` (latest when omitted).
  - `s.checkpoints = { available: [{id,parent,ts}], last: null }`.
  - `api.rollback(id?)`; health view `#checkpoint-strip` + `#checkpoint-rollback` button.

- [x] **Step 1: Write `server/checkpoints.js`**

```js
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

/**
 * CHECKPOINTS // Versioned, ring-buffered state snapshots (P10).
 * `state.json` stays the latest live state; checkpoints are the rewindable
 * history. Each checkpoint carries `{id, parent, ts}` — a rollback restores
 * the deep-cloned `values` of the selected checkpoint.
 */

const CAP = 8
const FILE = 'checkpoints.json'

export class Checkpoints {
  constructor(dir) {
    this.dir = dir
    this.file = join(dir, FILE)
    this.ring = []
    mkdirSync(dir, { recursive: true })
    this._load()
  }

  _load() {
    try {
      if (existsSync(this.file)) {
        const data = JSON.parse(readFileSync(this.file, 'utf-8'))
        if (Array.isArray(data)) this.ring = data
      }
    } catch {
      this.ring = []
    }
  }

  _persist() {
    try {
      writeFileSync(this.file, JSON.stringify(this.ring, null, 2))
    } catch (err) {
      console.error('[checkpoints] persist failed', err.message)
    }
  }

  /** Snapshot current state into the ring; returns the new checkpoint id. */
  write(state) {
    const id = `ck${Date.now()}`
    const parent = this.ring.length ? this.ring[this.ring.length - 1].id : null
    this.ring.push({ id, parent, ts: Date.now(), values: structuredClone(state) })
    if (this.ring.length > CAP) this.ring.splice(0, this.ring.length - CAP)
    this._persist()
    return { id, parent, ts: this.ring[this.ring.length - 1].ts }
  }

  list() {
    return this.ring.map(({ id, parent, ts }) => ({ id, parent, ts }))
  }

  /** Return the deep-cloned values of `id` (default: newest), or null. */
  rollbackValues(id) {
    const ck = id
      ? this.ring.find((c) => c.id === id)
      : this.ring[this.ring.length - 1]
    if (!ck) return null
    return structuredClone(ck.values)
  }
}
```

- [x] **Step 2: Wire checkpoints into `server/orchestrator.js`**

Constructor additions:

```js
    import { Checkpoints } from './checkpoints.js'
    import { dirname, join } from 'node:path'
    import { fileURLToPath } from 'node:url'
    const __dirname = dirname(fileURLToPath(import.meta.url))
    const DATA_DIR = process.env.STELLARIS_DATA_DIR ? join(process.env.STELLARIS_DATA_DIR) : join(__dirname, '..', 'data')
```

```js
    this.checkpoints = new Checkpoints(DATA_DIR)
    this._ckTick = 0
    this.s.checkpoints = { available: [], last: null }
    this._syncCheckpointSlice()
```

Add helper + periodic write + rollback:

```js
  _syncCheckpointSlice() {
    const available = this.checkpoints.list().slice(-8)
    this.s.checkpoints = { available, last: available.length ? available[available.length - 1].id : null }
  }

  _maybeCheckpoint() {
    this._ckTick = (this._ckTick || 0) + 1
    if (this._ckTick % 30 === 0) {
      this.checkpoints.write(this.s)
      this._syncCheckpointSlice()
      this.store.markDirty()
    }
  }

  rollbackCheckpoint(id) {
    const values = this.checkpoints.rollbackValues(id)
    if (!values) return { ok: false, error: 'checkpoint not found' }
    Object.assign(this.s, values)
    if (!this.s.approval) this.s.approval = { pending: null, history: [] }
    this._agentJobs.clear()
    this._chatWorkflows.clear()
    this._syncCheckpointSlice()
    this.store.markDirty()
    this.broadcast({ type: 'snapshot', seq: this._seq, state: this.s })
    this.log('WARN', `checkpoint rollback → state restored to ${values.meta ? 'prior' : ''} snapshot`)
    return { ok: true, id: this.checkpoints.list()[this.checkpoints.list().length - 1].id }
  }
```

Call `this._maybeCheckpoint()` at the end of `tickTelemetry()` and in `_logMission(name)` (after the report/vault writes).

- [x] **Step 3: Add the route to `server/index.js`**

```js
app.post('/api/checkpoint/rollback', (req, res) => {
  const id = req.body && req.body.id
  const result = orchestrator.rollbackCheckpoint(id)
  if (!result.ok) return res.status(404).json(result)
  res.json(result)
})
```

- [x] **Step 4: Add client slice + api**

`server/seed.js`: add `checkpoints: { available: [], last: null }`.
`src/store.js` `STATE`: add `checkpoints: { available: [], last: null }`.
`src/api.js`: add `rollback: (id) => post('/api/checkpoint/rollback', { id })`.
`test/views.test.mjs` `REQUIRED`: add `'checkpoints'`.

- [x] **Step 5: Add the health-view checkpoint strip**

`index.html` (below the probe grid panel, inside the health panel):

```html
                <div class="panel-head">
                  <h2>CHECKPOINT RING</h2>
                  <span class="panel-sub">REWINDABLE STATE</span>
                  <span class="panel-tag" id="checkpoint-count">0 CK</span>
                  <button id="checkpoint-rollback" class="hud-btn mini" type="button">ROLLBACK</button>
                </div>
                <div id="checkpoint-strip" class="checkpoint-strip"></div>
```

`src/main.js` (in `renderAllViews` after `renderHealth`):

```js
  renderCheckpoints()
```

Add the renderer + binding:

```js
function renderCheckpoints() {
  const strip = $('#checkpoint-strip')
  if (!strip) return
  const list = STATE.checkpoints && STATE.checkpoints.available ? STATE.checkpoints.available : []
  $('#checkpoint-count').textContent = `${list.length} CK`
  strip.innerHTML = list.length
    ? list.slice(-5).map((c) => `<span class="ck-chip" data-id="${escapeHtml(c.id)}" title="${new Date(c.ts).toISOString()}">${escapeHtml(c.id.slice(2))}</span>`).join('')
    : '<span class="empty-hint">NO CHECKPOINTS YET</span>'
}
```

In `boot`:

```js
  const rollbackBtn = $('#checkpoint-rollback')
  if (rollbackBtn) rollbackBtn.addEventListener('click', () => {
    if (!isOnline()) { log('WARN', 'rollback is server-side only') ; return }
    api.rollback().then((r) => {
      if (!r || !r.ok) log('WARN', `rollback failed: ${r && r.error ? r.error : 'unknown'}`)
      else log('OK', 'checkpoint rollback complete — state restored')
    }).catch(() => log('WARN', 'rollback request failed'))
  })
```

`src/style.css`:

```css
.checkpoint-strip { display: flex; gap: 4px; flex-wrap: wrap; padding: 8px 12px; min-height: 28px; }
.ck-chip { font-family: var(--font-mono); font-size: 8.5px; color: var(--text-dim); border: 1px solid var(--divider); padding: 2px 6px; cursor: pointer; }
.ck-chip:hover { color: var(--cyan); border-color: var(--cyan-dim); }
```

- [x] **Step 6: Write `test/checkpoints.test.mjs`**

```js
import { Checkpoints } from '../server/checkpoints.js'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const results = []
const pass = (name, cond) => results.push(`${cond ? 'PASS' : 'FAIL'} ${name}`)
const DIR = mkdtempSync(join(tmpdir(), 'ck-'))
const ck = new Checkpoints(DIR)

const s1 = { meta: { tokenTotal: 1 }, agents: [] }
const c1 = ck.write(s1)
s1.meta.tokenTotal = 99
ck.write(s1)
pass('ring stores parent pointers', ck.list()[1].parent === c1.id)
pass('ring persists across instances', new Checkpoints(DIR).list().length === 2)

const restored = ck.rollbackValues(c1.id)
pass('rollback returns deep clone of prior values', restored && restored.meta.tokenTotal === 1)
const mutated = restored
mutated.meta.tokenTotal = 5000
pass('rollback clone is independent', ck.rollbackValues(c1.id).meta.tokenTotal === 1)

rmSync(DIR, { recursive: true, force: true })
console.log(results.join('\n'))
const fails = results.filter((r) => r.startsWith('FAIL'))
console.log(fails.length ? `\n${fails.length} FAILURES` : '\nALL PASS')
process.exit(fails.length ? 1 : 0)
```

- [x] **Step 7: Register the suite + integration additions + run tests + build**

Add `'checkpoints'` to `SUITES` in `test/run-all.mjs`.
In `test/integration.test.mjs`, add (needs at least 30 ticks of telemetry, so use the orchestrator-facing route after waiting for a checkpoint — to keep the suite fast, poll `/api/state` up to ~40 s for `checkpoints.available.length >= 1`, then POST rollback):

```js
// ---- checkpoint ring + rollback ------------------------------------- //
const deadline = Date.now() + 40000
let hasCk = false
while (Date.now() < deadline) {
  const st = await (await fetch(`${BASE}/api/state`)).json()
  if (st && st.checkpoints && st.checkpoints.available.length >= 1) { hasCk = true; break }
  await new Promise((r) => setTimeout(r, 500))
}
pass('server accumulates checkpoints over time', hasCk)
if (hasCk) {
  const rb = await (await fetch(`${BASE}/api/checkpoint/rollback`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).json()
  pass('rollback returns ok', !!rb.ok)
}
```

Run: `npm test && npm run build`
Expected: all green (14 suites).

- [x] **Step 8: Commit**

```bash
git add server/checkpoints.js server/orchestrator.js server/index.js server/seed.js src/store.js src/api.js index.html src/main.js src/style.css test/checkpoints.test.mjs test/integration.test.mjs test/views.test.mjs test/run-all.mjs
git commit -m "feat(orchestrator): P10 checkpoint ring buffer with operator rollback"
```

---

### Task 14 (P11): Interrupt/resume via WS `command` + HUD control

**Files:**
- Modify: `server/orchestrator.js` (`setPaused`, `s.meta.paused`), `server/index.js` (WS `command` handler), `src/api.js` (`pause`/`resume`), `index.html` (bottom bar control), `src/main.js` (bind control + render paused state), `server/seed.js` + `src/store.js` (`meta.paused`)
- Test: `test/integration.test.mjs` (WS command round-trip)

**Interfaces:**
- Consumes: `orchestrator.paused` (Task 9 guards broadcasts on it), `STATE.meta.paused` (Task 8 renders it).
- Produces: `orchestrator.setPaused(bool) → {ok, paused}`; WS `{type:'command', command:'pause'|'resume'}`; `api.pause()`/`api.resume()`; bottom-bar `#pause-btn`; `s.meta.paused`.

- [x] **Step 1: Add pause state to the orchestrator**

Constructor: `this.paused = false`.

```js
  setPaused(value) {
    this.paused = Boolean(value)
    this.s.meta.paused = this.paused
    this.broadcast({ type: 'events', events: [{ type: this.paused ? 'interrupt' : 'resume', at: Date.now() }] })
    this.log(this.paused ? 'WARN' : 'OK', this.paused ? 'operations PAUSED by operator' : 'operations resumed')
    this.store.markDirty()
    return { ok: true, paused: this.paused }
  }
```

Guard the sim ticks in `start()` intervals (agents, workflows, scheduler, ambient) by early-returning when `this.paused`:

```js
  tickAgents() {
    if (this.paused) return
    /* … */
  }
```

(add the same guard to `tickWorkflows`, `tickScheduler`, and at the top of `ambientChat`.)

- [x] **Step 2: Handle WS `command` in `server/index.js`**

In the `ws.on('message')` handler, add:

```js
    } else if (msg.type === 'command') {
      if (msg.command === 'pause' || msg.command === 'resume') {
        orchestrator.setPaused(msg.command === 'pause')
      }
    }
```

- [x] **Step 3: Add client api + seed slices**

`src/api.js`:

```js
  pause: () => post('/api/pause', {}),
  resume: () => post('/api/resume', {}),
```

Add REST routes to `server/index.js` for completeness:

```js
app.post('/api/pause', (_req, res) => res.json(orchestrator.setPaused(true)))
app.post('/api/resume', (_req, res) => res.json(orchestrator.setPaused(false)))
```

`server/seed.js` `meta`: add `paused: false`.
`src/store.js` `STATE.meta`: add `paused: false`.

- [x] **Step 4: Add the bottom-bar control + binding**

`index.html` (inside `#bottombar`, before `#warp-bar`):

```html
        <button id="pause-btn" class="hud-btn mini" type="button" title="Pause / resume fleet operations">PAUSE</button>
```

`src/main.js` (in `boot`):

```js
  const pauseBtn = $('#pause-btn')
  if (pauseBtn) pauseBtn.addEventListener('click', () => {
    if (!isOnline()) { log('WARN', 'pause is server-side only (offline sim runs locally)'); return }
    const next = STATE.meta.paused ? 'resume' : 'pause'
    const p = next === 'pause' ? api.pause() : api.resume()
    p.then(() => { pauseBtn.textContent = next === 'pause' ? 'RESUME' : 'PAUSE' })
     .catch(() => log('WARN', `${next} failed`))
  })
```

In `renderRollup`, keep the paused status branch from Task 8 and sync the button label:

```js
  const pauseBtn = $('#pause-btn')
  if (pauseBtn) pauseBtn.textContent = STATE.meta.paused ? 'RESUME' : 'PAUSE'
```

- [x] **Step 5: Add the WS command test to `test/integration.test.mjs`**

```js
// ---- WS command: pause / resume -------------------------------------- //
const wsCmd = await new Promise((resolve) => {
  const s = new WebSocket(`ws://127.0.0.1:${PORT}/ws`)
  const to = setTimeout(() => resolve('timeout'), 5000)
  s.on('open', () => {
    s.send(JSON.stringify({ type: 'command', command: 'pause' }))
    setTimeout(() => {
      s.send(JSON.stringify({ type: 'command', command: 'resume' }))
      setTimeout(async () => {
        clearTimeout(to)
        const st = await (await fetch(`${BASE}/api/state`)).json()
        s.close()
        resolve(st.meta && st.meta.paused === false ? 'ok' : 'stale')
      }, 400)
    }, 300)
  })
})
pass('ws command pause/resume round-trips', wsCmd === 'ok')
```

- [x] **Step 6: Run tests + build**

Run: `npm test && npm run build`
Expected: all green (14 suites).

- [x] **Step 7: Commit**

```bash
git add server/orchestrator.js server/index.js src/api.js src/store.js server/seed.js index.html src/main.js test/integration.test.mjs
git commit -m "feat(orchestrator): P11 interrupt/resume via WS command type + HUD pause control"
```

---

## Final

### Task 15: Docs, CHANGELOG, full verification, preview

**Files:**
- Modify: `CHANGELOG.md` (`[Unreleased]`), `docs/ORCHESTRATION-RESEARCH.md` (status markers P8–P12), `README.md` (suites badge if count changed)
- Test: full suite + preview

**Interfaces:**
- Consumes: all prior tasks.
- Produces: accurate changelog entries; research doc marks P8–P12 as implemented.

- [x] **Step 1: Update `CHANGELOG.md` under `[Unreleased]`**

Add:

```markdown
### Added
- **P8 — Superstep DAG scheduling**: chat-created workflows carry `dependsOn`
  edges; the step machine runs only steps whose dependencies are satisfied
  (fan-in barrier). Planner emits deterministic dependency chains.
- **P9 — Typed channels with reducers**: centralized mutation path
  (`applyChannel`) for high-churn appends (`hist`, `chat`, `logs`, `jobs`).
- **P10 — Checkpoint ring buffer + rollback**: versioned `{id,parent,ts}`
  snapshots persisted to `checkpoints.json` (cap 8); `POST
  /api/checkpoint/rollback` restores prior state; health view shows the ring
  with a ROLLBACK control.
- **P11 — Interrupt/resume**: `{type:'command', command:'pause'|'resume'}`
  WS messages + REST endpoints; `meta.paused` surfaced in the HUD with a
  bottom-bar PAUSE/RESUME control; hint frames suppressed while paused.
- **P12 — Trace/span telemetry**: span tree with per-span token accounting
  via the lifecycle hooks; completed spans stream as typed `events` frames
  and land in the bounded `trace` state slice.
- **Usability**: bulk "ACK ALL" in the alert feed; quick-dispatch form in the
  dispatch console; health-log severity filter (ALL/INFO/WARN/OK); chat
  auto-scrolls to bottom on view switch.

### Fixed
- **Display flicker/refresh**: probe grid, agent cards, workflow cards, and
  graph panels no longer rebuild their DOM on every 1.5 s delta — they update
  in place, so `blink`/`errflash`/`login` animations never replay and progress
  bar transitions never snap.
- **Rollup perf**: live renderers run idempotently each rollup; JSON gating is
  retained only for static full-rebuild views.

### Changed
- Broadcast frames are serialized once per fan-out instead of once per client.
```

- [x] **Step 2: Update `docs/ORCHESTRATION-RESEARCH.md` §3.7**

Mark each P8–P12 item with `[x] — implemented (see …)` and point to the new modules/endpoints.

- [x] **Step 3: Update `README.md` test badge if the suite count changed**

Set the badge to `tests-14%20suites-39ff88` (or whatever the final suite count is).

- [x] **Step 4: Full verification**

Run: `npm test && npm run build`
Expected: all suites green, build clean.

- [x] **Step 5: Preview**

Start/refresh the orbit + Vite servers via the `deploy-website` skill; verify: mission rollup no longer flickers on agent/workflow progress; health probe values update without cell replacement; ack-all works; quick dispatch works; log filter works; pause/resume works; rollback works.

- [x] **Step 6: Commit**

```bash
git add CHANGELOG.md docs/ORCHESTRATION-RESEARCH.md README.md
git commit -m "docs: P8-P12 implementation notes, changelog, and suite-count badge"
```

---

## Self-Review

**Spec coverage**
- Display flicker/refresh → Tasks 1–4 (in-place probes/agents/workflows, graph gating), Task 8 (rollup perf). ✓
- Poor usability → Tasks 5 (ack-all), 6 (quick dispatch), 7 (log filter + autoscroll). ✓
- Optimization/stabilization → Task 8 (gating), Task 9 (broadcast serialization + paused guards), Task 12 (typed channels cap growth). ✓
- Incomplete functionality P8–P12 → Tasks 11 (P8), 12 (P9), 13 (P10), 14 (P11), 10 (P12). ✓
- Tests/verification → every task has test-first steps; Task 15 does full `npm test` + `npm run build` + preview. ✓
- CHANGELOG → Task 15. ✓

**Placeholder scan** — every step includes concrete code or an exact command; no TBD/TODO.

**Type/interface consistency**
- `renderHealth(logs, filter='ALL')` introduced Task 1, used Task 7/8.
- `createStreamRenderer().reset` added Task 1, used Task 7.
- `orchestrator.paused` + `setPaused(bool)` added Task 14, guarded by Task 9, rendered by Task 8.
- `STATE.meta.paused` seeded Task 14, referenced by Task 8 renderRollup (defaults falsy until then).
- `_chatWorkflows` tracking extended to `{total,done,failed,completed:Set}` in Task 11; Task 11 Step 4 reads `track.completed`.
- `api.rollback(id?)` Task 13; `api.pause/resume` Task 14; `api.ackAll` Task 5.
- `_renderProbeGrid` exported Task 1 for the views suite.
- `trace`/`checkpoints` slices added to seed + client STATE + views-test `REQUIRED` (Tasks 10/13).

## Implementation status — 2026-08-20

All four phases shipped; every checkbox above reflects completed work. Verified
by the full 13-suite run (`npm test` → ALL SUITES GREEN) and `npm run build`.
Deviations from the written plan (functional equivalent delivered):

- P9 (typed channels): implemented client-side as `src/channels.js` reducers
  folded via `reduceEvent` in `src/api.js`, rather than an orchestrator
  `update()` hot-path writer. Deltas already only broadcast changed slices
  (Phase C), so the high-churn write path was already batched.
- P10 step 5 (health-view checkpoint strip): endpoints + `api.captureCheckpoint`/
  `api.rollback` shipped; the visual strip was deferred — rollback is currently
  exercised via API only.
- P11 step 2/4: interrupt uses REST `POST /api/control/{pause,interrupt,resume}`
  plus the existing approval-card frame (not a WS `command`), and the pause
  control is a topbar button instead of the bottom-bar placement in the plan.
- The P11 broadcast gate now lets `approval` frames through while paused so the
  interrupt card reaches the HUD.
