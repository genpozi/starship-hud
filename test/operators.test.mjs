/**
 * OPERATORS SUITE // P13 multi-operator sessions.
 *   hello roster, pause single-holder 409, approval routes to run owner
 */
import { existsSync, renameSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { Orchestrator } from '../server/orchestrator.js'
import { normalizeOperatorId } from '../server/operators.js'

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..')
const STATE_FILE = process.env.STELLARIS_DATA_DIR
  ? join(process.env.STELLARIS_DATA_DIR, 'state.json')
  : join(REPO, 'data', 'state.json')
const STATE_BACKUP = join(tmpdir(), 'operators-test.state.json')
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

pass('normalizeOperatorId lowercases', normalizeOperatorId('Alice Ops') === 'alice-ops')
pass('normalizeOperatorId empty → operator', normalizeOperatorId('') === 'operator')

{
  const o = freshOrchestrator()
  pass('meta.operators seeded', Array.isArray(o.s.meta.operators))
  const a = { send() {} }
  const b = { send() {} }
  o.hello(a, { operatorId: 'alice' })
  o.hello(b, { operatorId: 'bob', name: 'Bob' })
  const ids = o.s.meta.operators.map((x) => x.id)
  pass('hello records two operators', ids.includes('alice') && ids.includes('bob'))
  o.goodbye(a)
  pass('goodbye drops alice', o.s.meta.operators.every((x) => x.id !== 'alice'))
  pass('bob remains', o.s.meta.operators.some((x) => x.id === 'bob'))
}

{
  const o = freshOrchestrator()
  const r1 = o.pause('hold', 'alice')
  pass('alice pause ok', r1.ok === true)
  const r2 = o.pause('hold', 'bob')
  pass('bob pause 409', r2.ok === false && r2.error === 'pause held' && r2.holder === 'alice')
  const r3 = o.resume('bob')
  pass('bob resume 409', r3.ok === false && r3.error === 'pause held')
  const r4 = o.resume('alice')
  pass('alice resume ok', r4.ok === true && r4.resumed === true)
  pass('pause cleared', o.s.meta.paused === false)
}

{
  const o = freshOrchestrator()
  const pending = o._awaitApproval({ tool: 'terminal', summary: 'push?' }, 'LINK', 'alice')
  pass('approval owner stamped', o.s.approval.pending && o.s.approval.pending.owner === 'alice')
  const denied = o.respondApproval('approve', 'bob')
  pass('foreign operator blocked', denied.ok === false && denied.error === 'not owner')
  const ok = o.respondApproval('approve', 'alice')
  pass('owner can approve', ok.ok === true && ok.choice === 'approve')
  await pending
}

{
  const o = freshOrchestrator()
  o.interrupt('hold', { agent: 'PILOT', operatorId: 'alice' })
  const card = o.respondApproval('approve', 'alice')
  pass('interrupt card not via approval', card.ok === false && card.error === 'use resume')
  o.resume('alice')
}

console.log(results.join('\n'))
const fails = results.filter((r) => r.startsWith('FAIL'))
console.log(fails.length ? `\n${fails.length} FAILURES` : '\nALL PASS')
if (existsSync(STATE_BACKUP)) renameSync(STATE_BACKUP, STATE_FILE)
process.exit(fails.length ? 1 : 0)
