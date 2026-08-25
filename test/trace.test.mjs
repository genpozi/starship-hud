/**
 * TRACE SUITE // P12 span-tree + token accounting.
 */

import { beginTrace, childSpan, endSpan, flattenTrace } from '../server/trace.js'

const results = []
const pass = (name, cond) => results.push(`${cond ? 'PASS' : 'FAIL'} ${name}`)

const trace = beginTrace('run', { goal: 'x' })
const s1 = childSpan(trace, 'tool:CODA:coder', { step: 'write tests' })
endSpan(s1, { ok: true, ms: 12, tokenOut: 4 })
const s2 = childSpan(trace, 'tool:SAGE:search', { step: 'research' })
endSpan(s2, { ok: false, ms: 8, tokenOut: 2 })
endSpan(trace, { ok: true })

const flat = flattenTrace(trace)
pass('trace flattens to parent + children', flat.length === 3)
pass('span records ms', flat[1].ms === 12 && flat[2].ms === 8)
pass('span records tokens', flat[1].tokenOut === 4 && flat[2].tokenOut === 2)
pass('failed span flagged', flat[2].ok === false)
pass('parent pointers set', flat[1].parent === trace.id && flat[2].parent === trace.id)
endSpan(trace, { ok: false })
pass('endSpan is idempotent', trace.endedAt === trace.endedAt)
pass('trace ends with ok flag', flat[0].ok === true)

console.log(results.join('\n'))
const fails = results.filter((r) => r.startsWith('FAIL'))
console.log(fails.length ? `\n${fails.length} FAILURES` : '\nALL PASS')
process.exit(fails.length ? 1 : 0)
