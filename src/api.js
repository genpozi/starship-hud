/**
 * API // WebSocket state mirror + REST mutations to the orbit server.
 *
 * connect() opens a same-origin WS. Every server snapshot is applied to the
 * client STATE via applyServerState. Mutations fire REST calls; the HUD then
 * re-renders from whatever state the server broadcasts back.
 */

import { applyServerState } from './store.js'

const RECONNECT_MS = 3000
let ws = null
let closedByUs = false
let online = false

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
  createMission: (name, agents) => post('/api/mission', { name, agents })
}

export function isOnline() {
  return online
}

export function connect({ onOnline, onOffline } = {}) {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws'
  ws = new WebSocket(`${proto}://${location.host}/ws`)

  ws.onopen = () => {
    online = true
    if (onOnline) onOnline()
  }
  ws.onmessage = (ev) => {
    try {
      const msg = JSON.parse(ev.data)
      if (msg.type === 'state') applyServerState(msg.state)
    } catch {
      /* ignore malformed frames */
    }
  }
  ws.onclose = () => {
    if (closedByUs) return
    online = false
    if (onOffline) onOffline()
    setTimeout(() => connect({ onOnline, onOffline }), RECONNECT_MS)
  }
  ws.onerror = () => ws.close()
  return ws
}

export function disconnect() {
  closedByUs = true
  if (ws) ws.close()
  online = false
}
