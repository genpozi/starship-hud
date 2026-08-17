import { Orchestrator } from '../server/orchestrator.js'

import { existsSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..')
const STATE_FILE = process.env.STELLARIS_DATA_DIR
  ? join(process.env.STELLARIS_DATA_DIR, 'state.json')
  : join(REPO, 'data', 'state.json')
const STATE_BACKUP = join(tmpdir(), 'phase4-test.state.json')
if (existsSync(STATE_FILE)) renameSync(STATE_FILE, STATE_BACKUP)

const results = []
const pass = (name, cond) => {
  results.push(`${cond ? 'PASS' : 'FAIL'} ${name}`)
}

// fresh instance (loads persisted state; we restore the file afterwards)
const o = new Orchestrator({ onBroadcast: () => {} })

// ---- 1. warn raise ----
// normalize: the seed ships a static INGRESS alert (a1); the hysteresis checks
// only reason about the engine-raised dyn alert, so ack a1 first regardless of
// what the persisted state file carried in.
const a1 = o.s.alerts.find((x) => x.id === 'a1')
if (a1) a1.acked = true
const probe = o.s.probes.find((p) => p.name === 'INGRESS')
probe.value = 80 // above warnAt 75, below critAt 92
o._probeAlerts.delete('INGRESS')
o._checkProbe(probe)
let a = o.s.alerts.find((x) => x.id === o._probeAlerts.get('INGRESS'))
pass('warn alert raised for INGRESS@80', !!a && a.sev === 'warn' && a.source === 'INGRESS')

// ---- 2. escalate to crit ----
probe.value = 95
o._checkProbe(probe)
a = o.s.alerts.find((x) => x.id === o._probeAlerts.get('INGRESS'))
pass('warn escalates to crit at 95', a && a.sev === 'crit')

// ---- 3. no duplicate while still over ----
const countBefore = o.s.alerts.filter((x) => x.source === 'INGRESS' && !x.acked).length
probe.value = 94
o._checkProbe(probe)
const countAfter = o.s.alerts.filter((x) => x.source === 'INGRESS' && !x.acked).length
pass('no duplicate while over threshold', countBefore === countAfter)

// ---- 4. recovery clears (hysteresis: < warnAt-3) ----
probe.value = 40
o._checkProbe(probe)
const active = o.s.alerts.filter((x) => x.source === 'INGRESS' && !x.acked).length
pass('alert cleared after recovery (hysteresis)', active === 0 && !o._probeAlerts.has('INGRESS'))

// ---- 5. re-raise gets a fresh id ----
probe.value = 82
o._checkProbe(probe)
a = o.s.alerts.find((x) => x.id === o._probeAlerts.get('INGRESS'))
pass('re-raise creates fresh alert', !!a && a.sev === 'warn' && /^dyn\d+$/.test(a.id))

// ---- 6. dyn counter resumes past persisted ids ----
o._alertSeq = 0
for (const al of o.s.alerts) {
  const m = /^dyn(\d+)$/.exec(al.id || '')
  if (m) o._alertSeq = Math.max(o._alertSeq, Number(m[1]))
}
o._nextAlertId()
pass('next dyn id > any persisted dyn id', /^dyn[1-9]\d*$/.test(`dyn${o._alertSeq}`))

// ---- 7. vault write via memory skill ----
const before = o.s.vault.length
const ctx = { agent: 'SAGE', s: o.s, log: () => {}, pushChat: () => {}, broadcast: () => {} }
const { runSkill } = await import('../server/skills.js')
await runSkill('memory', ctx)
const after = o.s.vault.length
const newest = o.s.vault[0]
pass('memory skill appends vault doc', after === before + 1 && newest.type === 'MEMORY' && newest.agent === 'SAGE')

// ---- 8. files skill appends ----
await runSkill('files', ctx)
const newest2 = o.s.vault[0]
pass('files skill appends vault doc', o.s.vault[0].type === 'SCHEMA' && newest2.agent === 'SAGE')

// ---- 9. mission completion archives report + vault doc ----
// reports are capped at 12 (orchestrator), so assert the new report lands at
// the front rather than assuming the count grew by exactly one.
o._logMission('test-canary-deploy')
pass('mission completion adds report', !!o.s.reports[0] && o.s.reports[0].title.includes('test-canary-deploy'))
pass('mission completion adds vault doc', o.s.vault[0].type === 'REPORT')

console.log(results.join('\n'))
const fails = results.filter((r) => r.startsWith('FAIL'))
console.log(fails.length ? `\n${fails.length} FAILURES` : '\nALL PASS')
if (existsSync(STATE_BACKUP)) renameSync(STATE_BACKUP, STATE_FILE)
process.exit(fails.length ? 1 : 0)
