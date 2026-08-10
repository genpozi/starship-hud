/**
 * PLANNER // Decomposes goals into missions.
 *
 * If the operator supplies USER_LLM_API_KEY / USER_LLM_BASE_URL / USER_LLM_MODEL
 * environment variables, the planner asks a real LLM to decompose a goal into
 * orchestrated steps. Otherwise it falls back to a deterministic heuristic
 * planner so the harness runs with zero external dependencies.
 *
 * The key values come from the OPERATOR, never from the agent runtime
 * environment — see .env.example.
 */

import { SKILLS } from './skills.js'

const hasLLM = () => Boolean(process.env.USER_LLM_API_KEY)

const VALID_TOOLS = new Set(Object.keys(SKILLS))

/**
 * Sanitize planner output: coerce shape and map any unknown tool names onto
 * the safe `search` fallback so the step machine never runs an unregistered
 * tool.
 */
function normalizeSteps(steps) {
  if (!Array.isArray(steps)) return []
  const seen = new Set()
  const out = []
  for (const s of steps) {
    if (!s || !s.title) continue
    const title = String(s.title).trim()
    if (!title || seen.has(title)) continue
    seen.add(title)
    out.push({
      title,
      agent: String(s.agent || 'ORCH').toUpperCase(),
      tool: VALID_TOOLS.has(s.tool) ? s.tool : 'search'
    })
  }
  return out
}

function heuristicPlan(goal) {
  const g = goal.toLowerCase()
  const steps = []
  if (/(search|research|summar|analy)/.test(g)) {
    steps.push({ title: 'Surface research on request', agent: 'SAGE', tool: 'search' })
    steps.push({ title: 'Synthesize findings into a report', agent: 'SAGE', tool: 'memory' })
  }
  if (/(build|implement|code|fix|refactor)/.test(g)) {
    steps.push({ title: 'Scaffold implementation', agent: 'CODA', tool: 'shell' })
    steps.push({ title: 'Write unit coverage', agent: 'CODA', tool: 'coder' })
    steps.push({ title: 'Run validation pass', agent: 'PILOT', tool: 'shell' })
  }
  if (/(deploy|release|rollout|canary)/.test(g)) {
    steps.push({ title: 'Stage release artifacts', agent: 'PILOT', tool: 'shell' })
    steps.push({ title: 'Canary rollout gate', agent: 'PILOT', tool: 'terminal' })
  }
  if (/(merge|archive|clean|sweep)/.test(g)) {
    steps.push({ title: 'Deduplicate and compact blobs', agent: 'LINK', tool: 'files' })
    steps.push({ title: 'Archive to core bank', agent: 'LINK', tool: 'memory' })
  }
  if (steps.length === 0) {
    steps.push({ title: `Triage: ${goal}`, agent: 'ORCH', tool: 'search' })
    steps.push({ title: 'Assign and execute sub-tasks', agent: 'ORCH', tool: 'memory' })
    steps.push({ title: 'Report completion to operator', agent: 'ORCH', tool: 'shell' })
  }
  return steps
}

async function llmPlan(goal) {
  const url = process.env.USER_LLM_BASE_URL || 'https://api.deepseek.com/v1'
  const model = process.env.USER_LLM_MODEL || 'deepseek-chat'
  const res = await fetch(`${url}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.USER_LLM_API_KEY}`
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: 'system',
          content:
            'You are the STELLARIS-7 mission planner. Decompose the operator goal into 2-5 concrete orchestrated steps. Reply ONLY with strict JSON: [{"title":"...","agent":"CODA|SAGE|PILOT|LINK|NUDGE|ORCH","tool":"search|shell|coder|memory|files|terminal"}].'
        },
        { role: 'user', content: goal }
      ],
      temperature: 0.4,
      max_tokens: 800
    })
  })
  if (!res.ok) throw new Error(`planner LLM ${res.status}`)
  const json = await res.json()
  const content = json?.choices?.[0]?.message?.content ?? ''
  const match = content.match(/\[[\s\S]*\]/)
  if (!match) throw new Error('planner LLM returned no JSON array')
  return JSON.parse(match[0])
}

/**
 * plan(goal) → [{ title, agent, tool }]
 * Prefers the LLM when configured; always falls back on failure.
 */
export async function plan(goal) {
  if (hasLLM()) {
    try {
      return normalizeSteps(await llmPlan(goal))
    } catch (err) {
      console.warn('[planner] LLM failed, using heuristic:', err.message)
    }
  }
  return normalizeSteps(heuristicPlan(goal))
}
