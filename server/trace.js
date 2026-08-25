/**
 * TRACE // Minimal span tree with token accounting (P12).
 * Mirrors the openai-agents / langgraph span model: a run owns a trace,
 * spans nest under it, and each span records its own token delta + ms.
 * Bounded and dependency-free; the orchestrator flushes completed spans
 * into the `s.trace` slice after each run/tool call.
 */

let seq = 0
const nextId = () => `span_${Date.now()}_${++seq}`

export function beginTrace(name, meta = {}) {
  return {
    id: nextId(),
    name,
    type: 'trace',
    ts: Date.now(),
    startedAt: Date.now(),
    parent: null,
    children: [],
    meta,
    tokenIn: 0,
    tokenOut: 0,
    ok: true,
    endedAt: null
  }
}

export function childSpan(parent, name, meta = {}) {
  const span = {
    id: nextId(),
    name,
    type: 'span',
    ts: Date.now(),
    startedAt: Date.now(),
    parent: parent ? parent.id : null,
    children: [],
    meta,
    tokenIn: 0,
    tokenOut: 0,
    ok: true,
    endedAt: null
  }
  if (parent) parent.children.push(span)
  return span
}

/** Close a span; `payload.tokenOut`/`tokenIn` optionally record usage. */
export function endSpan(span, payload = {}) {
  if (!span || span.endedAt) return span
  span.endedAt = Date.now()
  span.ms = payload.ms ?? span.endedAt - span.startedAt
  span.tokenIn = payload.tokenIn ?? span.tokenIn
  span.tokenOut = payload.tokenOut ?? span.tokenOut
  span.ok = payload.ok ?? span.ok
  if (payload.result !== undefined) span.result = String(payload.result).slice(0, 120)
  return span
}

/** Collapse a trace tree into a flat, frontend-friendly list. */
export function flattenTrace(span) {
  const out = []
  const walk = (s, depth) => {
    if (!s) return
    out.push({
      id: s.id,
      name: s.name,
      type: s.type,
      depth,
      parent: s.parent,
      ms: s.ms,
      tokenIn: s.tokenIn,
      tokenOut: s.tokenOut,
      ok: s.ok,
      ts: s.ts
    })
    ;(s.children || []).forEach((c) => walk(c, depth + 1))
  }
  walk(span, 0)
  return out
}
