/**
 * API // WebSocket realtime mirror + REST mutations to the orbit server.
 *
 * Protocol (snapshot/delta/resync/ping/pong):
 *   - Server sends a full `snapshot` on (re)connect, then `delta` frames for
 *     changed top-level slices. Seq is monotonic; a gap triggers `resync`.
 *   - Server sends `{type:'ping'}` every 15s; we answer `{type:'pong'}`.
 *   - Reconnects use exponential backoff (500ms → 30s cap).
 * Mutations fire REST calls; the HUD then re-renders from whatever state the
 * server broadcasts back.
 */

import { applyServerState, applyDelta } from './store.js'
import { reduceEvent } from './channels.js'

const BASE_BACKOFF_MS = 500
const MAX_BACKOFF_MS = 30000
const CONNECT_TIMEOUT_MS = 4000
const OPERATOR_KEY = 'stellaris.operatorId'
let ws = null
let closedByUs = false
let online = false
let lastSeq = 0
let backoffMs = BASE_BACKOFF_MS
let reconnectTimer = null
// link state: 'connecting' (attempt in flight) | 'online' | 'offline'
let link = 'connecting'
let operatorId = 'operator'

export function normalizeOperatorId(raw) {
  const s = String(raw || 'operator')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
  return s || 'operator'
}

try {
  if (typeof localStorage !== 'undefined') operatorId = normalizeOperatorId(localStorage.getItem(OPERATOR_KEY) || 'operator')
} catch {}

export function getOperatorId() {
  return operatorId
}

export function setOperatorId(id) {
  operatorId = normalizeOperatorId(id)
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(OPERATOR_KEY, operatorId)
  } catch {}
  send({ type: 'hello', operatorId, name: operatorId })
  return operatorId
}

async function post(path, body) {
  const payload = { ...(body || {}), operatorId }
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Stellaris-Operator': operatorId },
    body: JSON.stringify(payload)
  })
  if (!res.ok) throw new Error(`${path} -> ${res.status}`)
  return res.json()
}

export const api = {
  chat: (text) => post('/api/chat', { text }),
  dispatch: (task, agent) => post('/api/dispatch', { task, agent }),
  advanceCard: (id) => post(`/api/kanban/${encodeURIComponent(id)}/advance`),
  cycleItemStatus: (id) => post(`/api/items/${encodeURIComponent(id)}/status`),
  toggleSchedule: (id) => post(`/api/schedules/${encodeURIComponent(id)}/pause`),
  cycleReportStatus: (id) => post(`/api/reports/${encodeURIComponent(id)}/status`),
  ackAlert: (id) => post(`/api/alerts/${encodeURIComponent(id)}/ack`),
  ackAll: () => post('/api/alerts/ack-all', {}),
  readEmail: (id) => post(`/api/email/${encodeURIComponent(id)}/read`),
  archiveEmail: (id) => post(`/api/email/${encodeURIComponent(id)}/archive`),
  sendMail: (to, subject, body, attachments) => post('/api/email/send', { to, subject, body, attachments }),
  setCalDay: (day) => post(`/api/calendar/${day}`),
  setCalWeek: (payload) => post('/api/calendar/week', payload),
  createEvent: (payload) => post('/api/calendar/events', payload),
  deleteEvent: (id) => post(`/api/calendar/events/${encodeURIComponent(id)}/delete`),
  createMission: (name, agents) => post('/api/mission', { name, agents }),
  approval: (choice) => post('/api/approval/respond', { choice }),
  pause: () => post('/api/control/pause', {}),
  interrupt: (reason, goal) => post('/api/control/interrupt', { reason, goal }),
  resume: () => post('/api/control/resume', {}),
  captureCheckpoint: (reason) => post('/api/checkpoint', { reason }),
  rollback: () => post('/api/checkpoint/rollback', {})
}

export function isOnline() {
  return online
}

/** 'connecting' | 'online' | 'offline' — used for the HUD link indicator. */
export function linkState() {
  return link
}

function send(obj) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj))
}

export function connect({ onOnline, onOffline } = {}) {
  link = 'connecting'
  const proto = location.protocol === 'https:' ? 'wss' : 'ws'
  ws = new WebSocket(`${proto}://${location.host}/ws`)

  // connect timeout: if the link hasn't opened within 4s the orbit is likely
  // unreachable — force-close so onclose fires and the offline sim engages fast
  const connectTimer = setTimeout(() => {
    if (ws && ws.readyState !== WebSocket.OPEN) ws.close()
  }, CONNECT_TIMEOUT_MS)

  ws.onopen = () => {
    clearTimeout(connectTimer)
    online = true
    link = 'online'
    backoffMs = BASE_BACKOFF_MS
    send({ type: 'hello', operatorId, name: operatorId })
    if (onOnline) onOnline()
  }
  ws.onmessage = (ev) => {
    let msg
    try {
      msg = JSON.parse(ev.data)
    } catch {
      return
    }
    if (!msg || typeof msg !== 'object' || !msg.type) return
    switch (msg.type) {
      case 'snapshot':
        // authoritative full state — resets the seq baseline
        lastSeq = msg.seq || 0
        applyServerState(msg.state)
        break
      case 'delta':
        if (msg.seq !== lastSeq + 1) {
          // lost frames — ask for a fresh snapshot and ignore this delta
          send({ type: 'resync' })
          break
        }
        lastSeq = msg.seq
        applyDelta(msg.updates)
        break
      case 'ping':
        send({ type: 'pong' })
        break
      case 'pong':
        break
      default:
        // typed channel frames (trace spans, approvals, …) fold via reducers
        reduceEvent(msg)
        break
    }
  }
  ws.onclose = () => {
    if (closedByUs) return
    online = false
    link = 'offline'
    if (onOffline) onOffline()
    scheduleReconnect({ onOnline, onOffline })
  }
  ws.onerror = () => ws.close()
  return ws
}

function scheduleReconnect(opts) {
  if (reconnectTimer) clearTimeout(reconnectTimer)
  reconnectTimer = setTimeout(() => {
    connect(opts)
  }, backoffMs)
  backoffMs = Math.min(MAX_BACKOFF_MS, backoffMs * 2)
}

export function disconnect() {
  closedByUs = true
  if (reconnectTimer) clearTimeout(reconnectTimer)
  reconnectTimer = null
  if (ws) ws.close()
  online = false
}
