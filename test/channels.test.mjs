/**
 * CHANNELS SUITE // P9 typed channels + reducers.
 *   P9-1 built-in channels are registered
 *   P9-2 events frame folds spans into STATE.trace (newest-first, capped)
 *   P9-3 approval frame sets/clears STATE.approval.pending
 *   P9-4 unknown types are ignored without throwing
 *   P9-5 registerChannel overrides and rejects non-functions
 */
import { STATE } from '../src/store.js'
import { hasChannel, registerChannel, reduceEvent } from '../src/channels.js'

const results = []
const pass = (name, cond) => results.push(`${cond ? 'PASS' : 'FAIL'} ${name}`)

// ---- P9-1 ---------------------------------------------------------------
pass('P9-1 events channel registered', hasChannel('events'))
pass('P9-1 approval channel registered', hasChannel('approval'))
pass('P9-1 chat hint channel registered', hasChannel('chat'))

// ---- P9-2 ---------------------------------------------------------------
{
  STATE.trace = []
  const spans = [{ id: 's1', name: 'tool:CODA:shell' }, { id: 's2', name: 'run' }]
  const handled = reduceEvent({ type: 'events', events: spans })
  pass('P9-2 events frame handled', handled === true)
  pass('P9-2 spans folded newest-first', STATE.trace[0].name === 'run' && STATE.trace[1].name === 'tool:CODA:shell')
  STATE.trace = Array.from({ length: 49 }, (_, i) => ({ id: `old${i}` }))
  reduceEvent({ type: 'events', events: [{ id: 'new1' }, { id: 'new2' }] })
  pass('P9-2 trace capped at 50', STATE.trace.length === 50)
  pass('P9-2 newest spans kept', STATE.trace[0].id === 'new2')
}

// ---- P9-3 ---------------------------------------------------------------
{
  reduceEvent({ type: 'approval', pending: { id: 'r1', reason: 'rollout' } })
  pass('P9-3 pending set', STATE.approval.pending && STATE.approval.pending.id === 'r1')
  reduceEvent({ type: 'approval', pending: null })
  pass('P9-3 pending cleared', STATE.approval.pending === null)
}

// ---- P9-4 ---------------------------------------------------------------
{
  const before = JSON.stringify(STATE.trace)
  const handled = reduceEvent({ type: 'totally-unknown' })
  pass('P9-4 unknown type ignored', handled === false)
  pass('P9-4 state untouched by unknown', JSON.stringify(STATE.trace) === before)
  pass('P9-4 malformed frame safe', reduceEvent({}) === false && reduceEvent(null) === false)
}

// ---- P9-5 ---------------------------------------------------------------
{
  let called = 0
  registerChannel('probe', () => { called += 1 })
  reduceEvent({ type: 'probe' })
  pass('P9-5 custom channel reducer fires', called === 1)
  registerChannel('probe2', 'not-a-function')
  pass('P9-5 non-function registration ignored', reduceEvent({ type: 'probe2' }) === false)
}

console.log(results.join('\n'))
const fails = results.filter((r) => r.startsWith('FAIL'))
console.log(fails.length ? `\n${fails.length} FAILURES` : '\nALL PASS')
process.exit(fails.length ? 1 : 0)
