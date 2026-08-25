/**
 * SUPERSTEP SUITE // P8 superstep DAG dependency barrier.
 *   P8-1 planner emits dependsOn chains referencing earlier step titles
 *   P8-2 normalizeSteps carries dependsOn into queued dispatch jobs
 *   P8-3 a job whose step dependsOn an uncompleted title stays queued
 *   P8-4 once the dependency completes, the blocked job is picked up
 */
import { existsSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'
import { Orchestrator } from '../server/orchestrator.js'
import { plan } from '../server/planner.js'

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..')
const STATE_FILE = process.env.STELLARIS_DATA_DIR
  ? join(process.env.STELLARIS_DATA_DIR, 'state.json')
  : join(REPO, 'data', 'state.json')
const STATE_BACKUP = join(tmpdir(), 'superstep-test.state.json')
if (existsSync(STATE_FILE)) renameSync(STATE_FILE, STATE_BACKUP)

const results = []
const pass = (name, cond) => results.push(`${cond ? 'PASS' : 'FAIL'} ${name}`)

function freshOrchestrator() {
  const o = new Orchestrator({ onBroadcast: () => {} })
  o.start()
  o.stop()
  return o
}

// ---- P8-1: planner emits dependsOn chains --------------------------------
{
  const steps = await plan('implement the build')
  const titles = steps.map((s) => s.title)
  pass('P8-1 plan has >=2 steps', steps.length >= 2)
  pass(
    'P8-1 every dependsOn refs an earlier step',
    steps.every((s, i) =>
      (s.dependsOn || []).every((d) => titles.slice(0, i).includes(d))
    )
  )
  const first = steps.find((s) => (s.dependsOn || []).length === 0)
  const second = steps.find((s) => (s.dependsOn || []).length > 0)
  pass('P8-1 first step has no deps, later steps do', !!first && !!second)
}

// ---- P8-2: handleChat carries dependsOn into queued dispatch --------------
{
  const o = freshOrchestrator()
  await o.handleChat('implement the build')
  const j = o.s.dispatch.find((d) => d.task === 'Write unit coverage')
  pass('P8-2 queued job steps preserve dependsOn', !!j && Array.isArray(j.steps[0].dependsOn))
  pass(
    'P8-2 queued dependency refs the scaffold step',
    !!j && j.steps[0].dependsOn.includes('Scaffold implementation')
  )
}

// ---- P8-3/P8-4: dependency barrier gates pickup ---------------------------
{
  const o = freshOrchestrator()
  o.s.dispatch = [] // isolate the barrier from seeded jobs
  const a = o.s.agents.find((x) => x.id === 'orch')
  a.state = 'idle'
  a.progress = 0
  o._chatWorkflows.set('wf-bar', { total: 2, done: 1, failed: 0, completed: new Set(['A']) })
  o.s.dispatch.push({
    task: 'blocked step',
    agent: 'ORCHESTRATOR',
    state: 'waiting',
    steps: [{ tool: 'shell', title: 'C', dependsOn: ['C'] }],
    wfId: 'wf-bar',
    maxAttempts: 3
  })
  o.tickAgents()
  pass('P8-3 blocked job not picked up', a.state === 'idle')

  o._chatWorkflows.get('wf-bar').completed.add('C')
  o.tickAgents()
  pass('P8-4 dependency satisfied -> job picked up', a.state === 'busy')
}

console.log(results.join('\n'))
const fails = results.filter((r) => r.startsWith('FAIL'))
console.log(fails.length ? `\n${fails.length} FAILURES` : '\nALL PASS')

if (existsSync(STATE_BACKUP)) renameSync(STATE_BACKUP, STATE_FILE)
process.exit(fails.length ? 1 : 0)
