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
 *   GET  /api/sessions
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
    source_tag: 'mock'
  }))
  res.json({ sessions: list })
})

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
  const sendTokens = setInterval(() => {
    if (tick >= 5) {
      clearInterval(sendTokens)
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
