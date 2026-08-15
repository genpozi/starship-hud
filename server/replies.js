/**
 * REPLIES // Conversational reply synthesis for operator chat (Phase 2).
 *
 * Before this module the only "agent reply" was the canned `Task complete:`
 * line the step machine pushes. `synthesizeReply` gives the operator a real,
 * grounded answer: the addressed agent's persona + current task, plus hits
 * from the knowledge layer (vault/reports/cards), or an honest "I don't have
 * a clear read" when nothing matches.
 *
 * Two modes:
 *   - LLM mode   (USER_LLM_API_KEY set): persona + retrieved context injected
 *                into a small reply prompt. Falls back to heuristic on error.
 *   - Heuristic  (zero-dependency): deterministic synthesis; never throws.
 *
 * Pure-ish: reads state, performs an optional LLM fetch.
 */

import { retrieve } from './knowledge.js'

const hasLLM = () => Boolean(process.env.USER_LLM_API_KEY)

export function agentPersona(state, agentName) {
  const a = (state.agents || []).find((x) => x.name === agentName)
  if (!a) return null
  return {
    name: a.name,
    role: a.role,
    summary: a.summary || '',
    capabilities: a.capabilities || [],
    task: a.task || 'Standing by'
  }
}

const SELF_INTENT = /who are you|what are you|what can you do|your role|what do you do|capabilit|working on|current task|what is your task|your status|self/i

function heuristicReply(goal, persona, hits, steps) {
  const g = String(goal || '').toLowerCase()
  const selfIntent = SELF_INTENT.test(g)
  // generic fallback plan has a leading "Triage:" step (planner.js catch-all)
  const triaged = steps.some((s) => /^Triage/i.test(s.title))
  const ambiguous = !hits.length && triaged

  if (selfIntent && persona) {
    const bits = []
    if (persona.summary) bits.push(persona.summary)
    if (persona.task && persona.task !== 'Standing by') bits.push(`Right now I'm ${persona.task.toLowerCase()}.`)
    if (persona.capabilities.length) bits.push(`On the tool side I can handle ${persona.capabilities.slice(0, 4).join(', ')}.`)
    const body = bits.length ? ` ${bits.join(' ')}` : ''
    return `I'm ${persona.name}, ${persona.role.toLowerCase()}.${body}`
  }

  if (ambiguous) {
    const name = persona ? persona.name : 'ORCHESTRATOR'
    return `I'm not sure — that goal doesn't map to anything I have visibility into right now. Could you clarify what you're after?`
  }

  const parts = []
  if (hits.length) {
    parts.push(`Pulling from what I know: ${hits.slice(0, 2).map((h) => `"${h.title}"`).join(' and ')}.`)
  }
  if (steps.length) {
    parts.push(`Plan I'd run: ${steps.map((s) => `${s.agent} → ${s.title}`).join('; ')}.`)
  }
  if (!parts.length) {
    parts.push(`I can take that on — give me a moment to line up the steps.`)
  }
  return parts.join(' ')
}

async function llmReply(goal, persona, hits, steps) {
  const url = process.env.USER_LLM_BASE_URL || 'https://api.deepseek.com/v1'
  const model = process.env.USER_LLM_MODEL || 'deepseek-chat'
  const personaBlock = persona
    ? `You are ${persona.name}, ${persona.role}. ${persona.summary} Your current task: ${persona.task}.`
    : 'You are a fleet agent on the STELLARIS-7 mission. Reply as yourself.'
  const hitsBlock = hits.length
    ? hits.map((h) => `- ${h.title} (${h.kind})`).join('\n')
    : '(no relevant knowledge found)'
  const stepsBlock = steps.length
    ? steps.map((s) => `- ${s.title} [${s.agent}]`).join('\n')
    : '(none)'
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
          content: `${personaBlock}\nAnswer the operator conversationally, in character, using the retrieved knowledge. If the goal is unclear or outside your capability, say so honestly and ask one clarifying question. Keep it to 2-3 sentences.`
        },
        {
          role: 'user',
          content: `Operator: ${goal}\n\nPlanned steps:\n${stepsBlock}\n\nRelevant knowledge:\n${hitsBlock}\n\nReply as ${persona ? persona.name : 'an agent'}.`
        }
      ],
      temperature: 0.6,
      max_tokens: 300
    })
  })
  if (!res.ok) throw new Error(`reply LLM ${res.status}`)
  const json = await res.json()
  return (json?.choices?.[0]?.message?.content || '').trim()
}

/**
 * synthesizeReply({ goal, agent, steps, state }) → reply string.
 * Never throws: LLM failures fall back to the heuristic builder.
 */
export async function synthesizeReply({ goal, agent, steps = [], state }) {
  const persona = agentPersona(state, agent)
  const hits = retrieve(state, goal, { limit: 3 })
  if (hasLLM()) {
    try {
      const text = await llmReply(goal, persona, hits, steps)
      if (text) return text
    } catch (err) {
      console.warn('[replies] LLM failed, using heuristic:', err.message)
    }
  }
  return heuristicReply(goal, persona, hits, steps)
}
