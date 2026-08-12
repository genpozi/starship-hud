/**
 * VIEWS // Renderers for every HUD view.
 * Every renderer reads from the shared STATE (store.js). In ONLINE mode the
 * orbit server owns state and pushes snapshots; in OFFLINE mode the local sim
 * mutates the same object. Interactions go through api.js when online.
 */

import { STATE } from './store.js'
import { api, isOnline } from './api.js'

const $ = (sel) => document.querySelector(sel)
const weekdays = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']

// ============================================================================
// RENDER GATING — skip a view render when its source data is unchanged so the
// DOM (and any running CSS animations on crit/warn/live rows) is never rebuilt
// on the idle refresh interval. Fixes constant flicker in the comms surfaces.
// ============================================================================
const viewSignatures = {}
export function changed(name, data) {
  let sig
  try {
    sig = JSON.stringify(data)
  } catch {
    sig = String(data)
  }
  if (viewSignatures[name] === sig) return false
  viewSignatures[name] = sig
  return true
}

// Incremental stream renderers: append only NEW rows, so existing `.chat-msg`
// / `.log-line` nodes keep their DOM identity and never replay the `login`
// entrance animation on the idle refresh. Falls back to a full rebuild when
// the stream is reset (server restart / snapshot).
const MAX_CHAT_ROWS = 60
const MAX_LOG_ROWS = 60
const chatKey = (m) => `${m.from}\u0000${m.text}\u0000${m.ts || ''}`
export const logKey = (l) => `${l.t}\u0000${l.level}\u0000${l.msg}`

/** Last index whose key matches (handles repeated identical lines). */
export function lastIndexMatching(arr, keyFn, key) {
  let idx = -1
  for (let i = 0; i < arr.length; i++) {
    if (keyFn(arr[i]) === key) idx = i
  }
  return idx
}

/** Trim DOM rows down to `max`, dropping the oldest from the front. */
function trimStream(box, domCount, max) {
  if (domCount <= max) return domCount
  const excess = domCount - max
  for (let i = 0; i < excess; i++) box.removeChild(box.firstChild)
  return max
}

/**
 * Factory for an append-only stream renderer with its own module state.
 * Returns `(box, rows) => void`. Only the new tail is appended, keeping DOM
 * node identity (and thus not restarting CSS animations) for existing rows.
 */
export function createStreamRenderer(keyFn, makeRow, maxRows, bottomPad = 40) {
  let lastKey = null
  let domCount = 0
  return (box, rows) => {
    if (!box || !Array.isArray(rows)) return
    const atBottom = box.scrollTop + box.clientHeight >= box.scrollHeight - bottomPad
    let start = 0
    let full = lastKey === null
    if (!full) {
      const idx = lastIndexMatching(rows, keyFn, lastKey)
      if (idx === -1) full = true
      else start = idx + 1
    }
    if (full) {
      box.innerHTML = ''
      domCount = 0
      if (!rows.length) {
        lastKey = null
        return
      }
    } else if (start === 0) {
      box.innerHTML = ''
      domCount = 0
    }
    if (start >= rows.length) return
    const frag = document.createDocumentFragment()
    for (let i = start; i < rows.length; i++) frag.appendChild(makeRow(rows[i]))
    box.appendChild(frag)
    domCount = trimStream(box, domCount + (rows.length - start), maxRows)
    lastKey = keyFn(rows[rows.length - 1])
    if (atBottom) box.scrollTop = box.scrollHeight
  }
}

// ============================================================================
// KANBAN
// ============================================================================
export function renderKanban() {
  const board = $('#kanban-board')
  if (!board) return
  board.innerHTML = ''
  STATE.kanban.columns.forEach((col) => {
    const cards = STATE.kanban.cards.filter((c) => c.col === col.id)
    const el = document.createElement('div')
    el.className = 'kanban-col'
    el.innerHTML = `
      <div class="kanban-col-head">
        <h3 style="color:${col.color}">${col.name}</h3>
        <span class="kanban-col-count">${cards.length}</span>
      </div>
      <div class="kanban-cards">
        ${cards
          .map(
            (c) => `
          <div class="kan-card ${col.id === 'done' ? 'done' : ''}" title="Click to advance" data-id="${c.id}">
            <div class="kan-title">${c.title}</div>
            <div class="kan-tags">${c.tags.map((t) => `<span class="kan-tag">${t}</span>`).join('')}</div>
            <div class="kan-meta">
              <span class="kan-agent">◈ ${c.agent}</span>
              <span class="kan-prio ${c.prio}">${c.prio}</span>
            </div>
          </div>`
          )
          .join('')}
      </div>`
    el.querySelectorAll('.kan-card').forEach((card) => {
      card.addEventListener('click', () => {
        const id = card.dataset.id
        if (isOnline()) {
          api.advanceCard(id).catch(() => {})
        } else {
          const c = STATE.kanban.cards.find((x) => x.id === id)
          if (!c) return
          const idx = STATE.kanban.columns.findIndex((col) => col.id === c.col)
          if (idx < STATE.kanban.columns.length - 1) c.col = STATE.kanban.columns[idx + 1].id
          else STATE.kanban.cards = STATE.kanban.cards.filter((x) => x.id !== id)
        }
        renderKanban()
      })
    })
    board.appendChild(el)
  })
}

// ============================================================================
// OPEN ITEMS
// ============================================================================
export function renderItems() {
  const table = $('#items-table')
  if (!table) return
  $('#items-count').textContent = `${STATE.items.length} TRACKED`
  table.innerHTML = `
    <div class="tbl-row tbl-head">
      <span>ID</span><span>TITLE</span><span>TYPE</span><span>PRIO</span><span>OWNER</span><span>STATUS</span>
    </div>
    ${STATE.items.map(
      (it) => `
    <div class="tbl-row">
      <span class="tbl-id">${it.id}</span>
      <span class="tbl-title">${it.title}</span>
      <span class="tbl-type ${it.type}">${it.type}</span>
      <span class="tbl-prio ${it.prio}">${it.prio}</span>
      <span class="tbl-assignee">${it.assignee}</span>
      <span class="tbl-status ${it.status}">${it.status.toUpperCase()}</span>
    </div>`
    ).join('')}`
}

// ============================================================================
// SCHEDULED TASKS
// ============================================================================
export function renderScheduler() {
  const table = $('#cron-table')
  if (!table) return
  $('#cron-count').textContent = `${STATE.schedules.length} JOBS`
  table.innerHTML = `
    <div class="tbl-row tbl-head">
      <span>JOB</span><span>CRON</span><span>AGENT</span><span>NEXT RUN</span><span>DURATION</span><span>LAST</span>
    </div>
    ${STATE.schedules.map(
      (j) => `
    <div class="cron-row">
      <span class="cron-name">${j.name}</span>
      <span class="cron-cron">${j.cron}</span>
      <span class="cron-agent">◈ ${j.agent}</span>
      <span class="cron-next">${j.next}</span>
      <span class="cron-dur">${j.dur}</span>
      <span class="cron-last ${j.last}">${j.last}</span>
    </div>`
    ).join('')}`
}

// ============================================================================
// CHAT / ORCHESTRATION
// ============================================================================
const renderChatStream = createStreamRenderer(chatKey, (m) => {
  const el = document.createElement('div')
  el.className = `chat-msg ${m.from === 'USER' ? 'user' : 'agent'}`
  el.innerHTML = `<div class="chat-from">${m.from}</div><div class="chat-text">${m.text}</div>`
  return el
}, MAX_CHAT_ROWS)

const renderHealthLog = createStreamRenderer(logKey, (l) => {
  const el = document.createElement('div')
  el.className = 'log-line'
  el.innerHTML = `<span class="log-ts">${l.t}</span><span class="log-lvl ${l.level}">${l.level}</span><span class="log-msg">${l.msg}</span>`
  return el
}, MAX_LOG_ROWS)

export function renderChat() {
  renderChatStream($('#chat-stream'), STATE.chat)
}
export function pushChat(from, text) {
  STATE.chat.push({ from, text, ts: Date.now() })
  renderChat()
}

export function renderDispatch() {
  const c = $('#dispatch-console')
  if (!c) return
  c.innerHTML = STATE.dispatch
    .map(
      (d) => `
  <div class="dispatch-item ${d.state}">
    <div class="dispatch-task">${d.task}</div>
    <div class="dispatch-meta"><span>◈ ${d.agent}</span><span>${d.state.toUpperCase()}</span></div>
  </div>`
    )
    .join('')
}

// ============================================================================
// OPERATOR APPROVAL (Hermes delegation bridge)
// ============================================================================
export function renderApproval() {
  const card = $('#approval-card')
  if (!card) return
  const p = STATE.approval && STATE.approval.pending
  if (!p) {
    card.classList.add('hidden')
    return
  }
  card.classList.remove('hidden')
  const agent = $('#approval-agent')
  const summary = $('#approval-summary')
  const detail = $('#approval-detail')
  if (agent) agent.textContent = (p.from || 'HERMES') + ' ▸ tool: ' + (p.tool || 'tool')
  if (summary) summary.textContent = p.summary || 'Hermes requests approval'
  if (detail) detail.textContent = p.detail || ''
}

// ============================================================================
// GRAPHS
// ============================================================================
function sparklineSvg(values, opts = {}) {
  const w = 100, h = 40, pad = 4
  const min = opts.min ?? Math.min(...values)
  const max = opts.max ?? Math.max(...values)
  const span = max - min || 1
  const pts = values.map((v, i) => {
    const x = pad + (i / (values.length - 1)) * (w - pad * 2)
    const y = h - pad - ((v - min) / span) * (h - pad * 2)
    return [x, y]
  })
  const line = pts.map((p) => p.join(',')).join(' ')
  const area = `${pad},${h - pad} ${line} ${w - pad},${h - pad}`
  return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
    <polygon class="garea" points="${area}"/>
    <polyline class="gline ${opts.cls || ''}" points="${line}"/>
    ${pts.map((p) => `<circle class="gdot" cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="1.6"/>`).join('')}
  </svg>`
}

function barChartSvg(values) {
  const w = 100, h = 40, pad = 2
  const max = Math.max(...values) || 1
  const bw = (w - pad * 2) / values.length
  const bars = values
    .map((v, i) => {
      const bh = (v / max) * (h - 8)
      const x = pad + i * bw + bw * 0.18
      return `<rect class="gbar" x="${x.toFixed(1)}" y="${(h - 2 - bh).toFixed(1)}" width="${(bw * 0.64).toFixed(1)}" height="${bh.toFixed(1)}"/>`
    })
    .join('')
  return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">${bars}</svg>`
}

export function renderGraphs(telemetry) {
  const tokens = $('#graph-tokens')
  if (!tokens) return
  tokens.innerHTML = `<div style="font-family:var(--font-mono);font-size:9px;color:var(--text-faint);margin-bottom:6px">CTX: ${Math.round(telemetry.ctx)}% · LAT: ${Math.round(telemetry.lat)}ms · TEMP: ${Math.round(telemetry.temp)}°</div>` +
    sparklineSvg([42, 48, 45, 55, 60, 58, 66, 70, 68, 74, 79, 82], { cls: 'amber' })

  const throughput = $('#graph-throughput')
  if (throughput) throughput.innerHTML = barChartSvg([4, 7, 5, 9, 6, 8, 10, 7, 6, 9, 8, 11])

  const context = $('#graph-context')
  if (context) context.innerHTML = sparklineSvg([18, 22, 20, 30, 28, 34, 38, 36, 44, 48, 46, 52])

  const success = $('#graph-success')
  if (success) success.innerHTML = sparklineSvg([88, 90, 87, 93, 91, 95, 92, 96, 94, 97, 96, 98], { min: 80 })
}

// ============================================================================
// VAULT
// ============================================================================
export function renderVault() {
  const grid = $('#vault-grid')
  if (!grid) return
  $('#vault-count').textContent = `${STATE.vault.length} DOCS`
  grid.innerHTML = STATE.vault.map(
    (d) => `
  <div class="vault-card" title="Open ${d.title}">
    <div class="vault-title">${d.title}</div>
    <div class="vault-meta">
      <span class="vault-type">${d.type}</span>
      <span>${d.size}</span>
      <span>${d.updated}</span>
    </div>
    <div class="vault-tags">${d.tags.map((t) => `<span class="vault-tag">${t}</span>`).join('')}</div>
  </div>`
  ).join('')
}

// ============================================================================
// EMAIL
// ============================================================================
export function renderEmail() {
  const list = $('#email-list')
  if (!list) return
  $('#email-count').textContent = `${STATE.email.filter((e) => !e.read).length} UNREAD`
  list.innerHTML = STATE.email.map(
    (e, i) => `
  <div class="email-row ${e.read ? '' : 'unread'}" data-i="${i}">
    <span class="email-from">${e.from}</span>
    <div>
      <div class="email-subject">${e.subject}</div>
      <div class="email-preview">${e.preview}</div>
    </div>
    <span class="email-time">${e.time}</span>
  </div>`
  ).join('')
  list.querySelectorAll('.email-row').forEach((row) => {
    row.addEventListener('click', () => {
      const i = +row.dataset.i
      const e = STATE.email[i]
      e.read = true
      if (isOnline()) api.readEmail(i).catch(() => {})
      renderEmail()
      const reader = $('#email-reader')
      if (reader) {
        reader.innerHTML = `
          <div class="reader-head">
            <div class="reader-subject">${e.subject}</div>
            <div class="reader-meta">
              <span>FROM: ${e.from}</span>
              <span>${e.time}</span>
              <span class="email-label ${e.label}">${e.label}</span>
            </div>
          </div>
          <div class="reader-body">${e.preview} Full message body rendered here for the selected thread. Attachments and inline signatures are supported by the HUD reader.</div>`
      }
    })
  })
}

// ============================================================================
// CALENDAR
// ============================================================================
export function renderCalendar() {
  const grid = $('#calendar-grid')
  if (!grid) return
  $('#cal-week').textContent = STATE.calendar.weekLabel
  const start = 8
  const end = 18
  let html = '<div></div>' + weekdays.slice(0, 5).map((d) => `<div class="cal-day-head">${d}</div>`).join('')
  for (let hour = start; hour <= end; hour++) {
    html += `<div class="cal-hour">${String(hour).padStart(2, '0')}:00</div>`
    for (let day = 0; day < 5; day++) {
      const events = STATE.calendar.events.filter((e) => e.day === day && parseInt(e.start) === hour)
      html += `<div class="cal-slot">${events
        .map((e) => `<div class="evt ${e.type}" data-day="${day}" style="height:${(e.end - e.start) * 26}px">${e.title}</div>`)
        .join('')}</div>`
    }
  }
  grid.innerHTML = html
  grid.querySelectorAll('.evt').forEach((ev) => {
    ev.addEventListener('click', () => selectCalDay(+ev.dataset.day))
  })
  selectCalDay(STATE.calendar.day, true)
}

function selectCalDay(day, force) {
  if (!force && day === STATE.calendar.day) return
  STATE.calendar.day = day
  if (isOnline()) api.setCalDay(day).catch(() => {})
  $('#cal-day-label').textContent = `${weekdays[day]} // CYCLE 42`
  const events = STATE.calendar.events.filter((e) => e.day === day)
  const box = $('#calendar-day')
  if (!box) return
  box.innerHTML = events.length
    ? events
        .map(
          (e) => `
      <div class="day-evt ${e.type}">
        <div class="day-evt-time">${e.start} – ${e.end}</div>
        <div class="day-evt-title">${e.title}</div>
        <div class="day-evt-agents">AGENTS: ${e.agents.join(', ')}</div>
      </div>`
        )
        .join('')
    : '<span class="empty-hint">NO EVENTS SCHEDULED</span>'
}

// ============================================================================
// ALERTS
// ============================================================================
export function renderAlerts() {
  const feed = $('#alert-feed')
  if (!feed) return
  const crit = STATE.alerts.filter((a) => a.sev === 'crit' && !a.acked).length
  const warn = STATE.alerts.filter((a) => a.sev === 'warn' && !a.acked).length
  const info = STATE.alerts.filter((a) => a.sev === 'info' && !a.acked).length
  $('#alert-count').textContent = `${crit + warn + info} ACTIVE`
  $('#alert-summary').innerHTML = `
    <div class="alert-sum-card crit"><span class="alert-sum-label">CRITICAL</span><span class="alert-sum-num">${crit}</span></div>
    <div class="alert-sum-card warn"><span class="alert-sum-label">WARNING</span><span class="alert-sum-num">${warn}</span></div>
    <div class="alert-sum-card info"><span class="alert-sum-label">INFO</span><span class="alert-sum-num">${info}</span></div>`
  feed.innerHTML = STATE.alerts
    .map(
      (a) => `
  <div class="alert-row ${a.acked ? 'acked' : ''}" data-id="${a.id}" title="${a.acked ? 'Acknowledged' : 'Click to ack'}">
    <span class="alert-sev ${a.sev}">${a.sev.toUpperCase()}</span>
    <span class="alert-source">${a.source}</span>
    <div>
      <div class="alert-title">${a.title}</div>
      <div class="alert-detail">${a.detail}</div>
    </div>
    <span class="alert-time">${a.time}</span>
  </div>`
    )
    .join('')
  feed.querySelectorAll('.alert-row').forEach((row) => {
    row.addEventListener('click', () => {
      const id = row.dataset.id
      const a = STATE.alerts.find((x) => x.id === id)
      if (!a || a.acked) return
      if (isOnline()) api.ackAlert(id).catch(() => {})
      else a.acked = true
      renderAlerts()
    })
  })
}

// ============================================================================
// SYSTEM HEALTH
// ============================================================================
export function renderHealth(logs) {
  const grid = $('#probe-grid')
  if (grid && changed('probes', STATE.probes)) {
    grid.innerHTML = STATE.probes.map((p) => {
      const crit = p.critAt > 0 && p.value >= p.critAt
      const warn = !crit && p.warnAt > 0 && p.value >= p.warnAt
      const state = crit ? 'crit' : warn ? 'warn' : 'ok'
      return `
    <div class="probe-cell ${crit ? 'crit' : warn ? 'warn' : ''}">
      <div class="probe-name">${p.name}${crit ? ' ▸ CRIT' : ''}</div>
      <div class="probe-val ${state}">${p.value}${p.unit}</div>
      <div class="probe-track"><div class="probe-fill" style="width:${p.value}%"></div></div>
    </div>`
    }).join('')
  }

  const box = $('#health-log')
  if (!box) return
  renderHealthLog(box, logs)
}

// ============================================================================
// RESEARCH REPORTS
// ============================================================================
export function renderReports() {
  const grid = $('#reports-grid')
  if (!grid) return
  $('#reports-count').textContent = `${STATE.reports.length} DOCS`
  grid.innerHTML = STATE.reports.map(
    (r) => `
  <div class="report-card" title="Open ${r.title}">
    <div class="report-title">${r.title}</div>
    <div class="report-abstract">${r.abstract}</div>
    <div class="report-meta">
      <span>BY ${r.author} · ${r.updated}</span>
      <span class="report-status ${r.status}">${r.status.toUpperCase()}</span>
    </div>
    <div class="report-tags">${r.tags.map((t) => `<span class="report-tag">${t}</span>`).join('')}</div>
  </div>`
  ).join('')
}
