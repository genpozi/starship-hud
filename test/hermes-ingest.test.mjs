import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, renameSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { mergeSessions, mergeCrons, raiseFailureAlerts, syncHermesState } from '../server/hermes-ingest.js'
import { Orchestrator } from '../server/orchestrator.js'
import { createHermesClient } from '../server/hermes.js'
import { mergeReplacement } from '../server/github.js'

// Isolate the suite from whatever state.json was persisted (the server, prior
// runs, etc.): move it aside for the duration, restore it at the end.
const REPO = dirname(fileURLToPath(import.meta.url)) + '/..'
const STATE_FILE = process.env.STELLARIS_DATA_DIR
  ? join(process.env.STELLARIS_DATA_DIR, 'state.json')
  : join(REPO, 'data', 'state.json')
const STATE_BACKUP = join(tmpdir(), 'hermes-ingest-test.state.json')
if (existsSync(STATE_FILE)) renameSync(STATE_FILE, STATE_BACKUP)

const results = []
const pass = (name, cond) => results.push(`${cond ? 'PASS' : 'FAIL'} ${name}`)

const NOW = Math.floor(Date.now() / 1000)

function freshOrchestrator() {
  return new Orchestrator({ onBroadcast: () => {} })
}

// After a sync/tick that armed the store flush timer, cancel it so the test
// never writes mutated state back to /workspace/data/state.json.
function suppressStoreFlush(o) {
  if (o.store && o.store.timer) {
    clearTimeout(o.store.timer)
    o.store.timer = null
  }
  if (o.store) o.store.dirty = false
}

const stateShape = (o) => o.s

// ===========================================================================
// A. mergeSessions
// ===========================================================================
const mockSessions = [
  { session_id: 'sess-0001', title: 'Ingress latency deep-dive', message_count: 14, updated_at: NOW - 600, pinned: false, archived: false },
  { session_id: 'sess-0002', title: 'Canary v1.4.2 rollout notes', message_count: 6, updated_at: NOW - 28800, pinned: false, archived: false },
  { session_id: 'sess-0003', title: 'Vector-store ingest design', message_count: 3, updated_at: NOW - 1800, pinned: true, archived: false },
  { session_id: 'sess-0004', title: 'Context compaction research', message_count: 1, updated_at: NOW - 86400 * 3, pinned: false, archived: true }
]

{
  const o = freshOrchestrator()
  const s = stateShape(o)
  const r1 = mergeSessions(mockSessions, s)

  pass('A1 mergeSessions adds 4 mock sessions', r1.added === 4)
  const heCards = s.kanban.cards.filter((c) => c.id.startsWith('he-'))
  pass(
    'A1 cards ids he-sess-0001..4',
    ['he-sess-0001', 'he-sess-0002', 'he-sess-0003', 'he-sess-0004'].every((id) => heCards.some((c) => c.id === id))
  )
  pass('A1 cards carry src hermes + agent HERMES', heCards.every((c) => c.src === 'hermes' && c.agent === 'HERMES'))
  const heItems = s.items.filter((i) => i.id.startsWith('he-'))
  pass('A1 adds 4 SESSION items', heItems.length === 4 && heItems.every((i) => i.type === 'SESSION' && i.src === 'hermes'))

  // A3 idempotency (same state as A1)
  const r3 = mergeSessions(mockSessions, s)
  pass('A3 idempotent: added===0', r3.added === 0 && r3.updated === 0)
  pass('A3 card/item counts unchanged', s.kanban.cards.filter((c) => c.id.startsWith('he-')).length === 4 && s.items.filter((i) => i.id.startsWith('he-')).length === 4)

  // A4 update: change title + archived of sess-0002
  const changed = mockSessions.map((m) => (m.session_id === 'sess-0002' ? { ...m, title: 'Canary v1.4.2 rollout notes UPDATED', archived: true } : m))
  const r4 = mergeSessions(changed, s)
  pass('A4 update returns updated>=1', r4.updated >= 1 && r4.added === 0)
  const c2 = s.kanban.cards.find((c) => c.id === 'he-sess-0002')
  pass('A4 existing card title/col mutated (no new card)', c2 && c2.title === 'Canary v1.4.2 rollout notes UPDATED' && c2.col === 'done' && s.kanban.cards.filter((c) => c.id.startsWith('he-')).length === 4)
}

// A2 column mapping — construct controlled sessions
{
  const o = freshOrchestrator()
  const s = stateShape(o)
  const controlled = [
    { session_id: 'c-archived', title: 'Archived thing', message_count: 2, updated_at: NOW, pinned: false, archived: true },
    { session_id: 'c-pinned', title: 'Pinned thing', message_count: 2, updated_at: NOW - 86400 * 2, pinned: true, archived: false },
    { session_id: 'c-fresh', title: 'Fresh thing', message_count: 2, updated_at: NOW - 600, pinned: false, archived: false },
    { session_id: 'c-stale', title: 'Stale thing', message_count: 2, updated_at: NOW - 86400 * 10, pinned: false, archived: false }
  ]
  mergeSessions(controlled, s)
  const colOf = (id) => s.kanban.cards.find((c) => c.id === id)?.col
  pass('A2 archived session -> done', colOf('he-c-archived') === 'done')
  pass('A2 pinned session -> doing', colOf('he-c-pinned') === 'doing')
  pass('A2 updated within 1h -> doing', colOf('he-c-fresh') === 'doing')
  pass('A2 stale session -> backlog', colOf('he-c-stale') === 'backlog')
}

// ===========================================================================
// B. mergeCrons
// ===========================================================================
const mockCrons = [
  { id: 'cr-1', name: 'Daily telemetry digest', cron: '0 9 * * *', status: 'ok', last_run: '2026-08-12T09:00:00Z', next_run: '2026-08-13T09:00:00Z', history: [{ at: '2026-08-12T09:00:00Z', status: 'ok' }] },
  { id: 'cr-2', name: 'Webhook drain / replay sweep', cron: '*/15 * * * *', status: 'warn', last_run: '2026-08-12T14:30:00Z', next_run: '2026-08-12T14:45:00Z', history: [{ at: '2026-08-12T14:30:00Z', status: 'warn' }] },
  { id: 'cr-3', name: 'Dependency graph rebuild', cron: '0 * * * *', status: 'failed', last_run: '2026-08-12T12:00:00Z', next_run: '2026-08-12T13:00:00Z', history: [{ at: '2026-08-12T12:00:00Z', status: 'failed', error: 'connection reset' }] }
]

{
  const o = freshOrchestrator()
  const s = stateShape(o)
  const r5 = mergeCrons(mockCrons, s)
  pass('B5 adds 3 cron schedule rows', r5.added === 3)
  const heRows = s.schedules.filter((j) => j.id.startsWith('he-'))
  pass('B5 rows he-cr-1..3 with src hermes', ['he-cr-1', 'he-cr-2', 'he-cr-3'].every((id) => heRows.some((j) => j.id === id && j.src === 'hermes' && j.agent === 'HERMES')))
  pass('B5 last mapping failed/ok/warn', heRows.find((j) => j.id === 'he-cr-1').last === 'OK' && heRows.find((j) => j.id === 'he-cr-2').last === 'WARN' && heRows.find((j) => j.id === 'he-cr-3').last === 'FAIL')

  const r6a = mergeCrons(mockCrons, s)
  pass('B6 idempotent: added===0', r6a.added === 0 && s.schedules.filter((j) => j.id.startsWith('he-')).length === 3)

  const flapped = mockCrons.map((c) => (c.id === 'cr-2' ? { ...c, status: 'failed' } : c))
  const r6b = mergeCrons(flapped, s)
  pass('B6 status change updates last in place', r6b.added === 0 && r6b.updated >= 1 && s.schedules.find((j) => j.id === 'he-cr-2').last === 'FAIL' && s.schedules.filter((j) => j.id.startsWith('he-')).length === 3)
}

// ===========================================================================
// C. raiseFailureAlerts
// ===========================================================================
{
  const o = freshOrchestrator()
  const s = stateShape(o)
  const raised = raiseFailureAlerts(mockCrons, s, 1000)
  pass('C7 raises 2 alerts (failed cr-3, warn cr-2; not ok cr-1)', raised === 2)
  const hermesAlerts = s.alerts.filter((a) => a.source === 'HERMES')
  pass('C7 alerts sev warn, source HERMES, sig set, id prefix hea-', hermesAlerts.length === 2 && hermesAlerts.every((a) => a.sev === 'warn' && a.source === 'HERMES' && a.id.startsWith('hea-') && typeof a.sig === 'string' && a.sig.length > 0))
  pass('C7 alert ids hea-cr-2-1 and hea-cr-3-1', s.alerts.some((a) => a.id === 'hea-cr-2-1') && s.alerts.some((a) => a.id === 'hea-cr-3-1'))

  const r8 = raiseFailureAlerts(mockCrons, s)
  pass('C8 second identical call raises 0 (sig dedup)', r8 === 0)

  const target = s.alerts.find((a) => a.id === 'hea-cr-3-1')
  target.acked = true
  const r9 = raiseFailureAlerts(mockCrons, s)
  pass('C9 acked identical failure sig not re-raised', r9 === 0 && s.alerts.filter((a) => a.id === 'hea-cr-3-1').length === 1)

  const newFail = { ...mockCrons[2], last_run: '2026-08-12T13:00:00Z', history: [{ at: '2026-08-12T13:00:00Z', status: 'failed' }] }
  const r10 = raiseFailureAlerts([newFail], s)
  pass('C10 new last_run raises 1 fresh alert with incremented suffix', r10 === 1 && s.alerts.some((a) => a.id === 'hea-cr-3-2') && s.alerts.filter((a) => a.id.startsWith('hea-cr-3-')).length === 2)
}

// ===========================================================================
// D. syncHermesState against a live spawned mock (port 8791)
// ===========================================================================
{
  const PORT = '8791'
  const URL = `http://127.0.0.1:${PORT}`
  const INGEST_FILE = process.env.STELLARIS_DATA_DIR
    ? join(process.env.STELLARIS_DATA_DIR, 'hermes-ingest.json')
    : join(REPO, 'data', 'hermes-ingest.json')
  // Reset the persisted hash state so the first sync is guaranteed changed:true.
  mkdirSync(dirname(INGEST_FILE), { recursive: true })
  writeFileSync(INGEST_FILE, '{}')

  let child = null
  const waitForHealth = async (ms) => {
    const deadline = Date.now() + ms
    while (Date.now() < deadline) {
      try {
        const res = await fetch(`${URL}/health`, { signal: AbortSignal.timeout(1000) })
        if (res.ok) {
          const body = await res.json()
          if (body && body.ok) return true
        }
      } catch {}
      await new Promise((r) => setTimeout(r, 100))
    }
    return false
  }

  try {
    child = spawn('node', ['server/mock-hermes.js'], { cwd: REPO, env: { ...process.env, PORT }, stdio: 'ignore' })
    const up = await waitForHealth(8000)
    if (!up) {
      pass('D11 mock server started on 8791', false)
      pass('D11 first sync changed:true + counts', false)
      pass('D12 second sync changed:false + no duplicates', false)
      pass('D14 client.listCrons length 3', false)
    } else {
      pass('D11 mock server started on 8791', true)
      const client = createHermesClient({ enabled: true, url: URL, password: '', model: '', pollMs: 60000, ingestMs: 60000, approvalMode: 'prompt' })
      const o = freshOrchestrator()
      o.hermes = client
      const cfg = client.config

      const r11 = await syncHermesState(o, cfg)
      pass('D11 first sync returns changed:true', r11 && r11.changed === true)
      pass('D11 sessions===4 and crons===3', r11.sessions === 4 && r11.crons === 3)
      pass('D11 cardsAdded===4, jobsAdded===3, alertsRaised===2', r11.cardsAdded === 4 && r11.jobsAdded === 3 && r11.alertsRaised === 2)
      const heCards = o.s.kanban.cards.filter((c) => c.id.startsWith('he-'))
      pass('D11 orchestrator.s has 4 he- cards', heCards.length === 4 && heCards.every((c) => c.src === 'hermes'))
      pass('D11 orchestrator.s has 2 HERMES alerts', o.s.alerts.filter((a) => a.source === 'HERMES').length === 2)
      pass('D11 meta.dataSource==="hermes"', o.s.meta.dataSource === 'hermes')

      const r12 = await syncHermesState(o, cfg)
      pass('D12 second sync returns changed:false', r12 && r12.changed === false)
      pass('D12 no additional cards/alerts', o.s.kanban.cards.filter((c) => c.id.startsWith('he-')).length === 4 && o.s.alerts.filter((a) => a.source === 'HERMES').length === 2)

      const crons = await client.listCrons()
      pass('D14 client.listCrons() returns length 3', Array.isArray(crons) && crons.length === 3)

      suppressStoreFlush(o)
    }
  } finally {
    if (child) child.kill('SIGTERM')
  }
}

// ===========================================================================
// E. Orchestrator scheduler guard
// ===========================================================================
{
  const o = freshOrchestrator()
  const hermesRow = { id: 'he-cr-x', name: 'x', cron: '* * * * *', agent: 'HERMES', next: '09:00', last: 'FAIL', src: 'hermes' }
  const otherRow = { id: 'n-cr-x', name: 'nx', cron: '* * * * *', agent: 'CODA', next: '10:00', last: 'OK' }
  o.s.schedules.push(hermesRow)
  o.s.schedules.push(otherRow)
  for (let i = 0; i < 600; i++) o.tickScheduler()
  pass('E15 scheduler guard leaves hermes row untouched', hermesRow.last === 'FAIL' && hermesRow.next === '09:00')
  suppressStoreFlush(o)
}

// ===========================================================================
// F. mergeReplacement (github preservation)
// ===========================================================================
{
  const existingCards = [{ id: 'he-1', src: 'hermes' }, { id: 'gh-1' }]
  const existingItems = [{ id: 'he-1', src: 'hermes' }, { id: 'gh-1' }]
  const incoming = [{ id: 'gh-2' }]
  const merged = mergeReplacement(existingCards, existingItems, incoming, incoming)
  pass('F16 hermes card preserved first, gh-1 dropped', merged.cards.length === 2 && merged.cards[0].id === 'he-1' && merged.cards[1].id === 'gh-2' && !merged.cards.some((c) => c.id === 'gh-1'))
  pass('F16 hermes item preserved first, gh-1 dropped', merged.items.length === 2 && merged.items[0].id === 'he-1' && merged.items[1].id === 'gh-2' && !merged.items.some((i) => i.id === 'gh-1'))
}

// ===========================================================================
// Report
// ===========================================================================
if (existsSync(STATE_BACKUP)) renameSync(STATE_BACKUP, STATE_FILE)
console.log(results.join('\n'))
const fails = results.filter((r) => r.startsWith('FAIL'))
console.log(fails.length ? `\n${fails.length} FAILURES` : '\nALL PASS')
process.exit(fails.length ? 1 : 0)
