import { createHermesClient, getConfig } from '../server/hermes.js'
import { runSkill } from '../server/skills.js'
import { Orchestrator } from '../server/orchestrator.js'

const results = []
const pass = (name, cond) => results.push(`${cond ? 'PASS' : 'FAIL'} ${name}`)

process.env.USER_HERMES_URL = process.env.MOCK_URL
delete process.env.USER_HERMES_PASSWORD

const client = createHermesClient()

// 1. health
const h = await client.health()
pass('health ok against mock', h.ok === true)

// 2. config shape + approval mode
pass('isEnabled with URL set', client.isEnabled() === true)
pass('approvalMode defaults to prompt', getConfig().approvalMode === 'prompt')
process.env.USER_HERMES_APPROVAL = 'always'
pass('approvalMode reads env', getConfig().approvalMode === 'always')
process.env.USER_HERMES_APPROVAL = 'prompt'

// 3. syncChat (blocking)
const r = await client.syncChat('trace the ingress latency regression')
pass('syncChat returns final response', typeof r.final_response === 'string' && r.final_response.length > 20)
pass('syncChat completed', r.completed === true)
pass('syncChat reused session id', typeof r.session_id === 'string' && r.session_id.length === 12)

// 4. sessions list
const sessions = await client.listSessions()
pass('listSessions returns array', Array.isArray(sessions))

// 5. streamChat (SSE) with auto-approved approval event
const tokens = []
const tools = []
let sawApproval = false
const sr = await client.streamChat('summarize the canary rollout', {
  onToken: (t) => tokens.push(t),
  onTool: (t) => tools.push(t),
  onApproval: async (data) => {
    sawApproval = Boolean(data && data.summary)
    await client.approvalRespond('always')
  }
})
pass('streamChat collected tokens', tokens.length >= 5)
pass('streamChat saw a tool event', tools.length >= 1)
pass('streamChat approval callback fired', sawApproval === true)
pass('streamChat returned final response', sr.final_response.length > 10)

// 6. approval endpoints
const pending = await client.approvalPending()
pass('approvalPending returns null when idle', pending === null)
const resp = await client.approvalRespond('always')
pass('approvalRespond ok', resp && resp.ok === true)

// 7. skill executor against mock (hermes configured)
const o = new Orchestrator({ onBroadcast: () => {} })
o.hermes = client
const before = o.s.vault.length
const skillCtx = { agent: 'LINK', hermes: client, s: o.s, log: () => {}, pushChat: () => {}, broadcast: () => {}, step: 'Delegate deep-dive to Hermes', approvalMode: 'always' }
const skillRes = await runSkill('hermes', skillCtx)
pass('hermes skill delegated', skillRes.delegated === true && skillRes.result.length > 10)
pass('hermes skill wrote vault doc', o.s.vault.length === before + 1 && o.s.vault[0].type === 'DELEGATE')

// 7b. orchestrator approval bridge: pending surfaced, respondApproval resolves
const apPromise = o._awaitApproval({ tool: 'terminal', summary: 'Allow git push?', detail: 'operator test' }, 'LINK')
pass('approval surfaced to state', o.s.approval.pending !== null && o.s.approval.pending.summary === 'Allow git push?')
const resp2 = o.respondApproval('approve')
pass('respondApproval ok', resp2.ok === true && resp2.choice === 'approve')
const choice = await apPromise
pass('_awaitApproval resolved with operator choice', choice === 'approve')
pass('approval cleared after resolve', o.s.approval.pending === null)
pass('approval recorded in history', o.s.approval.history.length >= 1 && o.s.approval.history[0].choice === 'approve')

// 7c. respondApproval with nothing pending
pass('respondApproval rejects when idle', o.respondApproval('approve').ok === false)

// 8. offline fallback (unreachable URL -> skill returns error)
const offline = createHermesClient({ enabled: true, url: 'http://127.0.0.1:59999', password: '', model: '', pollMs: 180000, approvalMode: 'prompt' })
const h2 = await offline.health()
pass('offline health detects unreachable', h2.ok === false)
const offlineCtx = { agent: 'LINK', hermes: offline, s: o.s, log: () => {}, pushChat: () => {}, broadcast: () => {}, step: 'X' }
const offlineRes = await runSkill('hermes', offlineCtx)
pass('skill falls back gracefully offline', offlineRes.error && offlineRes.error.length > 0)

// 9. skill without client (not configured) -> simulated
const noneCtx = { agent: 'LINK', hermes: null, s: o.s, log: () => {}, pushChat: () => {}, broadcast: () => {}, step: 'X' }
const noneRes = await runSkill('hermes', noneCtx)
pass('skill simulated when no client', noneRes.simulated === true)

console.log(results.join('\n'))
const fails = results.filter((r) => r.startsWith('FAIL'))
console.log(fails.length ? `\n${fails.length} FAILURES` : '\nALL PASS')
process.exit(fails.length ? 1 : 0)
