/**
 * SKILLS SUITE // Registry validation + skill executor behavior.
 */
import { SKILLS, validateSkills, getSkill, runSkill } from '../server/skills.js'

const results = []
const pass = (name, cond) => results.push(`${cond ? 'PASS' : 'FAIL'} ${name}`)

pass('registry validates (no throw)', validateSkills() === true)
pass('registry non-empty', Object.keys(SKILLS).length >= 7)
pass('hermes skill registered', !!SKILLS.hermes && SKILLS.hermes.name === 'hermes')
pass('every skill has an executor', Object.values(SKILLS).every((s) => typeof s.execute === 'function'))

const ctx = { agent: 'SAGE', s: { vault: [] }, log: () => {}, pushChat: () => {}, broadcast: () => {} }

const search = await runSkill('search', ctx)
pass('search executor returns results', search && typeof search.results === 'number')

const mem = await runSkill('memory', { ...ctx })
pass('memory executor appends vault doc', mem && typeof mem.id === 'string' && ctx.s.vault.length === 1 && ctx.s.vault[0].type === 'MEMORY')

// hermes skill simulated fallback when no client configured
const hermesNoClient = await runSkill('hermes', { ...ctx, hermes: null, approvalMode: 'prompt', step: 'X' })
pass('hermes skill simulated when client absent', hermesNoClient && hermesNoClient.simulated === true && hermesNoClient.delegated === false)

// hermes skill errors gracefully when client is unreachable
const offlineClient = { isEnabled: () => true, streamChat: async () => { throw new Error('ECONNREFUSED') }, syncChat: async () => { throw new Error('ECONNREFUSED') }, approvalRespond: async () => {} }
const hermesOffline = await runSkill('hermes', { ...ctx, hermes: offlineClient, approvalMode: 'never', step: 'X' })
pass('hermes skill surfaces error when upstream unreachable', hermesOffline && hermesOffline.error && hermesOffline.error.length > 0)

// unknown tool falls back to search (planner safety)
pass('unknown skill resolves to search', getSkill('not-a-real-tool').name === 'search')

console.log(results.join('\n'))
const fails = results.filter((r) => r.startsWith('FAIL'))
console.log(fails.length ? `\n${fails.length} FAILURES` : '\nALL PASS')
process.exit(fails.length ? 1 : 0)
