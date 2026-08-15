/**
 * KNOWLEDGE // Read-only retrieval layer over canonical state.
 *
 * The HUD's canonical state is already a knowledge graph of sorts: the vault
 * documents, research reports, kanban cards, items, schedules and probes each
 * carry titles/tags that answer operator questions. This module indexes those
 * slices on demand (no persisted index) and returns ranked hits so agent
 * replies can be grounded in real data instead of canned strings.
 *
 * Pure function of state — no side effects, safe to call from skills,
 * the planner and the orchestrator's reply synthesizer.
 */

const SLICES = ['vault', 'reports', 'items', 'cards', 'schedules', 'probes']

/**
 * Tokenize a query/body into normalized terms (skips <3-char stop noise).
 */
function tokens(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s+]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 3)
}

const STOP = new Set(['the', 'and', 'for', 'what', 'with', 'from', 'that', 'this', 'into'])

function significant(text) {
  return tokens(text).filter((t) => !STOP.has(t))
}

/** Collect [title, body, kind, id] records from the canonical state. */
export function indexState(state) {
  const docs = []
  const add = (title, body, kind, id) => {
    if (!title) return
    docs.push({ title: String(title), body: String(body || title), kind, id })
  }
  ;(state.vault || []).forEach((d) => add(d.title, `${d.title} ${(d.tags || []).join(' ')} ${d.type || ''}`, 'vault', d.id))
  ;(state.reports || []).forEach((r) => add(r.title, `${r.title} ${(r.status || '').toUpperCase()}`, 'report', r.id))
  ;(state.items || []).forEach((i) => add(i.label || i.id, `${i.label || i.id} ${i.type || ''} ${i.status || ''}`, 'item', i.id))
  ;(state.kanban && state.kanban.cards || []).forEach((c) => add(c.title, `${c.title} ${(c.tags || []).join(' ')} ${c.agent || ''}`, 'card', c.id))
  ;(state.schedules || []).forEach((s) => add(s.title || s.name, `${s.title || s.name} ${s.cron || ''} ${s.status || ''}`, 'schedule', s.id))
  ;(state.probes || []).forEach((p) => add(p.name, `${p.name} ${p.value || ''}${p.unit || ''} ${(p.desc || '').slice(0, 80)}`, 'probe', p.id))
  return docs
}

/**
 * retrieve(state, query, {limit}) → ranked hits [{title, body, kind, id, score}].
 * Scores title+body term overlap (title weighted 3x). Deterministic tie-break
 * (source order) so tests are stable.
 */
export function retrieve(state, query, { limit = 5 } = {}) {
  const terms = significant(query)
  if (!terms.length) return []
  const docs = indexState(state)
  const scored = docs.map((d) => {
    const title = significant(d.title)
    const body = significant(d.body)
    let score = 0
    for (const t of terms) {
      if (title.includes(t)) score += 3
      if (body.includes(t)) score += 1
    }
    return { ...d, score }
  })
  scored.sort((a, b) => b.score - a.score)
  return scored.filter((d) => d.score > 0).slice(0, limit)
}

/**
 * describe(state) → a compact digest of the fleet's current knowledge that a
 * reply can reference: active docs, reports, and high-signal items.
 */
export function digest(state, { limit = 4 } = {}) {
  const lines = []
  ;(state.vault || []).slice(0, limit).forEach((d) => lines.push(`DOC: ${d.title}`))
  ;(state.reports || []).slice(0, limit).forEach((r) => lines.push(`REPORT: ${r.title}`))
  ;(state.kanban && state.kanban.cards || []).slice(0, limit).forEach((c) => lines.push(`CARD: ${c.title}`))
  return lines
}

export const KNOWLEDGE_SLICES = SLICES
