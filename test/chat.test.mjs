/**
 * CHAT DIAGNOSIS SUITE (Phase 0) — quantifies what the agent chat pipeline
 * CANNOT do today, so later phases (identity model, reply synthesis, mention
 * routing) prove a regression by flipping these FAILs to PASS.
 *
 * Scenarios drive the real Orchestrator end-to-end:
 *   handleChat(prompt) → plan → dispatch → tickAgents() → skills → chat
 * and assert the four behaviors an operator expects:
 *   MENTION  — the agent named in the prompt is the one dispatched + replies
 *   ANSWER   — a non-canned reply actually addresses the question
 *   GROUNDED — the reply references retrieved knowledge (vault/docs)
 *   AWARE    — the reply reflects the agent's own role/capabilities
 *
 * Run standalone:  node test/chat.test.mjs
 * (Not yet wired into run-all.mjs — that happens in Phase 5 once green.)
 */
import { existsSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'
import { Orchestrator } from '../server/orchestrator.js'

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..')
const STATE_FILE = process.env.STELLARIS_DATA_DIR
  ? join(process.env.STELLARIS_DATA_DIR, 'state.json')
  : join(REPO, 'data', 'state.json')
const STATE_BACKUP = join(tmpdir(), 'chat-test.state.json')
if (existsSync(STATE_FILE)) renameSync(STATE_FILE, STATE_BACKUP)

const results = []
const pass = (name, cond) => results.push(`${cond ? 'PASS' : 'FAIL'} ${name}`)

function freshOrchestrator() {
  const o = new Orchestrator({ onBroadcast: () => {} })
  o.start()
  o.stop() // no real timers; we drive ticks manually
  return o
}

function drive(o, ticks = 60) {
  for (let i = 0; i < ticks; i++) o.tickAgents()
}

const ANSWER_JUNK = ['Task complete:', 'Plan generated', 'Mission complete', 'job failed']

/** Any agent reply (not USER, not a canned status line) in the transcript. */
function agentReplies(o) {
  return o.s.chat.filter(
    (m) => m.from !== 'USER' && !ANSWER_JUNK.some((j) => m.text.includes(j))
  )
}

async function scenario(name, prompt, expectAgent) {
  const o = freshOrchestrator()
  const before = o.s.chat.length
  const t0 = Date.now()
  await o.handleChat(prompt)
  // dispatch rows created by THIS prompt carry wfId; seed jobs do not
  const promptDispatch = o.s.dispatch.filter((d) => d.wfId)
  const promptAgents = [...new Set(promptDispatch.map((d) => d.agent))]
  drive(o)

  // replies that arrived after this prompt and are not USER messages
  const replies = agentReplies(o).filter((r) => r.ts >= t0)
  const agentReply = replies.find((r) => r.from === expectAgent) || replies[0]

  if (expectAgent) {
    pass(`${name}: ${expectAgent} dispatched by prompt (MENTION)`, promptAgents.includes(expectAgent))
    pass(`${name}: reply from ${expectAgent} (MENTION)`, replies.some((r) => r.from === expectAgent))
  } else {
    pass(`${name}: any agent reply present (ANSWER)`, replies.length > 0)
  }
  return { o, replies, agentReply, promptAgents }
}

// --- S1: direct mention must route to that agent ----------------------------
// "do a thing" has no keyword → today the planner ignores CODA entirely.
const s1 = await scenario('S1 @CODA non-keyword', '@CODA tell me what you are working on', 'CODA')

// --- S2: a direct question must be answered, not just dispatched ------------
const s2 = await scenario('S2 question answered', 'what is in the release checklist v1.4.x?', 'PILOT')
pass(
  'S2: an agent reply exists beyond canned status (ANSWER)',
  s2.replies.some((r) => !/Task complete|Plan generated/.test(r.text))
)

// --- S3: the reply must be grounded in retrieved knowledge -------------------
const s3 = await scenario('S3 knowledge grounding', 'summarize the context compaction research', 'SAGE')
pass(
  'S3: reply references knowledge content (GROUNDED)',
  s3.replies.some((r) => /compaction|context|research|vault|digest/i.test(r.text))
)

// --- S4: the agent must know its own role/capabilities -----------------------
const s4 = await scenario('S4 self-awareness', 'CODA, who are you and what can you do?', 'CODA')
pass(
  'S4: reply reflects the agent role (AWARE)',
  s4.replies.some((r) => /engineer|coda|software|code/i.test(r.text))
)

// --- S5: ambiguity must be acknowledged, not silently triaged -----------------
const s5 = await scenario('S5 ambiguity acknowledged', 'do a thing that matches nothing at all', null)
pass(
  'S5: agent admits uncertainty instead of silently triaging (AWARE)',
  s5.replies.some((r) => /unclear|ambiguous|need more|what exactly|clarif/i.test(r.text))
)

console.log(results.join('\n'))
const fails = results.filter((r) => r.startsWith('FAIL'))
console.log(fails.length ? `\n${fails.length} FAILURES — the gaps Phase 1-3 must close` : '\nALL PASS')

// restore persisted state (this suite never writes it; handleChat only marks dirty)
if (existsSync(STATE_BACKUP)) renameSync(STATE_BACKUP, STATE_FILE)
process.exit(fails.length ? 1 : 0)
