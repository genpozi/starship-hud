/**
 * INTERRUPT SUITE // P11 single-operator pause / interrupt / resume.
 *   P11-1 pause sets meta.paused and gates dispatch pickup
 *   P11-2 resume clears the hold and un-gates pickup
 *   P11-3 interrupt surfaces an approval-card frame (tool: interrupt)
 *   P11-4 resume clears the interrupt card (pending null)
 *   P11-5 in-flight steps continue while interrupted
 */
import { existsSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'
import { Orchestrator } from '../server/orchestrator.js'

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..')
const STATE_FILE = process.env.STELLARIS_DATA_DIR
  ? join(process.env.STELLARIS_DATA_DIR, 'state.json')
  : join(REPO, 'data', 'state.json')
const STATE_BACKUP = join(tmpdir(), 'interrupt-test.state.json')
if (existsSync(STATE_FILE)) renameSync(STATE_FILE, STATE_BACKUP)

const results = []
const pass = (name, cond) => results.push(`${cond ? 'PASS' : 'FAIL'} ${name}`)

function freshOrchestrator() {
  const frames = []
  const o = new Orchestrator({ onBroadcast: (m) => frames.push(m) })
  o.frames = frames
  o.start()
  o.stop()
  return o
}

// ---- P11-1/P11-2: pause gates pickup, resume un-gates ---------------------
{
  const o = freshOrchestrator()
  o.s.dispatch = []
  const a = o.s.agents.find((x) => x.id === 'orch')
  a.state = 'idle'
  a.progress = 0
  o.s.dispatch.push({ task: 'paused job', agent: 'ORCHESTRATOR', state: 'waiting', steps: [{ tool: 'shell', title: 'x' }], maxAttempts: 3 })
  o.pause('hold for review')
  pass('P11-1 pause sets meta.paused', o.s.meta.paused === true)
  o.tickAgents()
  pass('P11-1 job stays queued while paused', a.state === 'idle')
  o.resume()
  pass('P11-2 resume clears meta.paused', o.s.meta.paused === false)
  o.tickAgents()
  pass('P11-2 job picked up after resume', a.state === 'busy')
}

// ---- P11-3/P11-4: interrupt frames + resume --------------------------------
{
  const o = freshOrchestrator()
  o.frames.length = 0
  o.interrupt('turbulence detected', { agent: 'PILOT', goal: 'hold launch' })
  const card = o.frames.find((m) => m.type === 'approval' && m.pending && m.pending.tool === 'interrupt')
  pass('P11-3 interrupt surfaces approval card', !!card)
  pass('P11-3 card carries reason + agent', !!card && card.pending.summary === 'turbulence detected' && card.pending.from === 'PILOT')
  pass('P11-3 interrupt records _interrupt', !!o._interrupt && o._interrupt.goal === 'hold launch')
  o.frames.length = 0
  o.resume()
  pass('P11-4 resume clears interrupt', o._interrupt === null && o.s.meta.paused === false)
  pass('P11-4 resume broadcasts pending null', o.frames.some((m) => m.type === 'approval' && m.pending === null))
}

// ---- P11-5: in-flight work continues during interrupt -----------------------
{
  const o = freshOrchestrator()
  o.s.dispatch = []
  const a = o.s.agents.find((x) => x.id === 'orch')
  a.state = 'idle'
  a.progress = 0
  o.s.dispatch.push({ task: 'in-flight job', agent: 'ORCHESTRATOR', state: 'waiting', steps: [{ tool: 'shell', title: 'y' }, { tool: 'shell', title: 'z' }], maxAttempts: 3 })
  o.tickAgents() // pickup -> busy
  const ctx = o._agentJobs.get('ORCHESTRATOR')
  o.interrupt('hold') // interrupt AFTER the job is in flight
  const p0 = a.progress
  o._advanceStep(a, ctx)
  await new Promise((r) => setTimeout(r, 15)) // let the step resolve
  pass('P11-5 in-flight step completed during interrupt', ctx.stepIndex === 1)
  pass('P11-5 in-flight agent progressed during interrupt', a.progress >= p0)
}

console.log(results.join('\n'))
const fails = results.filter((r) => r.startsWith('FAIL'))
console.log(fails.length ? `\n${fails.length} FAILURES` : '\nALL PASS')

if (existsSync(STATE_BACKUP)) renameSync(STATE_BACKUP, STATE_FILE)
process.exit(fails.length ? 1 : 0)
