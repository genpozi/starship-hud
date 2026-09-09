/**
 * INTEGRATION SUITE // REST + WS against a freshly booted orbit server.
 *
 * Spawns server/index.js on an ephemeral port with an isolated data dir,
 * waits for health, then exercises the full REST surface (state, chat,
 * dispatch, kanban, alerts, email, calendar, mission, approval) and the
 * realtime WS protocol (snapshot on connect, delta frames, ping/pong,
 * resync-on-gap). Kills the child cleanly on completion.
 */

import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import WebSocket from 'ws'

const ROOT = dirname(fileURLToPath(import.meta.url))
const REPO = join(ROOT, '..')
const PORT = 3999
const BASE = `http://127.0.0.1:${PORT}`
const DATA_DIR = mkdtempSync(join(tmpdir(), 'stellaris-int-'))

const results = []
const pass = (name, cond) => results.push(`${cond ? 'PASS' : 'FAIL'} ${name}`)

const server = spawn('node', ['server/index.js'], {
  cwd: REPO,
  env: { ...process.env, PORT: String(PORT), STELLARIS_DATA_DIR: DATA_DIR, MOCK_URL: process.env.MOCK_URL || '' },
  stdio: 'ignore'
})

async function waitForHealth(ms) {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(1500) })
      if (res.ok) return true
    } catch {}
    await new Promise((r) => setTimeout(r, 200))
  }
  return false
}

function wsOpen(ms) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`)
    const frames = []
    const waiters = []
    // buffer frames from the very first moment the socket exists — the server
    // pushes the snapshot synchronously on connect, possibly before 'open'
    ws.on('message', (raw) => {
      let msg
      try {
        msg = JSON.parse(raw.toString())
      } catch {
        return
      }
      const waiter = waiters.shift()
      if (waiter) waiter(msg)
      else frames.push(msg)
    })
    const timer = setTimeout(() => {
      ws.terminate()
      reject(new Error('ws connect timeout'))
    }, ms)
    ws.on('open', () => {
      clearTimeout(timer)
      resolve({ ws, frames, waiters })
    })
    ws.on('error', (e) => {
      clearTimeout(timer)
      reject(e)
    })
  })
}

function nextFrame(sock, ms) {
  return new Promise((resolve, reject) => {
    const { frames, waiters } = sock
    if (frames.length) {
      resolve(frames.shift())
      return
    }
    const timer = setTimeout(() => reject(new Error('frame timeout')), ms)
    waiters.push((msg) => {
      clearTimeout(timer)
      resolve(msg)
    })
  })
}

let passed = 0
let failed = 0

try {
  if (!(await waitForHealth(8000))) throw new Error('orbit server did not come up')
  pass('health endpoint reachable', true)

  // ---- REST: state & health ----
  const stateRes = await fetch(`${BASE}/api/state`)
  const state = await stateRes.json()
  pass('GET /api/state has agents', Array.isArray(state.agents) && state.agents.length === 6)
  pass('GET /api/state has dispatch seed', Array.isArray(state.dispatch) && state.dispatch.length === 5)
  pass('GET /api/state has telemetry.hist window', Array.isArray(state.telemetry.hist))

  // ---- REST: chat -> plan -> workflow + dispatch ----
  const chatRes = await fetch(`${BASE}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: '@CODA investigate ingress latency and fix the canary rollout' })
  })
  const chat = await chatRes.json()
  pass('POST /api/chat returns ok', chatRes.ok && chat.ok === true)
  pass('POST /api/chat returns steps', chat.steps >= 1)
  pass('POST /api/chat pins reply owner', chat.agent === 'CODA')

  // ---- REST: dispatch ----
  const dispRes = await fetch(`${BASE}/api/dispatch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ task: 'Verify reverse-ingest bridge', agent: 'LINK' })
  })
  pass('POST /api/dispatch ok', dispRes.ok)
  const after = await (await fetch(`${BASE}/api/state`)).json()
  pass('dispatch grew by one', after.dispatch.length === state.dispatch.length + chat.steps + 1)

  // chat-created jobs are owned by a workflow (never orphaned)
  const chatJobs = after.dispatch.filter((d) => typeof d.wfId === 'string')
  pass('chat jobs carry a workflow id', chatJobs.length === chat.steps)
  pass('workflow registered from chat', after.workflows.some((w) => w.id === chatJobs[0]?.wfId))

  // ---- REST: kanban advance ----
  const kanbanRes = await fetch(`${BASE}/api/kanban/k1/advance`, { method: 'POST' })
  const kanban = await kanbanRes.json()
  pass('POST /api/kanban/k1/advance ok', kanban.ok === true)

  const itemRes = await fetch(`${BASE}/api/items/${encodeURIComponent(state.items[0].id)}/status`, { method: 'POST' })
  const item = await itemRes.json()
  pass('POST /api/items/:id/status ok', item.ok === true && typeof item.status === 'string')
  const itemMiss = await fetch(`${BASE}/api/items/missing-id/status`, { method: 'POST' })
  pass('POST /api/items/:id/status missing → 404', itemMiss.status === 404)

  const schedId = (state.schedules || []).find((j) => j && j.src !== 'hermes')?.id
  const pauseRes = await fetch(`${BASE}/api/schedules/${encodeURIComponent(schedId)}/pause`, { method: 'POST' })
  const paused = await pauseRes.json()
  pass('POST /api/schedules/:id/pause ok', paused.ok === true && paused.paused === true)
  const resumeRes = await fetch(`${BASE}/api/schedules/${encodeURIComponent(schedId)}/pause`, { method: 'POST' })
  const resumed = await resumeRes.json()
  pass('POST /api/schedules/:id/pause toggle resume', resumed.ok === true && resumed.paused === false)

  const repRes = await fetch(`${BASE}/api/reports/${encodeURIComponent(state.reports[0].id)}/status`, { method: 'POST' })
  const rep = await repRes.json()
  pass('POST /api/reports/:id/status ok', rep.ok === true && typeof rep.status === 'string')

  // ---- REST: alert ack ----
  const ackRes = await fetch(`${BASE}/api/alerts/a1/ack`, { method: 'POST' })
  const ack = await ackRes.json()
  pass('POST /api/alerts/a1/ack ok', ack.ok === true)

  // ---- REST: alerts bulk ack ----
  const bulkRes = await fetch(`${BASE}/api/alerts/ack-all`, { method: 'POST' })
  const bulk = await bulkRes.json()
  pass('POST /api/alerts/ack-all ok', !!bulk.ok)
  const stateAfterBulk = await (await fetch(`${BASE}/api/state`)).json()
  pass('ack-all acks every alert', stateAfterBulk.alerts.every((a) => a.acked))

  // ---- REST: email read ----
  const mailRes = await fetch(`${BASE}/api/email/0/read`, { method: 'POST' })
  const mail = await mailRes.json()
  pass('POST /api/email/0/read ok', mail.ok === true)

  // ---- REST: email send (simulated, no provider) ----
  const sendRes = await fetch(`${BASE}/api/email/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ to: 'ops@stellaris.internal', subject: 'Integration ping', body: 'n/c' })
  })
  const sent = await sendRes.json()
  pass('POST /api/email/send ok', sent.ok === true && typeof sent.id === 'string')

  const attachRes = await fetch(`${BASE}/api/email/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      to: 'ops@stellaris.internal',
      subject: 'Attach ping',
      body: 'with file',
      attachments: [{ name: 'note.txt', mime: 'text/plain', size: 5, data: 'aGVsbG8=' }]
    })
  })
  const attached = await attachRes.json()
  pass('POST /api/email/send with attachment ok', attached.ok === true && typeof attached.id === 'string')

  const sendBad = await fetch(`${BASE}/api/email/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ subject: 'missing to' })
  })
  pass('POST /api/email/send missing to → 400', sendBad.status === 400)

  // ---- REST: inbound webhook ----
  const inboundRes = await fetch(`${BASE}/api/comms/inbound`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: 'bot@external', subject: 'Inbound probe', body: 'hello fleet' })
  })
  const inbound = await inboundRes.json()
  pass('POST /api/comms/inbound ok', inbound.ok === true && String(inbound.id || '').startsWith('wh-'))

  // ---- REST: calendar range validation ----
  const calOk = await fetch(`${BASE}/api/calendar/3`, { method: 'POST' })
  pass('POST /api/calendar/3 ok', calOk.ok)
  const calBad = await fetch(`${BASE}/api/calendar/9`, { method: 'POST' })
  pass('POST /api/calendar/9 rejected', calBad.status === 400)

  const bookRes = await fetch(`${BASE}/api/calendar/events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'Integration hold', day: 2, start: '15:00', end: '16:00' })
  })
  const booked = await bookRes.json()
  pass('POST /api/calendar/events ok', booked.ok === true && booked.event && booked.event.title === 'Integration hold')

  const archiveRes = await fetch(`${BASE}/api/email/${encodeURIComponent(sent.id)}/archive`, { method: 'POST' })
  const archived = await archiveRes.json()
  pass('POST /api/email/:id/archive ok', archived.ok === true)

  const weekRes = await fetch(`${BASE}/api/calendar/week`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ delta: 1 })
  })
  const week = await weekRes.json()
  pass('POST /api/calendar/week ok', week.ok === true && typeof week.weekStart === 'string')

  const delRes = await fetch(`${BASE}/api/calendar/events/${encodeURIComponent(booked.id)}/delete`, { method: 'POST' })
  const deleted = await delRes.json()
  pass('POST /api/calendar/events/:id/delete ok', deleted.ok === true)

  const delMiss = await fetch(`${BASE}/api/calendar/events/missing-id/delete`, { method: 'POST' })
  pass('POST /api/calendar/events/:id/delete missing → 404', delMiss.status === 404)

  // ---- REST: malformed JSON -> JSON error handler ----
  const badJson = await fetch(`${BASE}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{not json'
  })
  pass('malformed JSON body -> 400 JSON', badJson.status === 400 && (await badJson.json()).ok === false)

  // ---- REST: approval validation ----
  const appBad = await fetch(`${BASE}/api/approval/respond`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ choice: 'maybe' })
  })
  pass('POST /api/approval invalid choice -> 400', appBad.status === 400)

  // ---- REST: mission ----
  const missionRes = await fetch(`${BASE}/api/mission`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Integration sweep', agents: ['CODA', 'SAGE'] })
  })
  const mission = await missionRes.json()
  pass('POST /api/mission ok', mission.ok === true)

  // ---- WS: snapshot on connect ----
  const { ws, frames, waiters } = await wsOpen(4000)
  const snap = await nextFrame({ frames, waiters }, 4000)
  pass('WS snapshot on connect', snap.type === 'snapshot' && Array.isArray(snap.state.agents))

  // ---- WS: ping -> pong echo ----
  ws.send(JSON.stringify({ type: 'ping' }))
  const pong = await nextFrame({ frames, waiters }, 4000)
  pass('WS ping echoes pong', pong.type === 'pong')

  // ---- WS: delta frames flow (telemetry ticks every ~1.2s) ----
  let sawDelta = false
  const deadline = Date.now() + 5000
  while (Date.now() < deadline && !sawDelta) {
    try {
      const frame = await nextFrame({ frames, waiters }, 1500)
      if (frame.type === 'delta' && frame.updates && typeof frame.seq === 'number') sawDelta = true
    } catch {
      break
    }
  }
  pass('WS delta frames flow', sawDelta)

  // ---- WS: resync -> fresh snapshot ----
  ws.send(JSON.stringify({ type: 'resync' }))
  const resnap = await nextFrame({ frames, waiters }, 4000)
  pass('WS resync returns snapshot', resnap.type === 'snapshot')
  ws.close()

  // ---- WS: dataSource mirrors bridge state ----
  const finalState = await (await fetch(`${BASE}/api/state`)).json()
  pass('meta.dataSource present', typeof finalState.meta.dataSource === 'string')
  pass('dispatch rows have valid states', finalState.dispatch.every((d) => ['waiting', 'assigned', 'done', 'failed'].includes(d.state)))
  pass('telemetry history keeps growing', Array.isArray(finalState.telemetry.hist) && finalState.telemetry.hist.length >= state.telemetry.hist.length)
} catch (err) {
  pass('integration run completed', false)
  console.error('  [integration] threw:', err.message)
} finally {
  server.kill('SIGTERM')
  setTimeout(() => rmSync(DATA_DIR, { recursive: true, force: true }), 200)
}

const fails = results.filter((r) => r.startsWith('FAIL'))
console.log(results.join('\n'))
console.log(fails.length ? `\n${fails.length} FAILURES` : '\nALL PASS')
process.exit(fails.length ? 1 : 0)
