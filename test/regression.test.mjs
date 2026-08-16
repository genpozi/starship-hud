/**
 * REGRESSION SUITE — guards the review fixes:
 *   B1 escapeHtml        — every state-derived renderer must escape markup
 *   B2 assigned jobs     — seeded `assigned` dispatch rows complete, not orphaned
 *   B3 in-flight gating  — agent progress/tokens untouched while a step runs
 *   B4 mention detection — no false positives on common words, @ORCH alias works
 *   B5 planner agent     — ORCH steps resolve to the real crew name ORCHESTRATOR
 */
import { existsSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'
import { Orchestrator } from '../server/orchestrator.js'
import { plan } from '../server/planner.js'
import { escapeHtml } from '../src/views.js'

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..')
const STATE_FILE = join(REPO, 'data', 'state.json')
const STATE_BACKUP = join(tmpdir(), 'regression-test.state.json')
if (existsSync(STATE_FILE)) renameSync(STATE_FILE, STATE_BACKUP)

const results = []
const pass = (name, cond) => results.push(`${cond ? 'PASS' : 'FAIL'} ${name}`)

function freshOrchestrator() {
  const o = new Orchestrator({ onBroadcast: () => {} })
  o.start()
  o.stop()
  return o
}

// ---- B1: escapeHtml ------------------------------------------------------
pass('B1 escapes <script> tags', escapeHtml('<script>alert(1)</script>') === '&lt;script&gt;alert(1)&lt;/script&gt;')
pass('B1 escapes onerror payload', escapeHtml('<img src=x onerror=alert(1)>') === '&lt;img src=x onerror=alert(1)&gt;')
pass('B1 escapes quotes & ampersand', escapeHtml('a"b\'c&d') === 'a&quot;b&#39;c&amp;d')
pass('B1 null/undefined render empty', escapeHtml(null) === '' && escapeHtml(undefined) === '')

// ---- B2: seeded assigned jobs complete ------------------------------------
{
  const o = freshOrchestrator()
  const seedCount = o.s.dispatch.length
  const assignedAtBoot = o.s.dispatch.filter((d) => d.state === 'assigned').length
  // drive well past every agent's sim completion + assigned-job pickup cycle
  for (let i = 0; i < 2000; i++) o.tickAgents()
  const terminal = o.s.dispatch.filter((d) => d.state === 'done' || d.state === 'failed').length
  const stuck = o.s.dispatch.filter((d) => d.state === 'assigned').length
  pass(`B2 seed rows (${seedCount}) all reach terminal state`, terminal === seedCount)
  pass('B2 zero jobs stuck in assigned', stuck === 0)
}

// ---- B3: progress is frozen while a step is in flight ----------------------
{
  const o = freshOrchestrator()
  // ORCHESTRATOR has no seed dispatch jobs, so the pushed job is the only match.
  const a = o.s.agents.find((x) => x.id === 'orch')
  a.state = 'idle'
  a.progress = 0
  o.s.dispatch.push({
    task: 'regression step job',
    agent: 'ORCHESTRATOR',
    state: 'waiting',
    steps: [{ tool: 'search', title: 'one' }],
    wfId: 'wf-reg',
    maxAttempts: 3
  })
  o.tickAgents() // idle → picks the job up
  const ctx = o._agentJobs.get('ORCHESTRATOR')
  const p0 = a.progress
  o._advanceStep(a, ctx) // sets inFlight=true synchronously; resolve is a microtask
  o.tickAgents() // runs BEFORE the microtask → inFlight still true
  pass('B3 progress not advanced while step in flight', a.progress === p0)
  await new Promise((r) => setTimeout(r, 10)) // let the step resolve
  pass('B3 step completed after resolve', !o._agentJobs.has('ORCHESTRATOR') && ctx.stepIndex === 1)
}

// ---- B4: mention detection -------------------------------------------------
{
  const o = freshOrchestrator()
  const m = (t) => o._detectMention(t)
  pass('B4 @CODA routes to CODA', m('@CODA tell me') === 'CODA')
  pass('B4 @coda (lowercase) still routes', m('@coda tell me') === 'CODA')
  pass('B4 bare capitalized CODA routes', m('CODA tell me') === 'CODA')
  pass('B4 trailing-name route', m('route this to PILOT') === 'PILOT')
  pass('B4 "@ORCH" alias → ORCHESTRATOR', m('@ORCH decompose this') === 'ORCHESTRATOR')
  pass('B4 "ORCH," alias → ORCHESTRATOR', m('ORCH, decompose this') === 'ORCHESTRATOR')
  pass('B4 full ORCHESTRATOR routes', m('ORCHESTRATOR, decompose this') === 'ORCHESTRATOR')
  pass('B4 lowercase "link" NOT a mention', m('link up the services') === null)
  pass('B4 lowercase "pilot" NOT a mention', m('pilot the project') === null)
  pass('B4 lowercase "sage" NOT a mention', m('sage advice') === null)
}

// ---- B5: planner resolves ORCH → ORCHESTRATOR -------------------------------
{
  const steps = await plan('do a thing that matches nothing at all')
  pass('B5 heuristic catch-all resolves agent', steps.length > 0 && steps.every((s) => s.agent !== 'ORCH'))
}

console.log(results.join('\n'))
const fails = results.filter((r) => r.startsWith('FAIL'))
console.log(fails.length ? `\n${fails.length} FAILURES` : '\nALL PASS')

if (existsSync(STATE_BACKUP)) renameSync(STATE_BACKUP, STATE_FILE)
process.exit(fails.length ? 1 : 0)
