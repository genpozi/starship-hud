import './style.css'
import { createGalaxy } from './galaxy.js'
import { SHIP, TOOLS, AGENDA } from './config.js'
import { STATE, applyServerState } from './store.js'
import { connect, api, isOnline, linkState } from './api.js'
import {
  renderKanban,
  renderItems,
  renderScheduler,
  renderChat,
  renderDispatch,
  renderGraphs,
  renderVault,
  renderEmail,
  renderCalendar,
  renderAlerts,
  renderHealth,
  renderReports,
  changed,
  createStreamRenderer,
  logKey,
  pushChat
} from './views.js'

/**
 * MAIN // Boots the galaxy renderer, the orbit-server bridge and the HUD
 * view router. When the STELLARIS-7 backend is reachable the server owns
 * state (WebSocket snapshots); when it is offline the HUD falls back to a
 * self-contained simulation so the console never goes dark.
 */

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

// ---- Log helpers (shared by server + sim mode) ---- //
function stamp() {
  return new Date().toISOString().slice(11, 19)
}
function log(level, msg) {
  STATE.logs.push({ t: stamp(), level, msg })
  if (STATE.logs.length > 160) STATE.logs.shift()
  renderLogs()
}
window.__log = log

// ============================================================================
// RENDERERS (mission control rollup)
// ============================================================================
function renderAgents() {
  if (!changed('agents', STATE.agents)) return
  const list = $('#agent-list')
  if (!list) return
  list.innerHTML = ''
  STATE.agents.forEach((a) => {
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
  renderLogStream($('#log-stream'), STATE.logs)
}

const renderLogStream = createStreamRenderer(
  logKey,
  (l) => {
    const el = document.createElement('div')
    el.className = 'log-line'
    el.innerHTML = `<span class="log-ts">${l.t}</span><span class="log-lvl ${l.level}">${l.level}</span><span class="log-msg">${l.msg}</span>`
    return el
  },
  40,
  30
)

function renderWorkflows() {
  if (!changed('workflows', STATE.workflows)) return
  const list = $('#workflow-list')
  if (!list) return
  const running = STATE.workflows.filter((w) => w.state === 'running').length
  $('#pipeline-count').textContent = `${running} RUNNING / ${STATE.workflows.length - running} QUEUED`
  list.innerHTML = ''
  STATE.workflows.forEach((w) => {
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
  if (!grid) return
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
  if (!list) return
  list.innerHTML = ''
  AGENDA.forEach((item) => {
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

function renderGauges() {
  const row = $('#gauge-row')
  if (!row) return
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

const C = 238.8
function setGauge(id, valEl, pct) {
  const g = $(`#${id}`)
  const v = $(`#${valEl}`)
  if (!g || !v) return
  g.style.strokeDashoffset = C - (C * Math.min(pct, 100)) / 100
  v.textContent = Math.round(pct)
}

function renderGaugeValues() {
  const t = STATE.telemetry
  if (!$('#g-temp')) return
  setGauge('g-temp', 'temp-val', ((t.temp - 30) / 60) * 100)
  setGauge('g-token', 'token-val', t.token)
  setGauge('g-lat', 'lat-val', ((t.lat - 30) / 400) * 100)
  setGauge('g-ctx', 'ctx-val', t.ctx)
  $('#g-ctx').style.stroke = t.ctx > 75 ? 'var(--warn)' : 'var(--ok)'
  $('#token-usage').textContent = `${STATE.meta.tokenTotal.toFixed(1)}K`
}

function tickClock() {
  $('#utc-clock').textContent = new Date().toISOString().slice(11, 19)
}

function tickFuel() {
  const fuel = 100 - ((Date.now() / 1000) % 3600) / 36
  $('#fuel-fill').style.width = `${Math.max(8, fuel)}%`
  $('#warp-fill').style.width = `${20 + ((Date.now() / 1000) % 40)}%`
}

function tickCoords() {
  const [ra, dec, dist] = STATE.meta.coordinates || SHIP.coordinates
  const drift = (Math.sin(Date.now() / 3000) * 0.15).toFixed(2)
  $('#coords').textContent = `${ra} // ${dec} // ${(parseFloat(dist) + parseFloat(drift)).toFixed(1)}`
}

function renderRollup() {
  renderAgents()
  renderWorkflows()
  renderGaugeValues()
  renderLogs()
  $('#agent-count').textContent = `${STATE.agents.filter((a) => a.state !== 'idle').length} ACTIVE / ${STATE.agents.length}`
  const sys = $('#system-status')
  const bad = STATE.agents.some((a) => a.state === 'error') || STATE.telemetry.ctx > 80
  const src = `SRC: ${(STATE.meta.dataSource || 'seed').toUpperCase()}`
  if (bad) {
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
  renderHealth(STATE.logs)
  if (changed('reports', STATE.reports)) renderReports()
  if (changed('workflows', STATE.workflows)) renderWorkflows()
}

// ============================================================================
// VIEW ROUTER
// ============================================================================
function showView(name) {
  document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'))
  document.querySelectorAll('.nav-btn').forEach((b) => b.classList.remove('active'))
  const view = document.getElementById(`view-${name}`)
  if (view) view.classList.add('active')
  const btn = document.querySelector(`.nav-btn[data-view="${name}"]`)
  if (btn) btn.classList.add('active')
}

function bindNavigation() {
  document.querySelectorAll('.nav-btn').forEach((btn) => {
    btn.addEventListener('click', () => showView(btn.dataset.view))
  })
}

// ============================================================================
// OFFLINE SIMULATION (fallback when the orbit server is unreachable)
// ============================================================================
const rand = (min, max) => min + Math.random() * (max - min)
let simTimers = []

function stopSim() {
  simTimers.forEach(clearInterval)
  simTimers = []
}

function startSim() {
  log('WARN', 'Orbit server unreachable — engaging local simulation')
  simTimers.push(setInterval(tickClock, 1000))
  simTimers.push(setInterval(tickFuel, 1000))
  simTimers.push(setInterval(tickCoords, 1000))
  simTimers.push(
    setInterval(() => {
      const t = STATE.telemetry
      t.temp = Math.max(35, Math.min(88, t.temp + rand(-1.6, 1.6)))
      t.lat = Math.max(40, Math.min(420, t.lat + rand(-18, 18)))
      t.ctx = Math.max(15, Math.min(92, t.ctx + rand(-2, 2)))
      STATE.meta.tokenTotal += rand(0.8, 3.2)
      renderRollup()
    }, 1200)
  )
  simTimers.push(
    setInterval(() => {
      STATE.agents.forEach((a) => {
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
      renderRollup()
    }, 900)
  )
  simTimers.push(
    setInterval(() => {
      STATE.workflows.forEach((w) => {
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
      renderRollup()
    }, 1400)
  )
  simTimers.push(
    setInterval(() => {
      if (Math.random() < 0.4) log('WARN', 'Spike detected in context load — throttling speculative token use')
    }, 15000)
  )
  simTimers.push(
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
  )
}

// ============================================================================
// CHAT dispatch
// ============================================================================
function sendChat() {
  const box = $('#chat-box')
  const text = box.value.trim()
  if (!text) return
  pushChat('USER', text)
  box.value = ''
  if (isOnline()) {
    api.chat(text).catch(() => log('WARN', 'Chat dispatch failed — retry'))
  } else {
    setTimeout(() => {
      const replies = [
        { agent: 'ORCH', text: 'Acknowledged. Decomposing and assigning to the appropriate fleet member.' },
        { agent: 'CODA', text: `Queued: "${text.slice(0, 40)}" — picking up after current batch.` },
        { agent: 'SAGE', text: 'Noted. Adding to research backlog for triage.' }
      ]
      const r = replies[Math.floor(Math.random() * replies.length)]
      pushChat(r.agent, r.text)
    }, 900)
  }
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

  renderAllViews()
  renderRollup()

  bindNavigation()

  const seedLogs = [
    'INFO', 'HUD link established — all subsystems nominal',
    'OK', 'Agent fleet handshake complete (6/6)',
    'INFO', 'Mission pipeline synced: workflows loaded',
    'OK', 'Galactic core scan initialized'
  ]
  for (let i = 0; i < seedLogs.length; i += 2) log(seedLogs[i], seedLogs[i + 1])

  $('#chat-send').addEventListener('click', sendChat)
  $('#chat-box').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') sendChat()
  })

  // always keep the local cosmetic clocks ticking
  setInterval(tickClock, 1000)
  setInterval(tickFuel, 1000)
  setInterval(tickCoords, 1000)

  // rollup + all views refresh — in ONLINE mode snapshots arrive via WS,
  // in OFFLINE mode the sim mutates STATE; both converge on the same renders
  setInterval(renderRollup, 1000)
  setInterval(renderAllViews, 1800)

  connect({
    onOnline: () => {
      stopSim()
      log('OK', 'Orbit link established — server state active')
    },
    onOffline: () => {
      startSim()
    }
  })
}

boot()
