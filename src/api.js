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

const BASE_BACKOFF_MS = 500
const MAX_BACKOFF_MS = 30000
const CONNECT_TIMEOUT_MS = 4000
let ws = null
let closedByUs = false
let online = false
let lastSeq = 0
let backoffMs = BASE_BACKOFF_MS
let reconnectTimer = null
// link state: 'connecting' (attempt in flight) | 'online' | 'offline'
let link = 'connecting'

async function post(path, body) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {})
  })
  if (!res.ok) throw new Error(`${path} -> ${res.status}`)
  return res.json()
}

export const api = {
  chat: (text) => post('/api/chat', { text }),
  dispatch: (task, agent) => post('/api/dispatch', { task, agent }),
  advanceCard: (id) => post(`/api/kanban/${encodeURIComponent(id)}/advance`),
  ackAlert: (id) => post(`/api/alerts/${encodeURIComponent(id)}/ack`),
  readEmail: (idx) => post(`/api/email/${idx}/read`),
  setCalDay: (day) => post(`/api/calendar/${day}`),
  createMission: (name, agents) => post('/api/mission', { name, agents }),
  approval: (choice) => post('/api/approval/respond', { choice })
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
      case 'chat':
        // hint-only frame; the delta carries authoritative truth
        break
      default:
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
