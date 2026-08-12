/**
 * MOCK HERMES WEBUI // Standalone test double for nesquena/hermes-webui.
 *
 * Implements the subset of the Hermes WebUI HTTP + SSE surface that
 * `server/hermes.js` consumes, so integration can be verified headlessly
 * without installing Hermes Agent. Launch: `node server/mock-hermes.js`
 * (default port 8787; override with PORT).
 *
 * Endpoints:
 *   GET  /health
 *   GET  /api/sessions          -> pre-seeded list + session summaries
 *   GET  /api/crons             -> stable cron job list
 *   POST /api/session/new
 *   POST /api/chat/start        -> {stream_id}
 *   GET  /api/chat/stream?id=X  -> SSE: token* / tool / done
 *   POST /api/chat              -> blocking full response
 *   GET  /api/approval/pending
 *   POST /api/approval/respond
 *   POST /api/auth/login        -> Set-Cookie (only when MOCK_PASSWORD set)
 */

import express from 'express'
import { randomUUID } from 'node:crypto'

const PORT = Number(process.env.PORT) || 8787
const PASSWORD = process.env.MOCK_PASSWORD || ''
const app = express()

const sessions = new Map()
let counter = 0
let pendingApproval = null

const RESPONSES = [
  'Analysis complete. I traced the ingress latency regression to an oversized TLS handshake batch; recommend chunked session resumption.',
  'Done. Drafted the release notes and queued the canary rollout. All gates green.'
]
const TOOLS = ['web', 'terminal', 'file']

const NOW_SEC = Math.floor(Date.now() / 1000)
const seedMessages = (count) =>
  Array.from({ length: count }, (_, i) => ({
    role: i % 2 ? 'assistant' : 'user',
    content: 'mock message'
  }))

const SEED_SESSIONS = [
  {
    session_id: 'sess-0001',
    title: 'Ingress latency deep-dive',
    workspace: '/workspace/observability',
    model: 'hermes/claude-sonnet-4',
    messages: seedMessages(14),
    created_at: NOW_SEC - 86400 * 2,
    updated_at: NOW_SEC - 600,
    pinned: false,
    archived: false,
    project_id: null,
    tool_calls: []
  },
  {
    session_id: 'sess-0002',
    title: 'Canary v1.4.2 rollout notes',
    workspace: '/workspace/release',
    model: 'hermes/gpt-4o',
    messages: seedMessages(6),
    created_at: NOW_SEC - 86400 * 5,
    updated_at: NOW_SEC - 28800,
    pinned: false,
    archived: false,
    project_id: null,
    tool_calls: []
  },
  {
    session_id: 'sess-0003',
    title: 'Vector-store ingest design',
    workspace: '/workspace/knowledge',
    model: 'hermes/deepseek-r1',
    messages: seedMessages(3),
    created_at: NOW_SEC - 86400,
    updated_at: NOW_SEC - 1800,
    pinned: true,
    archived: false,
    project_id: null,
    tool_calls: []
  },
  {
    session_id: 'sess-0004',
    title: 'Context compaction research',
    workspace: '/workspace/labs',
    model: 'hermes/qwen3-235b',
    messages: [{ role: 'user', content: 'mock message' }],
    created_at: NOW_SEC - 86400 * 12,
    updated_at: NOW_SEC - 86400 * 3,
    pinned: false,
    archived: true,
    project_id: null,
    tool_calls: []
  }
]

for (const s of SEED_SESSIONS) sessions.set(s.session_id, s)

const CRONS = [
  {
    id: 'cr-1',
    name: 'Daily telemetry digest',
    cron: '0 9 * * *',
    enabled: true,
    last_run: '2026-08-12T09:00:00Z',
    next_run: '2026-08-13T09:00:00Z',
    status: 'ok',
    history: [
      { at: '2026-08-12T09:00:00Z', status: 'ok' },
      { at: '2026-08-11T09:00:00Z', status: 'ok' }
    ]
  },
  {
    id: 'cr-2',
    name: 'Webhook drain / replay sweep',
    cron: '*/15 * * * *',
    enabled: true,
    last_run: '2026-08-12T14:30:00Z',
    next_run: '2026-08-12T14:45:00Z',
    status: 'warn',
    history: [{ at: '2026-08-12T14:30:00Z', status: 'warn' }]
  },
  {
    id: 'cr-3',
    name: 'Dependency graph rebuild',
    cron: '0 * * * *',
    enabled: true,
    last_run: '2026-08-12T12:00:00Z',
    next_run: '2026-08-12T13:00:00Z',
    status: 'failed',
    history: [
      { at: '2026-08-12T12:00:00Z', status: 'failed', error: 'exit status 1: connection reset by peer' },
      { at: '2026-08-12T11:00:00Z', status: 'ok' }
    ]
  }
]

function makeSession() {
  const id = randomUUID()
  return {
    session_id: String(id).slice(0, 12),
    title: 'Mock hermes session',
    workspace: '/tmp/opencode/mock-workspace',
    model: 'mock/hermes-1',
    messages: [],
    created_at: Date.now() / 1000,
    updated_at: Date.now() / 1000,
    pinned: false,
    archived: false,
    project_id: null,
    tool_calls: []
  }
}

app.use(express.json())

app.get('/health', (_req, res) =>
  res.json({ ok: true, active_streams: counter, uptime_seconds: Math.floor(process.uptime()) })
)

app.get('/api/sessions', (_req, res) => {
  const list = [...sessions.values()].map((s) => ({
    session_id: s.session_id,
    title: s.title,
    workspace: s.workspace,
    model: s.model,
    message_count: s.messages.length,
    source_tag: 'mock',
    pinned: s.pinned,
    archived: s.archived,
    updated_at: s.updated_at,
    created_at: s.created_at
  }))
  res.json({ sessions: list })
})

app.get('/api/crons', (_req, res) => res.json({ crons: CRONS }))

app.post('/api/session/new', (req, res) => {
  const s = makeSession()
  sessions.set(s.session_id, s)
  res.json({ session: s })
})

app.post('/api/chat/start', (req, res) => {
  const sid = (req.body && req.body.session_id) || ''
  const streamId = `mock-stream-${++counter}`
  res.json({ stream_id: streamId })
})

app.get('/api/chat/stream', (req, res) => {
  const sid = req.query.id || req.query.stream_id || ''
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')

  const emit = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
  let tick = 0
  const finish = () => {
    emit('tool', { name: TOOLS[counter % TOOLS.length], preview: 'Running a tool call' })
    setTimeout(() => {
      emit('done', {
        session: {
          session_id: sid,
          title: 'Mock hermes session',
          workspace: '/tmp/opencode/mock-workspace',
          model: 'mock/hermes-1',
          messages: [
            { role: 'user', content: 'user message' },
            { role: 'assistant', content: RESPONSES[counter % RESPONSES.length] }
          ]
        }
      })
      res.end()
    }, 30)
  }
  const sendTokens = setInterval(() => {
    if (tick >= 5) {
      clearInterval(sendTokens)
      const needsApproval = counter % 2 === 1
      if (needsApproval) {
        pendingApproval = {
          id: `ap-${counter}`,
          tool: TOOLS[counter % TOOLS.length],
          summary: 'Allow executing this command?',
          detail: 'git push origin master — operator approval required for privileged action'
        }
        emit('approval', pendingApproval)
        // hold the stream until /api/approval/respond clears the pending request
        const wait = setInterval(() => {
          if (!pendingApproval) {
            clearInterval(wait)
            finish()
          }
        }, 100)
        req.on('close', () => clearInterval(wait))
        return
      }
      finish()
      return
    }
    tick += 1
    emit('token', { text: `mock-token-${tick} ` })
  }, 25)

  req.on('close', () => clearInterval(sendTokens))
})

app.post('/api/chat', (req, res) => {
  const text = (req.body && req.body.message) || ''
  res.json({
    ok: true,
    messages: [
      { role: 'user', content: text },
      { role: 'assistant', content: RESPONSES[counter % RESPONSES.length] }
    ],
    final_response: RESPONSES[counter % RESPONSES.length],
    completed: true,
    tokens: 42
  })
})

app.get('/api/approval/pending', (_req, res) => res.json({ pending: pendingApproval }))
app.post('/api/approval/respond', (req, res) => {
  pendingApproval = null
  res.json({ ok: true, choice: (req.body && req.body.choice) || 'always' })
})

app.post('/api/auth/login', (req, res) => {
  if (!PASSWORD) return res.status(401).json({ error: 'no password configured' })
  if ((req.body && req.body.password) !== PASSWORD) return res.status(401).json({ error: 'bad password' })
  res.setHeader('Set-Cookie', 'mock_session=abc123; Path=/; HttpOnly; Max-Age=2592000')
  res.json({ ok: true })
})

app.listen(PORT, () => console.log(`MOCK hermes-webui :: http://localhost:${PORT}`))
