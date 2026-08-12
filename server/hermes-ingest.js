/**
 * HERMES INGEST // Reverse ingest (Hermes WebUI → STELLARIS-7 HUD).
 *
 * Polls the running Hermes WebUI for active sessions and scheduled crons and
 * merges them onto the existing HUD surfaces — the same shapes the seed and
 * the GitHub sync produce — so the operator gets real agent activity without
 * rebuilding any view.
 *
 * MAPPING (idempotent additive merge — never destructive, never auto-removes):
 *   sessions ─▶ kanban.cards  (he-<session_id>, src:'hermes') + items rows
 *   crons    ─▶ schedules     (he-<cron_id>,    src:'hermes')
 *   crons with status 'failed'/'warn' ─▶ alerts (source:'HERMES', dedup by sig)
 *
 * Operator control is preserved: ingested cards advance/remove through the
 * normal kanban tool, alerts ack through the normal alert tool. Because every
 * ingested entity carries `src:'hermes'`, the GitHub sync preserves them when
 * it replaces the board, and the orchestrator scheduler ticker leaves their
 * status alone.
 *
 * CHANGE DETECTION: content-hash diffing (sha1 of the fetched bodies). When
 * the upstream payload is unchanged the merge is skipped entirely — the same
 * "only apply changes" intent as ETag/304 polling, without depending on the
 * upstream honoring conditional requests.
 */

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getConfig } from './hermes.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const INGEST_FILE = join(__dirname, '..', 'data', 'hermes-ingest.json')

const TITLE_MAX = 64
const SRC = 'hermes'

// kanban column ids (src/config.js KANBAN_COLUMNS: backlog / doing / review / done).
const COL_DONE = 'done'
const COL_DOING = 'doing'
const COL_BACKLOG = 'backlog'

let ingestTimer = null

/* ============================================================================
   PERSISTENCE — last payload hash + last sync time (mirrors github-etags.json)
   ============================================================================ */
function loadIngestState() {
  try {
    if (existsSync(INGEST_FILE)) return JSON.parse(readFileSync(INGEST_FILE, 'utf8'))
  } catch {}
  return {}
}

function saveIngestState(state) {
  try {
    mkdirSync(dirname(INGEST_FILE), { recursive: true })
    writeFileSync(INGEST_FILE, JSON.stringify(state, null, 2))
  } catch {}
}

function hashPayload(sessions, crons) {
  return createHash('sha1').update(JSON.stringify({ sessions, crons })).digest('hex')
}

/* ============================================================================
   MAPPING HELPERS
   ============================================================================ */
function truncate(title) {
  const t = String(title || 'untitled').trim()
  return t.length > TITLE_MAX ? t.slice(0, TITLE_MAX) : t
}

function sessionPrio(msgCount) {
  const n = Number(msgCount) || 0
  if (n >= 10) return 'P1'
  if (n >= 4) return 'P2'
  return 'P3'
}

function sessionCol(s) {
  if (s.archived === true) return COL_DONE
  if (s.pinned === true) return COL_DOING
  const updated = Number(s.updated_at) || 0
  if (updated && Date.now() / 1000 - updated < 6 * 3600) return COL_DOING
  return COL_BACKLOG
}

function sessionStatus(s) {
  if (s.archived === true) return 'closed'
  return 'open'
}

function mapSession(s) {
  const title = truncate(s.title)
  const prio = sessionPrio(s.message_count)
  const card = {
    id: `he-${s.session_id}`,
    col: sessionCol(s),
    title,
    agent: 'HERMES',
    prio,
    tags: ['HERMES', 'SESSION'],
    src: SRC,
    heSession: s.session_id
  }
  const item = {
    id: card.id,
    title,
    type: 'SESSION',
    prio,
    assignee: 'HERMES',
    status: sessionStatus(s),
    due: '—',
    src: SRC
  }
  return { card, item }
}

function formatNext(nextRun) {
  if (!nextRun) return '—'
  const m = /T(\d{2}):(\d{2})/.exec(String(nextRun))
  if (m) return `${m[1]}:${m[2]}`
  return String(nextRun)
}

function cronLast(c) {
  const status = String(c.status || '').toLowerCase()
  if (status === 'failed') return 'FAIL'
  if (status === 'warn' || status === 'warning') return 'WARN'
  if (status === 'ok' || status === 'success') return 'OK'
  const last = c.last_status || c.last_run_status
  if (last) return String(last).toUpperCase().slice(0, 4)
  return '—'
}

function mapCron(c) {
  return {
    id: `he-${c.id}`,
    name: String(c.name || 'untitled cron'),
    cron: String(c.cron || ''),
    agent: 'HERMES',
    next: formatNext(c.next_run),
    dur: '—',
    last: cronLast(c),
    src: SRC
  }
}

function isFailed(c) {
  const status = String(c.status || '').toLowerCase()
  return status === 'failed' || status === 'warn' || status === 'warning'
}

function alertSig(c) {
  return `${c.id}:${String(c.status || '').toLowerCase()}:${c.last_run || ''}`
}

function failureDetail(c) {
  const history = Array.isArray(c.history) ? c.history : []
  const last = history[history.length - 1] || {}
  if (last.error) return String(last.error).slice(0, 160)
  return `cron last run at ${c.last_run || 'unknown'} reported ${String(c.status).toUpperCase()}`
}

/* ============================================================================
   MERGES — exported separately so unit tests can drive them without a poller
   ============================================================================ */

/** Upsert Hermes sessions onto kanban.cards + items. Returns {added, updated}. */
export function mergeSessions(sessions, state) {
  let added = 0
  let updated = 0
  for (const s of sessions || []) {
    if (!s || !s.session_id) continue
    const { card, item } = mapSession(s)
    const exCard = state.kanban.cards.find((c) => c.id === card.id)
    if (exCard) {
      let changed = false
      for (const k of ['col', 'title', 'prio']) {
        if (exCard[k] !== card[k]) {
          exCard[k] = card[k]
          changed = true
        }
      }
      if (changed) updated += 1
    } else {
      state.kanban.cards.push(card)
      added += 1
    }
    const exItem = state.items.find((i) => i.id === item.id)
    if (exItem) {
      let changed = false
      for (const k of ['title', 'prio', 'status']) {
        if (exItem[k] !== item[k]) {
          exItem[k] = item[k]
          changed = true
        }
      }
      if (changed) updated += 1
    } else {
      state.items.push(item)
    }
  }
  return { added, updated }
}

/** Upsert Hermes crons onto schedules. Returns {added, updated}. */
export function mergeCrons(crons, state) {
  let added = 0
  let updated = 0
  for (const c of crons || []) {
    if (!c || !c.id) continue
    const row = mapCron(c)
    const ex = state.schedules.find((j) => j.id === row.id)
    if (ex) {
      let changed = false
      for (const k of ['name', 'cron', 'next', 'last']) {
        if (ex[k] !== row[k]) {
          ex[k] = row[k]
          changed = true
        }
      }
      if (changed) updated += 1
    } else {
      state.schedules.push(row)
      added += 1
    }
  }
  return { added, updated }
}

/**
 * Raise alerts for failing crons. Dedup by `sig` (cron id + status + last run)
 * so acked failures do not re-raise on the next poll unless the failure is a
 * genuinely new one. Returns the number of alerts raised.
 */
export function raiseFailureAlerts(crons, state, now = Date.now()) {
  let raised = 0
  for (const c of crons || []) {
    if (!c || !c.id || !isFailed(c)) continue
    const sig = alertSig(c)
    if (state.alerts.some((a) => a.sig === sig)) continue
    const count = state.alerts.filter((a) => a.id && a.id.startsWith(`hea-${c.id}-`)).length
    state.alerts.unshift({
      id: `hea-${c.id}-${count + 1}`,
      sev: 'warn',
      source: 'HERMES',
      title: `Cron ${String(c.status).toLowerCase()}: ${String(c.name || c.id)}`,
      detail: failureDetail(c),
      time: 'just now',
      acked: false,
      raisedAt: now,
      sig
    })
    raised += 1
  }
  return raised
}

/* ============================================================================
   SYNC — fetch, hash-diff, merge. Returns a report or {error}; never throws.
   ============================================================================ */
export async function syncHermesState(orchestrator, cfg) {
  const client = orchestrator && orchestrator.hermes
  if (!cfg || !cfg.enabled || !client || typeof client.listSessions !== 'function') {
    return { error: 'Hermes ingest not enabled (USER_HERMES_URL not set)' }
  }

  let sessions
  let crons
  try {
    sessions = await client.listSessions()
    crons = await client.listCrons()
  } catch (err) {
    return { error: err.message }
  }
  if (!Array.isArray(sessions)) sessions = []
  if (!Array.isArray(crons)) crons = []

  const hash = hashPayload(sessions, crons)
  const last = loadIngestState()
  if (last.hash === hash) return { changed: false }

  const state = orchestrator.s
  const cards = mergeSessions(sessions, state)
  const jobs = mergeCrons(crons, state)
  const alerts = raiseFailureAlerts(crons, state)

  saveIngestState({ hash, lastSync: new Date().toISOString() })

  if (state.meta.dataSource !== 'github') state.meta.dataSource = SRC
  state.meta.hermes = {
    ...(state.meta.hermes || {}),
    ingest: { lastSync: new Date().toISOString(), sessions: sessions.length, crons: crons.length, raisedAlerts: alerts }
  }
  orchestrator.store.markDirty()

  return {
    changed: true,
    sessions: sessions.length,
    crons: crons.length,
    cardsAdded: cards.added,
    cardsUpdated: cards.updated,
    jobsAdded: jobs.added,
    jobsUpdated: jobs.updated,
    alertsRaised: alerts
  }
}

/* ============================================================================
   SCHEDULER — guarded poller (mirrors startGithubSync).
   ============================================================================ */
export function startHermesIngest({ orchestrator, intervalMs }) {
  const cfg = getConfig()
  if (!cfg.enabled) {
    return { started: false, reason: 'USER_HERMES_URL not set' }
  }

  if (ingestTimer) {
    return { started: false, reason: 'already running' }
  }

  const ms = intervalMs || cfg.ingestMs || 60000
  orchestrator.log('INFO', `Hermes reverse ingest started — every ${ms}ms`)

  const tick = async () => {
    try {
      const res = await syncHermesState(orchestrator, cfg)
      if (res.error) {
        orchestrator.log('ERROR', `hermes ingest: ${res.error}`)
      } else if (res.changed) {
        orchestrator.log(
          'INFO',
          `hermes ingest: ${res.sessions} sessions, ${res.crons} crons` +
            (res.cardsAdded ? ` (+${res.cardsAdded} cards)` : '') +
            (res.alertsRaised ? ` (+${res.alertsRaised} alerts)` : '')
        )
      }
    } catch (err) {
      orchestrator.log('ERROR', `hermes ingest error: ${err.message}`)
    }
  }

  ingestTimer = setInterval(tick, ms)
  tick()
  return { started: true, stop: stopIngest }
}

export function stopIngest() {
  if (ingestTimer) {
    clearInterval(ingestTimer)
    ingestTimer = null
  }
}
