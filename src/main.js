import './style.css'
import { STATE, applyServerState } from './store.js'
import { connect, api, isOnline, linkState } from './api.js'
import { TOOLS, SHIP, AGENDA } from './config.js'
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
  renderApproval,
  changed,
  createStreamRenderer,
  escapeHtml,
  logKey,
  pushChat,
  getSelectedEmailId,
  getSelectedEventId,
  setEmailFolder
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
    const newClass = `agent ${a.state}`
    if (el.className !== newClass) el.className = newClass
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

let logFilter = 'ALL'

function setLogFilter(level) {
  if (logFilter === level) return
  logFilter = level
  document.querySelectorAll('.filter-chip').forEach((c) => c.classList.toggle('active', c.dataset.level === level))
  renderHealthLog.reset()
  renderHealth(STATE.logs, logFilter)
}

function renderLogs() {
  renderLogStream($('#log-stream'), STATE.logs)
}

const renderLogStream = createStreamRenderer(
  logKey,
  (l) => {
    const el = document.createElement('div')
    el.className = 'log-line'
    el.innerHTML = `<span class="log-ts">${escapeHtml(l.t)}</span><span class="log-lvl ${l.level}">${escapeHtml(l.level)}</span><span class="log-msg">${escapeHtml(l.msg)}</span>`
    return el
  },
  40,
  30
)

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
      <span class="tool-name">${escapeHtml(t.name).toUpperCase()}</span>
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
      <span class="agenda-time">${escapeHtml(item.time)}</span>
      <span class="agenda-check"><svg viewBox="0 0 24 24" fill="none" stroke-width="4"><path d="M20 6 9 17l-5-5"/></svg></span>
      <span class="agenda-text">${escapeHtml(item.text)}</span>
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
  const src = `SRC: ${escapeHtml((STATE.meta.dataSource || 'seed').toUpperCase())}`
  const pauseBtn = $('#pause-btn')
  const pauseLabel = $('#pause-label')
  if (pauseLabel) pauseLabel.textContent = STATE.meta.paused ? 'RESUME' : 'PAUSE'
  if (pauseBtn) pauseBtn.classList.toggle('active', !!STATE.meta.paused)
  if (STATE.meta.paused) {
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
  if (changed('calendar', [STATE.calendar.day, STATE.calendar.weekStart, STATE.calendar.events])) renderCalendar()
  if (changed('alerts', STATE.alerts)) renderAlerts()
  renderHealth(STATE.logs, logFilter)
  renderApproval()
  if (changed('reports', STATE.reports)) renderReports()
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
  if (name === 'chat') {
    const stream = $('#chat-stream')
    if (stream) stream.scrollTop = stream.scrollHeight
  }
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
      t.hist = t.hist || []
      t.hist.push({
        ts: Date.now(),
        temp: Math.round(t.temp * 10) / 10,
        lat: Math.round(t.lat),
        ctx: Math.round(t.ctx),
        token: Math.round(t.token),
        tokenTotal: Math.round(STATE.meta.tokenTotal * 10) / 10,
        jobs: { ...(t.jobs || { done: 0, failed: 0 }) }
      })
      if (t.hist.length > 90) t.hist.splice(0, t.hist.length - 90)
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
/** Mirrors the server's mention detection so OFFLINE replies route the same
 *  way: @NAME anywhere (case-insensitive) or a bare capitalized crew name. */
function offlineMention(text) {
  const t = String(text || '').trim()
  const upper = t.toUpperCase()
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  for (const n of ['ORCHESTRATOR', 'CODA', 'PILOT', 'SAGE', 'LINK', 'NUDGE']) {
    if (new RegExp(`@${esc(n)}(?=\\W|$)`).test(upper)) return n
    if (new RegExp(`(?:^|[\\s])${esc(n)}(?=[:,\\s]|$)`).test(t)) return n
  }
  if (/(?:^|[\s])ORCH(?=[:,\s]|$)/.test(t) || /@ORCH(?=\W|$)/.test(upper)) return 'ORCHESTRATOR'
  return null
}

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
      // offline: reply in-character from the fleet state (persona + knowledge),
      // never a random canned line, so the sim stays coherent with the board
      const mentioned = offlineMention(text)
      const agent = (mentioned && STATE.agents.find((a) => a.name === mentioned))
        || STATE.agents.find((a) => a.state !== 'idle')
        || STATE.agents[0]
      const topic = text.replace(/@\w+/gi, '').trim().split(' ').filter((w) => w.length > 4).slice(0, 4).join(' ')
      const doc = topic ? STATE.vault.find((d) => d.title.toLowerCase().includes(topic.toLowerCase())) : null
      const task = agent.task !== 'Standing by' ? `Picking that up after ${agent.task.toLowerCase()}.` : 'Clearing a slot for it now.'
      const grounded = doc ? ` We have ${doc.title} on file if that helps.` : ''
      pushChat(agent.name, `Acknowledged. ${task}${grounded}`)
    }, 900)
  }
}

// ============================================================================
// BOOT
// ============================================================================
export async function boot() {
  // galaxy is a heavy Three.js chunk — load it async so the initial bundle
  // stays lean and the HUD shell paints immediately
  const galaxy = await import('./galaxy.js')
  galaxy.createGalaxy($('#galaxy-canvas'))

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

  const pauseBtn = $('#pause-btn')
  if (pauseBtn) pauseBtn.addEventListener('click', () => {
    const toggle = () => (STATE.meta.paused ? api.resume() : api.pause())
    if (isOnline()) toggle().then(() => renderAllViews()).catch(() => log('WARN', 'pause toggle failed'))
    else {
      STATE.meta.paused = !STATE.meta.paused
      renderAllViews()
    }
  })
  $('#approval-approve').addEventListener('click', () => {
    api.approval('approve').catch(() => {})
    renderApproval()
  })
  $('#approval-deny').addEventListener('click', () => {
    api.approval('deny').catch(() => {})
    renderApproval()
  })

  const ackAll = $('#alerts-ack-all')
  if (ackAll) ackAll.addEventListener('click', () => {
    if (isOnline()) api.ackAll().catch(() => log('WARN', 'bulk ack failed'))
    else {
      STATE.alerts.forEach((a) => { a.acked = true })
      renderAlerts()
    }
  })

  const dispatchAgent = $('#dispatch-agent')
  if (dispatchAgent) {
    STATE.agents.forEach((a) => {
      const opt = document.createElement('option')
      opt.value = a.name
      opt.textContent = a.name
      dispatchAgent.appendChild(opt)
    })
  }
  function readComposeAttachments(input) {
    const files = Array.from(input?.files || [])
    if (!files.length) return Promise.resolve([])
    const cap = 200000
    let total = 0
    const chosen = []
    for (const f of files) {
      if (total + f.size > cap) break
      total += f.size
      chosen.push(f)
    }
    return Promise.all(chosen.map((f) => new Promise((resolve) => {
      const reader = new FileReader()
      reader.onload = () => {
        const raw = String(reader.result || '')
        const data = raw.includes(',') ? raw.slice(raw.indexOf(',') + 1) : raw
        resolve({ name: f.name, mime: f.type || 'application/octet-stream', size: f.size, data })
      }
      reader.onerror = () => resolve(null)
      reader.readAsDataURL(f)
    }))).then((parts) => parts.filter(Boolean))
  }

  const emailForm = $('#email-compose')
  if (emailForm) emailForm.addEventListener('submit', (e) => {
    e.preventDefault()
    const to = ($('#email-to')?.value || '').trim()
    const subject = ($('#email-subject')?.value || '').trim()
    const body = ($('#email-body')?.value || '').trim()
    if (!to || !subject) return
    const attachInput = $('#email-attach')
    readComposeAttachments(attachInput).then((attachments) => {
      $('#email-to').value = ''
      $('#email-subject').value = ''
      $('#email-body').value = ''
      if (attachInput) attachInput.value = ''
      log('INFO', `Compose → ${to}: ${subject}`)
      if (isOnline()) api.sendMail(to, subject, body, attachments).then(() => {
        setEmailFolder('sent')
        renderEmail()
      }).catch(() => log('WARN', 'send failed'))
      else {
        STATE.email.unshift({
          id: `local-${Date.now()}`,
          from: 'operator@stellaris.internal',
          to,
          subject,
          preview: body.slice(0, 140),
          body,
          time: new Date().toISOString().slice(11, 16),
          label: 'MAIL',
          read: true,
          prio: 'med',
          folder: 'sent',
          src: 'local',
          attachments: attachments.map((a) => ({ name: a.name, mime: a.mime, size: a.size }))
        })
        setEmailFolder('sent')
        renderEmail()
      }
    })
  })
  document.querySelectorAll('.email-folder-tab').forEach((tab) => {
    tab.addEventListener('click', () => setEmailFolder(tab.dataset.folder))
  })
  const replyBtn = $('#email-reply')
  if (replyBtn) replyBtn.addEventListener('click', () => {
    const id = getSelectedEmailId()
    const target = (STATE.email || []).find((m) => m && m.id === id)
    if (!target) return
    const toEl = $('#email-to')
    const subEl = $('#email-subject')
    const bodyEl = $('#email-body')
    if (toEl) toEl.value = target.from || target.to || ''
    if (subEl) {
      const sub = String(target.subject || '')
      subEl.value = /^re:/i.test(sub) ? sub : `Re: ${sub}`
    }
    if (bodyEl) bodyEl.value = ''
    toEl?.focus()
  })
  const archiveBtn = $('#email-archive')
  if (archiveBtn) archiveBtn.addEventListener('click', () => {
    const id = getSelectedEmailId()
    const target = (STATE.email || []).find((m) => m && m.id === id)
    if (!target) return
    target.folder = 'archive'
    if (isOnline()) api.archiveEmail(target.id).catch(() => {})
    renderEmail()
  })
  const calForm = $('#cal-create')
  if (calForm) calForm.addEventListener('submit', (e) => {
    e.preventDefault()
    const title = ($('#cal-title')?.value || '').trim()
    const start = ($('#cal-start')?.value || '09:00').trim()
    const end = ($('#cal-end')?.value || '10:00').trim()
    if (!title) return
    $('#cal-title').value = ''
    const day = STATE.calendar.day
    log('INFO', `Book ${title} ${start}–${end}`)
    if (isOnline()) api.createEvent({ title, day, start, end }).then(() => renderCalendar()).catch(() => log('WARN', 'book failed'))
    else {
      STATE.calendar.events.push({ id: `local-${Date.now()}`, day, start, end, title, type: 'dep', agents: ['USER'], src: 'local' })
      renderCalendar()
    }
  })
  function shiftLocalWeek(delta) {
    const cur = STATE.calendar.weekStart || new Date().toISOString().slice(0, 10)
    const d = new Date(`${cur}T00:00:00`)
    d.setDate(d.getDate() + Number(delta || 0) * 7)
    STATE.calendar.weekStart = d.toISOString().slice(0, 10)
    STATE.calendar.weekLabel = `WEEK ${STATE.calendar.weekStart}`
    renderCalendar()
  }
  const calPrev = $('#cal-prev')
  if (calPrev) calPrev.addEventListener('click', () => {
    if (isOnline()) api.setCalWeek({ delta: -1 }).then(() => renderCalendar()).catch(() => log('WARN', 'week nav failed'))
    else shiftLocalWeek(-1)
  })
  const calNext = $('#cal-next')
  if (calNext) calNext.addEventListener('click', () => {
    if (isOnline()) api.setCalWeek({ delta: 1 }).then(() => renderCalendar()).catch(() => log('WARN', 'week nav failed'))
    else shiftLocalWeek(1)
  })
  const calDelete = $('#cal-delete')
  if (calDelete) calDelete.addEventListener('click', () => {
    const id = getSelectedEventId()
    if (!id) return
    const events = STATE.calendar.events || []
    const idx = events.findIndex((e) => e && e.id === id)
    if (idx < 0) return
    events.splice(idx, 1)
    if (isOnline()) api.deleteEvent(id).catch(() => {})
    renderCalendar()
  })

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

  document.querySelectorAll('.filter-chip').forEach((chip) => {
    chip.addEventListener('click', () => setLogFilter(chip.dataset.level))
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
