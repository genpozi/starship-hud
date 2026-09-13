/**
 * VIEWS // Renderers for every HUD view.
 * Every renderer reads from the shared STATE (store.js). In ONLINE mode the
 * orbit server owns state and pushes snapshots; in OFFLINE mode the local sim
 * mutates the same object. Interactions go through api.js when online.
 */

import { STATE } from './store.js'
import { api, isOnline, getOperatorId } from './api.js'

const $ = (sel) => document.querySelector(sel)
const weekdays = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']
const pendingIds = new Set()

export function lockPending(id, ms = 400) {
  if (!id) return false
  if (pendingIds.has(id)) return false
  pendingIds.add(id)
  setTimeout(() => pendingIds.delete(id), ms)
  return true
}

function isPending(id) {
  return pendingIds.has(id)
}

function setSyncWarn(el, errs) {
  if (!el) return
  const n = Array.isArray(errs) ? errs.length : errs ? 1 : 0
  if (!n) {
    el.textContent = ''
    el.classList.add('hidden')
    return
  }
  el.textContent = n === 1 ? 'SYNC WARN' : `SYNC WARN ${n}`
  el.classList.remove('hidden')
  const msg = Array.isArray(errs) ? errs[0] : errs
  if (msg) el.title = String(msg)
}

/**
 * Escape a value for safe injection into innerHTML. Every renderer routes
 * state-derived strings (chat text, external GitHub/Hermes titles, probe
 * names, log lines) through this so untrusted data can never execute.
 */
export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

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

/** Last hist signature rendered by renderGraphs (skip rebuild when unchanged). */
export let _lastHistKey = null

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
  const renderer = (box, rows) => {
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
  renderer.reset = () => {
    lastKey = null
    domCount = 0
  }
  return renderer
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
          <div class="kan-card ${col.id === 'done' ? 'done' : ''}${c.src === 'hermes' ? ' he' : ''}" title="Click to advance" data-id="${c.id}">
            <div class="kan-title">${escapeHtml(c.title)}</div>
            <div class="kan-tags">${(c.tags || []).map((t) => `<span class="kan-tag">${escapeHtml(t)}</span>`).join('')}</div>
            <div class="kan-meta">
              <span class="kan-agent">◈ ${escapeHtml(c.agent)}</span>
              <span class="kan-prio ${c.prio}">${escapeHtml(c.prio)}</span>
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
const ITEM_STATUSES = ['open', 'watch', 'review', 'closed']

function nextItemStatus(cur) {
  const s = String(cur || 'open').toLowerCase()
  const idx = ITEM_STATUSES.indexOf(s === 'merged' ? 'closed' : s)
  return ITEM_STATUSES[(idx < 0 ? 0 : idx + 1) % ITEM_STATUSES.length]
}

export function renderItems() {
  const table = $('#items-table')
  if (!table) return
  $('#items-count').textContent = `${STATE.items.length} TRACKED`
  table.innerHTML = `
    <div class="tbl-row tbl-head">
      <span>ID</span><span>TITLE</span><span>TYPE</span><span>PRIO</span><span>OWNER</span><span>STATUS</span>
    </div>
     ${(STATE.items || []).length
      ? (STATE.items || []).map(
      (it) => `
    <div class="tbl-row${isPending(it.id) ? ' pending' : ''}" data-id="${escapeHtml(it.id)}">
      <span class="tbl-id">${escapeHtml(it.id)}</span>
      <span class="tbl-title">${escapeHtml(it.title || it.label || '')}</span>
      <span class="tbl-type ${escapeHtml(it.type || '')}">${escapeHtml(it.type || '')}</span>
      <span class="tbl-prio ${escapeHtml(it.prio || '')}">${escapeHtml(it.prio || '')}</span>
      <span class="tbl-assignee">${escapeHtml(it.assignee || '')}</span>
      <span class="tbl-status ${escapeHtml(it.status || 'open')}">${escapeHtml(it.status || 'open').toUpperCase()}</span>
    </div>`
    ).join('')
      : '<div class="tbl-row"><span class="empty-hint">NO OPEN ITEMS ▸</span></div>'}`
  table.querySelectorAll('.tbl-row[data-id]').forEach((row) => {
    row.addEventListener('click', () => {
      const it = (STATE.items || []).find((x) => x && x.id === row.dataset.id)
      if (!it || !lockPending(it.id)) return
      it.status = nextItemStatus(it.status)
      if (isOnline()) api.cycleItemStatus(it.id).catch(() => {})
      renderItems()
    })
  })
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
     ${(STATE.schedules || []).length
      ? (STATE.schedules || []).map(
      (j) => `
    <div class="cron-row${j.src === 'hermes' ? ' he' : ''}${j.paused ? ' paused' : ''}${isPending(j.id) ? ' pending' : ''}" data-id="${escapeHtml(j.id)}" title="${j.src === 'hermes' ? 'Hermes ingest-authoritative' : j.paused ? 'Click to resume' : 'Click to pause'}">
      <span class="cron-name">${escapeHtml(j.name || j.title || '')}</span>
      <span class="cron-cron">${escapeHtml(j.cron)}</span>
      <span class="cron-agent">◈ ${escapeHtml(j.agent || '')}</span>
      <span class="cron-next">${escapeHtml(j.paused ? 'HOLD' : j.next)}</span>
      <span class="cron-dur">${escapeHtml(j.dur || '')}</span>
      <span class="cron-last ${escapeHtml(j.last || '')}">${escapeHtml(j.paused ? 'HOLD' : j.last || '')}</span>
    </div>`
    ).join('')
      : '<div class="cron-row"><span class="empty-hint">NO SCHEDULED JOBS ▸</span></div>'}`
  table.querySelectorAll('.cron-row[data-id]').forEach((row) => {
    row.addEventListener('click', () => {
      const job = (STATE.schedules || []).find((x) => x && x.id === row.dataset.id)
      if (!job || job.src === 'hermes' || !lockPending(job.id)) return
      job.paused = !job.paused
      if (isOnline()) api.toggleSchedule(job.id).catch(() => {})
      renderScheduler()
    })
  })
}

// ============================================================================
// CHAT / ORCHESTRATION
// ============================================================================
const renderChatStream = createStreamRenderer(chatKey, (m) => {
  const el = document.createElement('div')
  el.className = `chat-msg ${m.from === 'USER' ? 'user' : 'agent'}`
  el.innerHTML = `<div class="chat-from">${escapeHtml(m.from)}</div><div class="chat-text">${escapeHtml(m.text)}</div>`
  return el
}, MAX_CHAT_ROWS)

const renderHealthLog = createStreamRenderer(logKey, (l) => {
  const el = document.createElement('div')
  el.className = 'log-line'
  el.innerHTML = `<span class="log-ts">${escapeHtml(l.t)}</span><span class="log-lvl ${l.level}">${escapeHtml(l.level)}</span><span class="log-msg">${escapeHtml(l.msg)}</span>`
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
    <div class="dispatch-task">${escapeHtml(d.task)}</div>
    <div class="dispatch-meta"><span>◈ ${escapeHtml(d.agent)}</span><span>${escapeHtml(d.state).toUpperCase()}</span></div>
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
  const mine = !p.owner || p.owner === getOperatorId()
  card.classList.toggle('foreign', !mine)
  if (detail) detail.textContent = mine ? (p.detail || '') : `AWAITING OWNER ${p.owner}`
  const actions = card.querySelector('.approval-actions')
  if (actions) actions.classList.toggle('hidden', !mine)
}

// ============================================================================
// GRAPHS
// ============================================================================
function sparklineSvg(values, opts = {}) {
  const w = 100, h = 40, pad = 4
  const min = opts.min ?? Math.min(...values)
  const max = opts.max ?? Math.max(...values)
  const span = max - min || 1
  const denom = values.length - 1 || 1
  const pts = values.map((v, i) => {
    const x = pad + (i / denom) * (w - pad * 2)
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
  const hist = Array.isArray(telemetry.hist) && telemetry.hist.length
    ? telemetry.hist
    : [
        { ctx: 27, lat: 84, temp: 42, token: 38 },
        { ctx: 30, lat: 100, temp: 45, token: 42 },
        { ctx: 34, lat: 118, temp: 48, token: 47 },
        { ctx: 38, lat: 90, temp: 44, token: 51 },
        { ctx: 44, lat: 130, temp: 50, token: 56 },
        { ctx: 48, lat: 112, temp: 47, token: 60 }
      ]
  const histKey = hist.length ? `${hist.length}:${hist[hist.length - 1].ts}` : '0'
  if (_lastHistKey === histKey) return
  _lastHistKey = histKey
  const ctxSeries = hist.map((h) => h.ctx)
  const latSeries = hist.map((h) => h.lat)
  const tempSeries = hist.map((h) => h.temp)
  const tokenSeries = hist.map((h) => h.token)
  const jobs = telemetry.jobs || { done: 0, failed: 0 }
  const total = jobs.done + jobs.failed
  const successPct = total > 0 ? Math.round((jobs.done / total) * 100) : 100
  const last = hist[hist.length - 1]
  const lastCtx = last ? last.ctx : telemetry.ctx
  const lastLat = last ? last.lat : telemetry.lat
  const lastTemp = last ? last.temp : telemetry.temp

  tokens.innerHTML = `<div style="font-family:var(--font-mono);font-size:9px;color:var(--text-faint);margin-bottom:6px">TOKEN: ${Math.round(tokenSeries[tokenSeries.length - 1] || 0)}% · CTX: ${Math.round(lastCtx)}% · LAT: ${Math.round(lastLat)}ms · TEMP: ${Math.round(lastTemp)}°</div>` +
    sparklineSvg(tokenSeries, { cls: 'amber' })

  const throughput = $('#graph-throughput')
  if (throughput) throughput.innerHTML = barChartSvg(latSeries.map((v) => Math.max(2, Math.round(v / 45))))

  const context = $('#graph-context')
  if (context) context.innerHTML = sparklineSvg(ctxSeries)

  const successSeries = hist.map((h) => {
    const j = h.jobs || jobs
    const tot = (j.done || 0) + (j.failed || 0)
    return tot > 0 ? Math.round((j.done / tot) * 100) : 100
  })
  const success = $('#graph-success')
  if (success) success.innerHTML = sparklineSvg(successSeries, { min: 80 }) +
    `<div style="font-family:var(--font-mono);font-size:9px;color:var(--text-faint);margin-top:6px">SUCCESS ${successPct}% · ${jobs.done} OK / ${jobs.failed} FAIL</div>`

  const tokensFoot = $('#graph-token-foot')
  if (tokensFoot) tokensFoot.textContent = `BUDGET ${Math.round(tokenSeries[tokenSeries.length - 1])}%`
}

// ============================================================================
// VAULT
// ============================================================================
let selectedVaultId = null
export function getSelectedVaultId() {
  return selectedVaultId
}

export function knowledgeQuery(raw) {
  return String(raw || '').trim().toLowerCase()
}

export function matchesKnowledge(item, q) {
  if (!q) return true
  if (!item) return false
  const title = String(item.title || '').toLowerCase()
  if (title.includes(q)) return true
  const type = String(item.type || '').toLowerCase()
  if (type.includes(q)) return true
  const tags = (item.tags || []).map((t) => String(t).toLowerCase())
  return tags.some((t) => t.includes(q) || q.includes(t))
}

function filterKnowledge(items, sel) {
  const q = knowledgeQuery($(sel)?.value)
  return (items || []).filter((item) => matchesKnowledge(item, q))
}

function setKnowledgeCount(sel, shown, total, unit) {
  const el = $(sel)
  if (!el) return
  const label = unit || 'DOCS'
  el.textContent = shown === total ? `${total} ${label}` : `${shown}/${total} ${label}`
}

export function renderVault() {
  const grid = $('#vault-grid')
  if (!grid) return
  const all = STATE.vault || []
  const docs = filterKnowledge(all, '#vault-filter')
  setKnowledgeCount('#vault-count', docs.length, all.length, 'DOCS')
  grid.innerHTML = docs.length
    ? docs.map(
    (d) => `
  <div class="vault-card${d.id === selectedVaultId ? ' selected' : ''}" data-id="${escapeHtml(d.id)}" title="Open ${escapeHtml(d.title)}">
    <div class="vault-title">${escapeHtml(d.title)}</div>
    <div class="vault-meta">
      <span class="vault-type">${escapeHtml(d.type)}</span>
      <span>${escapeHtml(d.size)}</span>
      <span>${escapeHtml(d.updated)}</span>
    </div>
    <div class="vault-tags">${(d.tags || []).map((t) => `<span class="vault-tag">${escapeHtml(t)}</span>`).join('')}</div>
  </div>`
  ).join('')
    : '<span class="empty-hint">NO MATCHING DOCS ▸</span>'
  grid.querySelectorAll('.vault-card').forEach((card) => {
    card.addEventListener('click', () => {
      selectedVaultId = card.dataset.id || null
      renderVault()
    })
  })
  const reader = $('#vault-reader')
  if (!reader) return
  const doc = all.find((d) => d && d.id === selectedVaultId)
  if (!doc) {
    reader.innerHTML = '<span class="empty-hint">SELECT A DOCUMENT ▸</span>'
    return
  }
  reader.innerHTML = `
    <div class="reader-head">
      <div class="reader-subject">${escapeHtml(doc.title)}</div>
      <div class="reader-meta">
        <span>${escapeHtml(doc.type)}</span>
        <span>${escapeHtml(doc.agent || '')}</span>
        <span>${escapeHtml(doc.updated)}</span>
      </div>
    </div>
    <div class="reader-body">${escapeHtml(doc.body || '')}</div>`
}

// ============================================================================
// EMAIL
// ============================================================================
let selectedEmailId = null
let emailFolder = 'inbox'
let selectedEventId = null
export function getSelectedEmailId() {
  return selectedEmailId
}
export function getEmailFolder() {
  return emailFolder
}
export function setEmailFolder(folder) {
  emailFolder = folder === 'sent' || folder === 'archive' ? folder : 'inbox'
  selectedEmailId = null
  renderEmail()
}
export function getSelectedEventId() {
  return selectedEventId
}

function emailRows() {
  return (STATE.email || []).filter((e) => e && (e.folder || 'inbox') === emailFolder)
}

function openEmail(e) {
  if (!e) return
  e.read = true
  selectedEmailId = e.id
  if (isOnline()) api.readEmail(e.id).catch(() => {})
  renderEmail()
}

export function renderEmail() {
  const list = $('#email-list')
  if (!list) return
  const rows = emailRows()
  const unread = (STATE.email || []).filter((e) => e && (e.folder || 'inbox') === 'inbox' && !e.read).length
  const count = $('#email-count')
  if (count) count.textContent = `${unread} UNREAD`
  document.querySelectorAll('.email-folder-tab').forEach((tab) => {
    tab.classList.toggle('active', tab.dataset.folder === emailFolder)
  })
  const src = (STATE.meta.comms && STATE.meta.comms.email) || 'seed'
  const srcEl = $('#email-source')
  if (srcEl) srcEl.textContent = String(src).toUpperCase()
  const mailErrs = (STATE.email && STATE.email._errors) || (STATE.meta.comms && STATE.meta.comms.email !== 'seed' ? STATE.meta.comms.error : null)
  setSyncWarn($('#email-sync-warn'), mailErrs)
  const selectedId = selectedEmailId
  list.innerHTML = rows.length ? rows.map(
    (e) => `
  <div class="email-row ${e.read ? '' : 'unread'}${e.src && e.src !== 'seed' ? ' he' : ''}${e.id === selectedId ? ' selected' : ''}" data-id="${escapeHtml(e.id)}">
    <span class="email-from">${escapeHtml(e.from)}</span>
    <div>
      <div class="email-subject">${escapeHtml(e.subject)}</div>
      <div class="email-preview">${escapeHtml(e.preview)}</div>
    </div>
     <span class="email-time">${escapeHtml(e.time)}</span>
  </div>`
  ).join('') : '<span class="empty-hint">NO MESSAGES IN THIS FOLDER ▸</span>'
  list.querySelectorAll('.email-row').forEach((row) => {
    row.addEventListener('click', () => {
      const e = rows.find((x) => x.id === row.dataset.id)
      openEmail(e)
    })
  })
  const selected = rows.find((e) => e.id === selectedId) || null
  const reader = $('#email-reader')
  const folder = $('#email-folder')
  if (folder) folder.textContent = selected ? String(selected.folder || 'inbox').toUpperCase() : 'INBOX'
  if (reader) {
    if (!selected) {
      reader.innerHTML = '<span class="empty-hint">SELECT A MESSAGE ▸</span>'
    } else {
      reader.innerHTML = `
          <div class="reader-head">
            <div class="reader-subject">${escapeHtml(selected.subject)}</div>
            <div class="reader-meta">
              <span>FROM: ${escapeHtml(selected.from)}</span>
              <span>${escapeHtml(selected.time)}</span>
              <span class="email-label ${escapeHtml(selected.label)}">${escapeHtml(selected.label)}</span>
              <span class="email-src">${escapeHtml(selected.src || 'seed')}</span>
            </div>
          </div>
          <div class="reader-body">${escapeHtml(selected.body || selected.preview || '')}</div>
          ${attachChips(selected.attachments)}`
    }
  }
}

function attachChips(list) {
  if (!Array.isArray(list) || !list.length) return ''
  return `<div class="attach-chips">${list.map((a) => `<span class="attach-chip">${escapeHtml(a.name || 'file')}</span>`).join('')}</div>`
}

// ============================================================================
// CALENDAR
// ============================================================================
function hourOf(stamp) {
  const n = parseInt(String(stamp || '0'), 10)
  return Number.isFinite(n) ? n : 0
}

export function renderCalendar() {
  const grid = $('#calendar-grid')
  if (!grid) return
  const week = $('#cal-week')
  if (week) week.textContent = STATE.calendar.weekLabel || STATE.calendar.weekStart || ''
  const src = (STATE.meta.comms && STATE.meta.comms.calendar) || 'seed'
  const srcEl = $('#cal-source')
  if (srcEl) srcEl.textContent = String(src).toUpperCase()
  const calErrs = (STATE.calendar.events && STATE.calendar.events._errors) || (STATE.meta.comms && STATE.meta.comms.calendar !== 'seed' ? STATE.meta.comms.error : null)
  setSyncWarn($('#cal-sync-warn'), calErrs)
  const start = 8
  const end = 18
  let html = '<div></div>' + weekdays.map((d) => `<div class="cal-day-head">${d}</div>`).join('')
  for (let hour = start; hour <= end; hour++) {
    html += `<div class="cal-hour">${String(hour).padStart(2, '0')}:00</div>`
    for (let day = 0; day < 7; day++) {
      const events = (STATE.calendar.events || []).filter((e) => e.day === day && hourOf(e.start) === hour)
      html += `<div class="cal-slot">${events
        .map((e) => `<div class="evt ${e.type}${e.src && e.src !== 'seed' ? ' he' : ''}${e.id === selectedEventId ? ' selected' : ''}" data-day="${day}" data-id="${escapeHtml(e.id)}" title="${escapeHtml(e.title)}" style="height:${Math.max(18, (hourOf(e.end) - hourOf(e.start)) * 26)}px">${escapeHtml(e.title)}</div>`)
        .join('')}</div>`
    }
  }
  grid.innerHTML = html
  grid.querySelectorAll('.evt').forEach((ev) => {
    ev.addEventListener('click', (e) => {
      e.stopPropagation()
      selectedEventId = ev.dataset.id || selectedEventId
      selectCalDay(+ev.dataset.day)
    })
  })
  selectCalDay(STATE.calendar.day, true)
}

function selectCalDay(day, force) {
  if (!force && day === STATE.calendar.day) return
  STATE.calendar.day = day
  if (isOnline()) api.setCalDay(day).catch(() => {})
  const label = $('#cal-day-label')
  if (label) label.textContent = `${weekdays[day] || 'DAY'} // ${STATE.calendar.weekLabel || 'WEEK'}`
  const events = (STATE.calendar.events || []).filter((e) => e.day === day)
  const box = $('#calendar-day')
  if (!box) return
  box.innerHTML = events.length
    ? events
        .map(
          (e) => `
      <div class="day-evt ${e.type}${e.id === selectedEventId ? ' selected' : ''}" data-id="${escapeHtml(e.id)}">
        <div class="day-evt-time">${escapeHtml(e.start)} – ${escapeHtml(e.end)}</div>
        <div class="day-evt-title">${escapeHtml(e.title)}</div>
        <div class="day-evt-agents">AGENTS: ${escapeHtml((e.agents || []).join(', '))}</div>
      </div>`
        )
        .join('')
    : '<span class="empty-hint">NO EVENTS SCHEDULED</span>'
  box.querySelectorAll('.day-evt').forEach((row) => {
    row.addEventListener('click', () => {
      selectedEventId = row.dataset.id || null
      selectCalDay(day, true)
    })
  })
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
  <div class="alert-row ${a.acked ? 'acked' : ''}${a.source === 'HERMES' ? ' he' : ''}" data-id="${a.id}" title="${a.acked ? 'Acknowledged' : 'Click to ack'}">
    <span class="alert-sev ${a.sev}">${escapeHtml(a.sev).toUpperCase()}</span>
    <span class="alert-source">${escapeHtml(a.source)}</span>
    <div>
      <div class="alert-title">${escapeHtml(a.title)}</div>
      <div class="alert-detail">${escapeHtml(a.detail)}</div>
    </div>
    <span class="alert-time">${escapeHtml(a.time)}</span>
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
/** In-place probe grid: rebuild cells only when the probe SET changes. */
export function _renderProbeGrid(grid, probes) {
  if (!grid || !Array.isArray(probes)) return
  let cells = grid.children
  const setChanged = cells.length !== probes.length
  if (setChanged) {
    grid.innerHTML = ''
    probes.forEach((p) => {
      const cell = document.createElement('div')
      cell.className = 'probe-cell'
      cell.dataset.probe = p.name
      const name = document.createElement('div')
      name.className = 'probe-name'
      const val = document.createElement('div')
      val.className = 'probe-val'
      const track = document.createElement('div')
      track.className = 'probe-track'
      const fill = document.createElement('div')
      fill.className = 'probe-fill'
      track.appendChild(fill)
      cell.appendChild(name)
      cell.appendChild(val)
      cell.appendChild(track)
      grid.appendChild(cell)
    })
    cells = grid.children
  }
  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i]
    const p = probes[i]
    if (!cell || !p) continue
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
  }
}

export function renderHealth(logs, filter = 'ALL') {
  const grid = $('#probe-grid')
  if (grid) _renderProbeGrid(grid, STATE.probes)

  const box = $('#health-log')
  if (box) {
    const rows = Array.isArray(logs) && filter !== 'ALL' ? logs.filter((l) => l.level === filter) : Array.isArray(logs) ? logs : []
    renderHealthLog(box, rows)
  }
  renderTrace()
}

// ============================================================================
// TRACE
// ============================================================================
let selectedSpanId = null

export function renderTrace() {
  const list = $('#trace-list')
  if (!list) return
  const spans = (STATE.trace || []).slice(0, 12)
  const count = $('#trace-count')
  if (count) count.textContent = `${(STATE.trace || []).length} SPANS`
  if (!spans.length) {
    list.innerHTML = '<span class="empty-hint">NO SPANS YET ▸</span>'
  } else {
    list.innerHTML = spans.map((s) => `
      <div class="trace-row${s.ok === false ? ' fail' : ''}${s.id === selectedSpanId ? ' selected' : ''}" data-id="${escapeHtml(s.id)}">
        <span class="trace-name">${escapeHtml(s.name || s.type || 'span')}</span>
        <span>${Number(s.ms || 0)}ms</span>
        <span>${Number(s.tokenIn || 0)}/${Number(s.tokenOut || 0)} TK</span>
        <span>${s.ok === false ? 'FAIL' : 'OK'}</span>
      </div>`).join('')
    list.querySelectorAll('.trace-row[data-id]').forEach((row) => {
      row.addEventListener('click', () => {
        selectedSpanId = row.dataset.id
        renderTrace()
      })
    })
  }
  const reader = $('#trace-reader')
  if (!reader) return
  const span = (STATE.trace || []).find((s) => s && s.id === selectedSpanId)
  if (!span) {
    reader.innerHTML = '<span class="empty-hint">SELECT A SPAN ▸</span>'
    return
  }
  reader.innerHTML = `
    <div class="reader-head">
      <div class="reader-subject">${escapeHtml(span.name || span.type || 'span')}</div>
      <div class="reader-meta">
        <span>${escapeHtml(span.id)}</span>
        <span>${Number(span.ms || 0)} ms</span>
        <span>${span.ok === false ? 'FAIL' : 'OK'}</span>
      </div>
    </div>
    <div class="reader-body">depth ${Number(span.depth || 0)} · in ${Number(span.tokenIn || 0)} / out ${Number(span.tokenOut || 0)} · parent ${escapeHtml(span.parent || 'root')}</div>`
}

// ============================================================================
// RESEARCH REPORTS
// ============================================================================
let selectedReportId = null
const REPORT_STATUSES = ['draft', 'review', 'published']

function nextReportStatus(cur) {
  const s = String(cur || 'draft').toLowerCase()
  const idx = REPORT_STATUSES.indexOf(s)
  return REPORT_STATUSES[(idx < 0 ? 0 : idx + 1) % REPORT_STATUSES.length]
}

export function getSelectedReportId() {
  return selectedReportId
}

export function renderReports() {
  const grid = $('#reports-grid')
  if (!grid) return
  const all = STATE.reports || []
  const rows = filterKnowledge(all, '#reports-filter')
  setKnowledgeCount('#reports-count', rows.length, all.length, 'DOCS')
  grid.innerHTML = rows.length
    ? rows.map(
    (r) => `
  <div class="report-card${r.id === selectedReportId ? ' selected' : ''}" data-id="${escapeHtml(r.id)}" title="Open ${escapeHtml(r.title)}">
    <div class="report-title">${escapeHtml(r.title)}</div>
    <div class="report-abstract">${escapeHtml(r.abstract)}</div>
    <div class="report-meta">
      <span>BY ${escapeHtml(r.author)} · ${escapeHtml(r.updated)}</span>
      <span class="report-status ${escapeHtml(r.status)}">${escapeHtml(r.status).toUpperCase()}</span>
    </div>
    <div class="report-tags">${(r.tags || []).map((t) => `<span class="report-tag">${escapeHtml(t)}</span>`).join('')}</div>
  </div>`
  ).join('')
    : '<span class="empty-hint">NO MATCHING REPORTS ▸</span>'
  grid.querySelectorAll('.report-card').forEach((card) => {
    card.addEventListener('click', (e) => {
      const r = all.find((x) => x && x.id === card.dataset.id)
      if (!r) return
      if (e.target && e.target.classList && e.target.classList.contains('report-status')) {
        if (!lockPending(r.id)) return
        r.status = nextReportStatus(r.status)
        r.updated = 'just now'
        if (isOnline()) api.cycleReportStatus(r.id).catch(() => {})
      }
      selectedReportId = r.id
      renderReports()
    })
  })
  const reader = $('#reports-reader')
  if (!reader) return
  const doc = all.find((r) => r && r.id === selectedReportId)
  if (!doc) {
    reader.innerHTML = '<span class="empty-hint">SELECT A REPORT ▸</span>'
    return
  }
  reader.innerHTML = `
    <div class="reader-head">
      <div class="reader-subject">${escapeHtml(doc.title)}</div>
      <div class="reader-meta">
        <span>BY ${escapeHtml(doc.author)}</span>
        <span>${escapeHtml(doc.updated)}</span>
        <span class="report-status ${escapeHtml(doc.status)}">${escapeHtml(doc.status).toUpperCase()}</span>
      </div>
    </div>
    <div class="reader-body">${escapeHtml(doc.body || doc.abstract || '')}</div>`
}
