import express from 'express'
import { createServer } from 'node:http'
import { WebSocketServer } from 'ws'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Orchestrator } from './orchestrator.js'
import { validateSkills } from './skills.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PORT = process.env.PORT || 3001

const app = express()
const server = createServer(app)
const wss = new WebSocketServer({ server, path: '/ws' })

const orchestrator = new Orchestrator({
  onBroadcast: (msg) => {
    const frame = JSON.stringify(msg)
    wss.clients.forEach((c) => {
      if (c.readyState === 1) c.send(frame)
    })
  }
})

// Validate the tool registry once at startup; a broken registry is fatal.
validateSkills()

app.use(express.json())

// --- static: serve built frontend if present, else just the API ---
const dist = join(__dirname, '..', 'dist')
app.use(express.static(dist))

// --- realtime state ---
app.get('/api/state', (_req, res) => res.json(orchestrator.s))

app.get('/api/health', (_req, res) =>
  res.json({ ok: true, agents: orchestrator.s.agents.length, uptime: process.uptime() })
)

// --- mutations ---
app.post('/api/chat', async (req, res) => {
  const { text } = req.body || {}
  if (!text || typeof text !== 'string') return res.status(400).json({ ok: false })
  try {
    const result = await orchestrator.handleChat(text)
    res.json(result)
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message })
  }
})

app.post('/api/dispatch', (req, res) => {
  const { task, agent } = req.body || {}
  if (!task || !agent) return res.status(400).json({ ok: false })
  orchestrator.dispatchTask(task, agent)
  res.json({ ok: true })
})

app.post('/api/kanban/:id/advance', (req, res) => {
  res.json(orchestrator.advanceKanban(req.params.id))
})

app.post('/api/alerts/:id/ack', (req, res) => {
  res.json(orchestrator.ackAlert(req.params.id))
})

app.post('/api/approval/respond', (req, res) => {
  const { choice } = req.body || {}
  if (!['approve', 'deny'].includes(choice)) return res.status(400).json({ ok: false, error: 'choice must be approve|deny' })
  res.json(orchestrator.respondApproval(choice))
})

app.post('/api/email/:idx/read', (req, res) => {
  res.json(orchestrator.readEmail(Number(req.params.idx)))
})

app.post('/api/calendar/:day', (req, res) => {
  orchestrator.setCalDay(Number(req.params.day))
  res.json({ ok: true })
})

app.post('/api/mission', (req, res) => {
  const { name, agents } = req.body || {}
  if (!name || !Array.isArray(agents) || agents.length === 0) {
    return res.status(400).json({ ok: false })
  }
  res.json(orchestrator.createMission({ name, agents }))
})

// fallback for SPA / non-API routes
app.get(/^\/(?!api).*/, (_req, res) => {
  res.sendFile(join(dist, 'index.html'))
})

// ============================================================================
// REALTIME WS — snapshot on connect, deltas after, ping/pong heartbeat.
// ============================================================================
wss.on('connection', (ws) => {
  ws.missedPongs = 0
  // authoritative full snapshot on connect (implicit resync on reconnect)
  orchestrator.snapshot(ws)

  ws.on('message', (raw) => {
    let msg
    try {
      msg = JSON.parse(raw)
    } catch {
      return
    }
    if (!msg || typeof msg !== 'object') return
    if (msg.type === 'pong') {
      ws.missedPongs = 0
    } else if (msg.type === 'ping') {
      // echo pong so a client-side liveness probe gets a reply
      ws.send(JSON.stringify({ type: 'pong' }))
    } else if (msg.type === 'resync') {
      // client detected a seq gap — re-send the current snapshot
      orchestrator.snapshot(ws)
    }
  })
})

// heartbeat: app-level {type:'ping'} every 15s per client; terminate clients
// that miss 3 consecutive pongs (half-open detection).
const heartbeat = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.readyState !== 1) return
    ws.missedPongs = (ws.missedPongs || 0) + 1
    if (ws.missedPongs > 3) {
      ws.terminate()
      return
    }
    ws.send(JSON.stringify({ type: 'ping' }))
  })
}, 15000)

// ============================================================================
// OPTIONAL GITHUB DATA SOURCE — self-guards on missing token; the server must
// never crash if the module is missing or broken.
// ============================================================================
async function bootstrapGithub() {
  try {
    const github = await import('./github.js')
    if (github && typeof github.startGithubSync === 'function') {
      github.startGithubSync({ orchestrator })
    }
  } catch (err) {
    console.warn('[orbit] github sync unavailable:', err.message)
  }
}

// ============================================================================
// OPTIONAL HERMES DATA SOURCE — bridge to a running Hermes WebUI
// (http://127.0.0.1:8787 by default). Self-guards on missing config.
// ============================================================================
async function bootstrapHermes() {
  try {
    const hermes = await import('./hermes.js')
    if (hermes && typeof hermes.startHermesSync === 'function') {
      hermes.startHermesSync({ orchestrator })
    }
  } catch (err) {
    console.warn('[orbit] hermes link unavailable:', err.message)
  }
}

orchestrator.start()
bootstrapGithub()
bootstrapHermes()

server.listen(PORT, () => {
  console.log(`STELLARIS-7 orbit server :: http://localhost:${PORT}`)
})

process.on('SIGTERM', () => {
  clearInterval(heartbeat)
  orchestrator.stop()
  wss.clients.forEach((c) => c.terminate())
  server.close(() => process.exit(0))
})
