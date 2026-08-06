import './style.css'
import { createGalaxy } from './galaxy.js'
import { SHIP, AGENTS, WORKFLOWS, TOOLS, AGENDA } from './config.js'

/**
 * MAIN // Boots the galaxy renderer and drives all HUD updates.
 * Everything is a lightweight DOM render; state lives in plain arrays
 * so the dashboard template is easy to re-theme or swap for a framework.
 */

// ---- State (mutable live data) ---- //
const fleet = AGENTS.map((a) => ({ ...a }))
const pipeline = WORKFLOWS.map((w) => ({ ...w, steps: [...w.steps] }))
const logs = []

const toolIcons = {
  code: '<polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>',
  terminal: '<polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/>',
  globe: '<circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>',
  search: '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
  files: '<path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/>',
  chip: '<rect x="5" y="5" width="14" height="14" rx="2"/><line x1="9" y1="2" x2="9" y2="5"/><line x1="15" y1="2" x2="15" y2="5"/><line x1="9" y1="19" x2="9" y2="22"/><line x1="15" y1="19" x2="15" y2="22"/><line x1="2" y1="9" x2="5" y2="9"/><line x1="2" y1="15" x2="5" y2="15"/><line x1="19" y1="9" x2="22" y2="9"/><line x1="19" y1="15" x2="22" y2="15"/>',
  db: '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 5v14c0 1.66-4 3-9 3s-9-1.34-9-3V5"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/>',
  plug: '<path d="M9 2v6"/><path d="M15 2v6"/><path d="M4 8h16v2a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4z"/><path d="M12 14v8"/>',
  map: '<polygon points="1 6 8 3 16 6 23 3 23 18 16 21 8 18 1 21"/><line x1="8" y1="3" x2="8" y2="18"/><line x1="16" y1="6" x2="16" y2="21"/>',
  mail: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 6L2 7"/>',
  cal: '<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>',
  bell: '<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>'
}

const $ = (sel) => document.querySelector(sel)

// ---- Timestamp / clock helpers ---- //
function stamp() {
  return new Date().toISOString().slice(11, 19)
}
function log(level, msg) {
  logs.push({ t: stamp(), level, msg })
  if (logs.length > 120) logs.shift()
  renderLogs()
}
window.__log = log // console access

// ============================================================================
// RENDERERS
// ============================================================================

function renderAgents() {
  const list = $('#agent-list')
  list.innerHTML = ''
  fleet.forEach((a) => {
    const el = document.createElement('div')
    el.className = `agent ${a.state}`
    el.innerHTML = `
      <div class="agent-top">
        <span class="agent-name">${a.name}</span>
        <span class="agent-state ${a.state}">${a.state.toUpperCase()}</span>
      </div>
      <div class="agent-role"><span>${a.role}</span><span>${a.tokens.toFixed(1)}K TK</span></div>
      <div class="agent-task">${a.state === 'idle' ? 'STANDING BY' : a.task}</div>
      <div class="agent-progress"><div class="agent-progress-fill" style="width:${a.progress}%"></div></div>
    `
    list.appendChild(el)
  })
}

function renderLogs() {
  const box = $('#log-stream')
  const atBottom = box.scrollTop + box.clientHeight >= box.scrollHeight - 30
  box.innerHTML = logs
    .slice(-40)
    .map((l) => `<div class="log-line"><span class="log-ts">${l.t}</span><span class="log-lvl ${l.level}">${l.level}</span><span class="log-msg">${l.msg}</span></div>`)
    .join('')
  if (atBottom) box.scrollTop = box.scrollHeight
}

function renderWorkflows() {
  const list = $('#workflow-list')
  const running = pipeline.filter((w) => w.state === 'running').length
  $('#pipeline-count').textContent = `${running} RUNNING / ${pipeline.length - running} QUEUED`
  list.innerHTML = ''
  pipeline.forEach((w) => {
    const el = document.createElement('div')
    el.className = `workflow ${w.state}`
    el.innerHTML = `
      <div class="wf-head">
        <span class="wf-name">${w.name}</span>
        <span class="wf-state ${w.state}">${w.state.toUpperCase()}</span>
      </div>
      <div class="wf-meta">
        <span>AGENTS: ${w.agents}</span>
        <span>ETA: ${w.eta}</span>
        <span>${w.progress}%</span>
      </div>
      <div class="wf-bar"><div class="wf-bar-fill" style="width:${w.progress}%"></div></div>
      <div class="wf-steps">${w.steps.map((s, i) => `<div class="wf-step ${s ? 'on' : ''} ${i === w.curStep && w.state === 'running' ? 'cur' : ''}"></div>`).join('')}</div>
    `
    list.appendChild(el)
  })
}

function renderTools() {
  const grid = $('#tool-grid')
  grid.innerHTML = ''
  TOOLS.forEach((t) => {
    const el = document.createElement('button')
    el.className = 'tool'
    el.title = t.name
    el.innerHTML = `
      <span class="tool-status ${t.status}"></span>
      <svg viewBox="0 0 24 24" fill="none" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${toolIcons[t.icon]}</svg>
      <span class="tool-name">${t.name.toUpperCase()}</span>
    `
    el.addEventListener('click', () => {
      el.style.borderColor = 'var(--line-amber)'
      log('OK', `Tool deployed: ${t.name.toUpperCase()}`)
      setTimeout(() => (el.style.borderColor = ''), 900)
    })
    grid.appendChild(el)
  })
}

function renderAgenda() {
  $('#agenda-date').textContent = new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }).toUpperCase()
  const list = $('#agenda-list')
  list.innerHTML = ''
  AGENDA.forEach((item, i) => {
    const el = document.createElement('div')
    el.className = 'agenda-item'
    el.innerHTML = `
      <span class="agenda-time">${item.time}</span>
      <span class="agenda-check"><svg viewBox="0 0 24 24" fill="none" stroke-width="4"><path d="M20 6 9 17l-5-5"/></svg></span>
      <span class="agenda-text">${item.text}</span>
      <span class="agenda-type ${item.type === 'mil' ? 'mil' : 'dep'}">${item.type === 'mil' ? 'MILESTONE' : 'DEPLOY'}</span>
    `
    el.addEventListener('click', () => el.classList.toggle('done'))
    list.appendChild(el)
  })
}

// ---- Gauges ---- //
function renderGauges() {
  const row = $('#gauge-row')
  row.innerHTML = `
    <div class="gauge-cell">
      <span class="gauge-label">CORE TEMP</span>
      <div class="radial-wrap">
        <svg width="92" height="92">
          <circle class="radial-bg" cx="46" cy="46" r="38"></circle>
          <circle class="radial-val" id="g-temp" cx="46" cy="46" r="38" stroke-dasharray="238.8" stroke-dashoffset="238.8"></circle>
        </svg>
        <div class="radial-center"><b id="temp-val">--</b><span>°C</span></div>
      </div>
    </div>
    <div class="gauge-cell">
      <span class="gauge-label">TOKEN BUDGET</span>
      <div class="radial-wrap">
        <svg width="92" height="92">
          <circle class="radial-bg" cx="46" cy="46" r="38"></circle>
          <circle class="radial-val" id="g-token" cx="46" cy="46" r="38" stroke-dasharray="238.8" stroke-dashoffset="238.8"></circle>
        </svg>
        <div class="radial-center"><b id="token-val">--</b><span>%</span></div>
      </div>
    </div>
    <div class="gauge-cell">
      <span class="gauge-label">LATENCY</span>
      <div class="radial-wrap">
        <svg width="92" height="92">
          <circle class="radial-bg" cx="46" cy="46" r="38"></circle>
          <circle class="radial-val" id="g-lat" cx="46" cy="46" r="38" stroke-dasharray="238.8" stroke-dashoffset="238.8"></circle>
        </svg>
        <div class="radial-center"><b id="lat-val">--</b><span>ms</span></div>
      </div>
    </div>
    <div class="gauge-cell">
      <span class="gauge-label">CONTEXT LOAD</span>
      <div class="radial-wrap">
        <svg width="92" height="92">
          <circle class="radial-bg" cx="46" cy="46" r="38"></circle>
          <circle class="radial-val" id="g-ctx" cx="46" cy="46" r="38" stroke-dasharray="238.8" stroke-dashoffset="238.8"></circle>
        </svg>
        <div class="radial-center"><b id="ctx-val">--</b><span>%</span></div>
      </div>
    </div>
  `
}

// ============================================================================
// LIVE SIMULATION
// ============================================================================

const rand = (min, max) => min + Math.random() * (max - min)
const C = 238.8 // circle circumference for r=38

let telemetry = { temp: 42, token: 38, lat: 84, ctx: 27 }
let tokenTotal = 0

function setGauge(id, valEl, pct) {
  $(`#${id}`).style.strokeDashoffset = C - (C * Math.min(pct, 100)) / 100
  $(`#${valEl}`).textContent = Math.round(pct)
}

function tickTelemetry() {
  telemetry.temp = Math.max(35, Math.min(88, telemetry.temp + rand(-1.6, 1.6)))
  telemetry.lat = Math.max(40, Math.min(420, telemetry.lat + rand(-18, 18)))
  telemetry.ctx = Math.max(15, Math.min(92, telemetry.ctx + rand(-2, 2)))

  setGauge('g-temp', 'temp-val', ((telemetry.temp - 30) / 60) * 100)
  setGauge('g-token', 'token-val', telemetry.token)
  setGauge('g-lat', 'lat-val', ((telemetry.lat - 30) / 400) * 100)
  setGauge('g-ctx', 'ctx-val', telemetry.ctx)

  $('#temp-val').textContent = Math.round(telemetry.temp)
  $('#lat-val').textContent = Math.round(telemetry.lat)
  $('#token-val').textContent = Math.round(telemetry.token)
  $('#ctx-val').textContent = Math.round(telemetry.ctx)

  const fillColor = telemetry.ctx > 75 ? 'var(--warn)' : 'var(--ok)'
  $('#g-ctx').style.stroke = fillColor

  // token usage bottom bar
  tokenTotal += rand(0.8, 3.2)
  $('#token-usage').textContent = `${(tokenTotal).toFixed(1)}K`
}

function tickFuel() {
  const fuel = 100 - ((Date.now() / 1000) % 3600) / 36 // drains over an hour
  $('#fuel-fill').style.width = `${Math.max(8, fuel)}%`
  $('#warp-fill').style.width = `${20 + ((Date.now() / 1000) % 40)}%`
}

function advanceAgents() {
  fleet.forEach((a) => {
    if (a.state === 'idle') {
      if (Math.random() < 0.06) {
        a.state = 'active'
        a.progress = 5
        a.task = a.id === 'link' ? 'Processing incoming webhook batch' : 'Picking up queued task'
        log('INFO', `${a.name} → ONLINE`)
      }
      return
    }
    a.progress = Math.min(100, a.progress + rand(0.4, 2.2))
    a.tokens += rand(0.05, 0.4)
    if (a.progress >= 100) {
      log('OK', `${a.name} completed: ${a.task}`)
      a.state = 'idle'
      a.task = 'Standing by'
      a.progress = 0
    }
  })
}

function advanceWorkflows() {
  pipeline.forEach((w) => {
    if (w.state === 'running') {
      w.progress = Math.min(100, w.progress + rand(0.15, 0.8))
      if (Math.random() < 0.2) w.curStep = Math.min(w.steps.length - 1, Math.floor((w.progress / 100) * w.steps.length))
      if (w.progress >= 100) {
        w.state = 'done'
        log('OK', `Workflow complete: ${w.name}`)
      }
    } else if (w.state === 'queued' && Math.random() < 0.015) {
      w.state = 'running'
      log('INFO', `Workflow dispatched: ${w.name}`)
    }
  })
}

function tickCoords() {
  const [ra, dec, dist] = SHIP.coordinates
  const drift = (Math.sin(Date.now() / 3000) * 0.15).toFixed(2)
  $('#coords').textContent = `${ra} // ${dec} // ${(parseFloat(dist) + parseFloat(drift)).toFixed(1)}`
}

function tickClock() {
  $('#utc-clock').textContent = new Date().toISOString().slice(11, 19)
}

// ============================================================================
// BOOT
// ============================================================================

export function boot() {
  createGalaxy($('#galaxy-canvas'))

  renderAgents()
  renderWorkflows()
  renderTools()
  renderAgenda()
  renderGauges()

  $('#active-mission').textContent = SHIP.mission
  $('#agent-count').textContent = `${fleet.filter((a) => a.state !== 'idle').length} ACTIVE / ${fleet.length}`

  const seedLogs = [
    'INFO', 'HUD link established — all subsystems nominal',
    'OK', 'Agent fleet handshake complete (6/6)',
    'INFO', 'Mission pipeline synced: 4 workflows loaded',
    'OK', 'Galactic core scan initialized'
  ]
  for (let i = 0; i < seedLogs.length; i += 2) log(seedLogs[i], seedLogs[i + 1])

  setInterval(tickClock, 1000)
  setInterval(tickTelemetry, 1200)
  setInterval(tickFuel, 1000)
  setInterval(advanceAgents, 900)
  setInterval(advanceWorkflows, 1400)
  setInterval(tickCoords, 1000)

  // throttle agent re-render
  setInterval(() => {
    renderAgents()
    renderWorkflows()
    $('#agent-count').textContent = `${fleet.filter((a) => a.state !== 'idle').length} ACTIVE / ${fleet.length}`
    const bad = fleet.some((a) => a.state === 'error') || telemetry.ctx > 80
    const sys = $('#system-status')
    if (bad) {
      sys.classList.add('warn')
      sys.innerHTML = '<span class="status-dot warn"></span> DEGRADED OPERATIONS'
    } else {
      sys.classList.remove('warn')
      sys.innerHTML = '<span class="status-dot online"></span> ALL SYSTEMS NOMINAL'
    }
  }, 1200)

  // occasionally inject a warning into the log
  setInterval(() => {
    if (Math.random() < 0.4) log('WARN', 'Spike detected in context load — throttling speculative token use')
  }, 15000)

  // some ambient logs
  setInterval(() => {
    const events = [
      ['INFO', 'Heartbeat received from all fleet nodes'],
      ['DEBUG', 'GC cycle complete · heap steady'],
      ['OK', 'Telemetry snapshot archived to core bank'],
      ['INFO', 'Orbital debris sweep complete — all clear']
    ]
    const [lvl, msg] = events[Math.floor(Math.random() * events.length)]
    log(lvl, msg)
  }, 6000)
}

boot()
