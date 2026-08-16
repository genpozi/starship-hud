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

  // ---- REST: alert ack ----
  const ackRes = await fetch(`${BASE}/api/alerts/a1/ack`, { method: 'POST' })
  const ack = await ackRes.json()
  pass('POST /api/alerts/a1/ack ok', ack.ok === true)

  // ---- REST: email read ----
  const mailRes = await fetch(`${BASE}/api/email/0/read`, { method: 'POST' })
  const mail = await mailRes.json()
  pass('POST /api/email/0/read ok', mail.ok === true)

  // ---- REST: calendar range validation ----
  const calOk = await fetch(`${BASE}/api/calendar/3`, { method: 'POST' })
  pass('POST /api/calendar/3 ok', calOk.ok)
  const calBad = await fetch(`${BASE}/api/calendar/9`, { method: 'POST' })
  pass('POST /api/calendar/9 rejected', calBad.status === 400)

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
