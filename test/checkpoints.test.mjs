/**
 * CHECKPOINTS SUITE // P10 snapshot + rollback.
 *   P10-1 boot guard captures the loaded state as the first checkpoint
 *   P10-2 captureCheckpoint appends snapshots and returns an id
 *   P10-3 rollback restores a changed slice and records meta.lastRollback
 *   P10-4 checkpoint list is capped
 *   P10-5 rollback with no state change returns empty slices
 *   P10-6 rollbackToLatest on an empty list yields no id
 */
import { existsSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'
import { Orchestrator } from '../server/orchestrator.js'
import { CHECKPOINT_CAP, captureCheckpoint, rollbackToLatest } from '../server/checkpoints.js'

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..')
const STATE_FILE = process.env.STELLARIS_DATA_DIR
  ? join(process.env.STELLARIS_DATA_DIR, 'state.json')
  : join(REPO, 'data', 'state.json')
const STATE_BACKUP = join(tmpdir(), 'checkpoints-test.state.json')
if (existsSync(STATE_FILE)) renameSync(STATE_FILE, STATE_BACKUP)

const results = []
const pass = (name, cond) => results.push(`${cond ? 'PASS' : 'FAIL'} ${name}`)

function freshOrchestrator() {
  const o = new Orchestrator({ onBroadcast: () => {} })
  o.start()
  o.stop()
  return o
}

// ---- P10-1: boot guard --------------------------------------------------
{
  const o = freshOrchestrator()
  pass('P10-1 boot checkpoint exists', o.s.checkpoints.length >= 1)
  pass('P10-1 boot checkpoint reason boot', o.s.checkpoints[0].reason === 'boot')
  pass('P10-1 meta.bootCheckpointId points at it', o.s.meta.bootCheckpointId === o.s.checkpoints[0].id)
  const bootSnap = o.s.checkpoints[0].state
  pass('P10-1 boot snapshot has agents', Array.isArray(bootSnap.agents) && bootSnap.agents.length > 0)
}

// ---- P10-2/P10-3: capture + rollback ------------------------------------
{
  const o = freshOrchestrator()
  const before = o.s.telemetry.temp
  o.s.telemetry.temp = 9999
  const id = o.captureCheckpoint('pre-test-mutation')
  pass('P10-2 capture returns an id', typeof id === 'string' && id.startsWith('ckpt_'))
  pass('P10-2 checkpoint recorded', o.s.checkpoints[o.s.checkpoints.length - 1].id === id)
  o.s.telemetry.temp = 1111
  const res = o.rollback()
  pass('P10-3 rollback returns the captured id', res.id === id)
  pass('P10-3 changed slice restored', o.s.telemetry.temp === 9999)
  pass('P10-3 meta.lastRollback tagged', o.s.meta.lastRollback && o.s.meta.lastRollback.slices.includes('telemetry'))
}

// ---- P10-4: cap ----------------------------------------------------------
{
  const o = freshOrchestrator()
  for (let i = 0; i < CHECKPOINT_CAP + 3; i++) o.captureCheckpoint(`bulk${i}`)
  pass('P10-4 checkpoint list capped', o.s.checkpoints.length === CHECKPOINT_CAP)
  pass('P10-4 newest kept', o.s.checkpoints[o.s.checkpoints.length - 1].reason === `bulk${CHECKPOINT_CAP + 2}`)
}

// ---- P10-5: no-change rollback -------------------------------------------
{
  const o = freshOrchestrator()
  o.captureCheckpoint('noop')
  const res = o.rollback()
  pass('P10-5 no-op rollback returns id with empty slices', res.id !== null && res.slices.length === 0)
}

// ---- P10-6: empty list ----------------------------------------------------
{
  const res = rollbackToLatest([], {})
  pass('P10-6 empty list yields null id', res.id === null && res.slices.length === 0)
  const cap = captureCheckpoint([], { a: 1 }, { reason: 'x' })
  pass('P10-6 captureCheckpoint seeds a list', cap.length === 1)
}

console.log(results.join('\n'))
const fails = results.filter((r) => r.startsWith('FAIL'))
console.log(fails.length ? `\n${fails.length} FAILURES` : '\nALL PASS')

if (existsSync(STATE_BACKUP)) renameSync(STATE_BACKUP, STATE_FILE)
process.exit(fails.length ? 1 : 0)
