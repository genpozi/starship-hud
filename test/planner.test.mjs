/**
 * PLANNER SUITE // Heuristic plan decomposition + step normalization.
 * Runs with no external LLM configured — verifies the zero-dependency path.
 */
import { plan } from '../server/planner.js'
import { SKILLS } from '../server/skills.js'

const results = []
const pass = (name, cond) => results.push(`${cond ? 'PASS' : 'FAIL'} ${name}`)

delete process.env.USER_LLM_API_KEY

const VALID_TOOLS = new Set(Object.keys(SKILLS))
const VALID_AGENTS = new Set(['CODA', 'SAGE', 'PILOT', 'LINK', 'NUDGE', 'ORCH'])

const research = await plan('research the new ingress architecture and analyze the tradeoffs')
pass('research goal → steps with valid tools', Array.isArray(research) && research.length >= 2 && research.every((s) => VALID_TOOLS.has(s.tool)))
pass('research/analyze includes hermes delegation', research.some((s) => s.tool === 'hermes'))
pass('steps carry title/agent/tool', research.every((s) => s.title && s.agent && s.tool))
pass('agents from the crew manifest', research.every((s) => VALID_AGENTS.has(s.agent)))

const build = await plan('build the auth refresh flow and write unit coverage')
pass('build goal → coder/shell steps', build.some((s) => s.tool === 'coder') && build.some((s) => s.tool === 'shell'))

const deploy = await plan('deploy canary v1.4.2 to the fleet')
pass('deploy goal → release/rollout steps', deploy.some((s) => s.tool === 'shell'))

const generic = await plan('do a thing that matches nothing')
pass('generic goal → fallback triage steps', generic.length >= 2 && generic.every((s) => VALID_TOOLS.has(s.tool)))

const normalized = await plan('build x') // heuristic returns objects
pass('plan result is normalized array', Array.isArray(normalized))

console.log(results.join('\n'))
const fails = results.filter((r) => r.startsWith('FAIL'))
console.log(fails.length ? `\n${fails.length} FAILURES` : '\nALL PASS')
process.exit(fails.length ? 1 : 0)
