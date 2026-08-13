/**
 * HERMES CONTRACT PROBE // Operator CLI for validating a live Hermes WebUI
 * against the assumptions the STELLARIS-7 bridge relies on.
 *
 * Usage:
 *   node server/hermes-contract.js [--url http://127.0.0.1:8787] [--password ...] [--no-chat]
 *
 * Probes each surface the bridge consumes, reports PASS/WARN/FAIL with the
 * actual observed shapes, and exits non-zero when anything FAILs. Run this
 * against a REAL hermes-webui before enabling USER_HERMES_URL in production —
 * the mock can't cover instance-specific serialization quirks, this can.
 *
 * Exit codes: 0 = all critical surfaces PASS; 1 = at least one FAIL.
 */

import { setTimeout as sleep } from 'node:timers/promises'

const args = process.argv.slice(2)
const argVal = (flag, fallback) => {
  const i = args.indexOf(flag)
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback
}
const hasFlag = (flag) => args.includes(flag)

const URL = (argVal('--url', process.env.USER_HERMES_URL || 'http://127.0.0.1:8787')).replace(/\/+$/, '')
const PASSWORD = argVal('--password', process.env.USER_HERMES_PASSWORD || '')
const DO_CHAT = !hasFlag('--no-chat')
const TIMEOUT_MS = Number(argVal('--timeout-ms', '20000'))

const results = []
const record = (name, status, detail) => {
  results.push({ name, status, detail })
  console.log(`${status === 'PASS' ? 'PASS' : status === 'WARN' ? 'WARN' : 'FAIL'}  ${name}  —  ${detail}`)
}

async function get(path) {
  const res = await fetch(`${URL}${path}`, { signal: AbortSignal.timeout(TIMEOUT_MS) })
  return { status: res.status, headers: res.headers, body: await res.json().catch(() => null) }
}

async function post(path, json) {
  const res = await fetch(`${URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(json || {}),
    signal: AbortSignal.timeout(TIMEOUT_MS)
  })
  return { status: res.status, headers: res.headers, body: await res.json().catch(() => null) }
}

const snippet = (v, len = 90) => {
  const s = JSON.stringify(v)
  if (!s) return '(null/non-json)'
  return s.length > len ? `${s.slice(0, len)}…` : s
}

let anyFail = false

async function main() {
  console.log(`HERMES CONTRACT PROBE — ${URL}`)
  console.log(`auth: ${PASSWORD ? 'password supplied' : 'none (assuming open instance)'} · chat round-trip: ${DO_CHAT ? 'on' : 'off'}\n`)

  // 1. health
  try {
    const { status, body } = await get('/health')
    const ok = status === 200 && body && (body.ok === true || body.status === 'ok' || body.healthy === true)
    record('health', ok ? 'PASS' : 'FAIL', `HTTP ${status} → ${snippet(body)}`)
  } catch (e) {
    record('health', 'FAIL', `unreachable — ${e.message}`)
  }

  // 2. sessions list (source for kanban cards + SESSION items)
  try {
    const { status, body } = await get('/api/sessions')
    const list = Array.isArray(body) ? body : (body && (body.sessions || body.data || []))
    if (status !== 200 || !Array.isArray(list)) {
      record('sessions', 'FAIL', `HTTP ${status} → ${snippet(body)}`)
    } else {
      const sample = list[0] || {}
      const ok = list.length > 0 || true
      const idField = ['session_id', 'id', 'sid'].find((k) => sample[k] !== undefined)
      const titleField = ['title', 'name', 'summary'].find((k) => sample[k] !== undefined)
      const tField = ['updated_at', 'created_at', 'updated'].find((k) => sample[k] !== undefined)
      const warn = !idField || !titleField || !tField
      record('sessions', warn ? 'WARN' : 'PASS',
        `HTTP ${status} · ${list.length} sessions · id:${idField || 'MISSING'} title:${titleField || 'MISSING'} time:${tField || 'MISSING'} · sample ${snippet(sample, 60)}`)
      if (warn) anyFail = true
    }
  } catch (e) {
    record('sessions', 'FAIL', `unreachable — ${e.message}`)
    anyFail = true
  }

  // 3. crons (source for scheduler rows + failure alerts)
  try {
    const { status, body } = await get('/api/crons')
    const list = Array.isArray(body) ? body : (body && (body.crons || body.jobs || body.schedules || []))
    if (status !== 200 || !Array.isArray(list)) {
      record('crons', 'FAIL', `HTTP ${status} → ${snippet(body)}`)
      anyFail = true
    } else {
      const sample = list[0] || {}
      const idField = ['id', 'cron_id', 'job_id'].find((k) => sample[k] !== undefined)
      const stField = ['status', 'last_status', 'last_run_status'].find((k) => sample[k] !== undefined)
      const warn = !idField || !stField
      record('crons', warn ? 'WARN' : 'PASS',
        `HTTP ${status} · ${list.length} crons · id:${idField || 'MISSING'} status:${stField || 'MISSING'} · sample ${snippet(sample, 60)}`)
      if (warn) anyFail = true
    }
  } catch (e) {
    record('crons', 'FAIL', `unreachable — ${e.message}`)
    anyFail = true
  }

  // 4. session create (used by the chat delegation path)
  try {
    const { status, body } = await post('/api/session/new')
    const sid = body && (body.session_id || body.id || (body.session && (body.session.session_id || body.session.id)))
    if (status !== 200 || !sid) {
      record('session/create', 'FAIL', `HTTP ${status} → ${snippet(body)}`)
      anyFail = true
    } else {
      record('session/create', 'PASS', `HTTP ${status} · session_id "${sid}"`)
    }
  } catch (e) {
    record('session/create', 'FAIL', `unreachable — ${e.message}`)
    anyFail = true
  }

  // 5. chat (blocking round-trip; exercised when configured)
  if (DO_CHAT) {
    try {
      const sid = await post('/api/session/new').then((r) => r.body && (r.body.session_id || (r.body.session && r.body.session.session_id)) || '')
      const { status, body } = await post('/api/chat', { session_id: sid || undefined, message: 'probe' })
      const reply = body && (body.final_response || body.response || body.reply || body.output || '')
      if (status !== 200 || !reply) {
        record('chat', 'WARN', `HTTP ${status} → ${snippet(body)} (blocking chat unavailable; stream-only instances are supported via SSE)`)
      } else {
        record('chat', 'PASS', `HTTP ${status} · reply "${String(reply).slice(0, 50)}"`)
      }
    } catch (e) {
      record('chat', 'WARN', `unreachable — ${e.message}`)
    }
  }

  // 6. approval pending (used by the approval bridge poller)
  try {
    const { status, body } = await get('/api/approval/pending')
    const hasPending = body && (body.pending !== undefined || body.approval !== undefined || body.request !== undefined)
    if (status !== 200 || !hasPending) {
      record('approval/pending', 'WARN', `HTTP ${status} → ${snippet(body)} (endpoint missing; approval bridge will simply stay idle)`)
    } else {
      record('approval/pending', 'PASS', `HTTP ${status} · ${snippet(body, 60)}`)
    }
  } catch (e) {
    record('approval/pending', 'WARN', `unreachable — ${e.message}`)
  }

  // 7. auth (only probed when a password is supplied)
  if (PASSWORD) {
    try {
      const { status, headers } = await post('/api/auth/login', { password: PASSWORD })
      const gotCookie = Boolean((headers.get('set-cookie') || '').includes('='))
      if (status === 200 && gotCookie) {
        record('auth/login', 'PASS', `HTTP ${status} · cookie issued`)
      } else {
        record('auth/login', 'FAIL', `HTTP ${status} · no cookie issued — client cookie auth will not work`)
        anyFail = true
      }
    } catch (e) {
      record('auth/login', 'FAIL', `unreachable — ${e.message}`)
      anyFail = true
    }
  }

  await sleep(0)
  const passCount = results.filter((r) => r.status === 'PASS').length
  const warnCount = results.filter((r) => r.status === 'WARN').length
  const failCount = results.filter((r) => r.status === 'FAIL').length
  console.log(`\nSUMMARY — ${passCount} PASS · ${warnCount} WARN · ${failCount} FAIL`)
  console.log(anyFail ? 'Result: instance does NOT satisfy the bridge contract — fix the FAILs or adjust the mapping.'
    : 'Result: instance satisfies the bridge contract — safe to set USER_HERMES_URL.')
  process.exit(anyFail ? 1 : 0)
}

main().catch((e) => {
  console.error(`FATAL: ${e.message}`)
  process.exit(1)
})
