/**
 * HERMES CLIENT // HTTP + SSE bridge to a running Hermes WebUI
 * (nesquena/hermes-webui, default http://127.0.0.1:8787).
 *
 * Dependency-free (native fetch). Operator-supplied config only:
 *   USER_HERMES_URL        default http://127.0.0.1:8787
 *   USER_HERMES_PASSWORD   optional plaintext password for /api/auth/login
 *   USER_HERMES_MODEL      optional model override (provider default when unset)
 *   USER_HERMES_POLL_MS    health/sessions poll interval (default 180000)
 *
 * The client lazily reuses one WebUI session across syncChat/streamChat calls
 * (Hermes sessions are cheap and carry long-running memory). A status poller
 * flips orchestrator.s.meta.dataSource between "seed" and "hermes" so the HUD
 * banner reflects the live source. Mirrors server/github.js conventions.
 */

const DEFAULT_URL = 'http://127.0.0.1:8787'
const COOKIE_TTL_MS = 25 * 24 * 3600 * 1000
const FETCH_TIMEOUT_MS = 15000

/* ============================================================================
   CONFIG
   ============================================================================ */
export function getConfig() {
  const url = (process.env.USER_HERMES_URL || DEFAULT_URL).replace(/\/+$/, '')
  const password = process.env.USER_HERMES_PASSWORD || ''
  const model = process.env.USER_HERMES_MODEL || ''
  const pollMs = Number(process.env.USER_HERMES_POLL_MS) > 0 ? Number(process.env.USER_HERMES_POLL_MS) : 180000
  return { enabled: Boolean(url), url, password, model, pollMs }
}

/* ============================================================================
   CLIENT
   ============================================================================ */
export function createHermesClient(cfg = getConfig()) {
  const cookie = { value: null, expires: 0 }

  async function authCookie() {
    if (!cfg.password) return null
    if (cookie.value && Date.now() < cookie.expires) return cookie.value
    const res = await fetch(`${cfg.url}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: cfg.password }),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
    })
    if (!res.ok) return null
    const raw = res.headers.get('set-cookie') || ''
    const part = raw.split(';')[0]
    if (part) {
      cookie.value = part
      cookie.expires = Date.now() + COOKIE_TTL_MS
      return part
    }
    return null
  }

  async function request(path, opts = {}) {
    const headers = { ...(opts.headers || {}) }
    if (opts.json !== undefined) headers['Content-Type'] = 'application/json'
    const c = await authCookie()
    if (c) headers.Cookie = c
    const res = await fetch(`${cfg.url}${path}`, {
      ...opts,
      headers,
      body: opts.json !== undefined ? JSON.stringify(opts.json) : opts.body,
      signal: opts.signal || AbortSignal.timeout(FETCH_TIMEOUT_MS)
    })
    if (!res.ok) {
      let msg = `HTTP ${res.status}`
      try {
        const body = await res.json()
        if (body.error) msg = body.error
      } catch {}
      throw new Error(msg)
    }
    return res
  }

  let sessionId = null

  async function ensureSession() {
    if (sessionId) return sessionId
    const res = await request('/api/session/new', { method: 'POST', json: {} })
    const body = await res.json()
    sessionId = body.session?.session_id || null
    if (!sessionId) throw new Error('hermes: no session_id returned')
    return sessionId
  }

  return {
    get config() {
      return cfg
    },

    isEnabled() {
      return cfg.enabled
    },

    async health() {
      try {
        const res = await request('/health')
        const body = await res.json()
        return { ok: Boolean(body && body.ok), ...body }
      } catch (err) {
        return { ok: false, error: err.message }
      }
    },

    async listSessions() {
      const res = await request('/api/sessions')
      const body = await res.json()
      return Array.isArray(body) ? body : body.sessions || []
    },

    /** Blocking chat: POST /api/chat against one reused session. */
    async syncChat(prompt) {
      const sid = await ensureSession()
      const res = await request('/api/chat', {
        method: 'POST',
        json: { session_id: sid, message: prompt, model: cfg.model || undefined }
      })
      const body = await res.json()
      return {
        session_id: sid,
        final_response: body.final_response || '',
        completed: Boolean(body.completed),
        tokens: body.tokens || 0,
        messages: body.messages || []
      }
    },

    /**
     * Streaming chat: POST /api/chat/start then consume the SSE stream.
     * Resolves with the final session on 'done'; rejects on 'error'.
     */
    async streamChat(prompt, { onToken, onTool, onApproval } = {}) {
      const sid = await ensureSession()
      const start = await request('/api/chat/start', {
        method: 'POST',
        json: { session_id: sid, message: prompt, model: cfg.model || undefined }
      })
      const { stream_id: streamId } = await start.json()
      if (!streamId) throw new Error('hermes: no stream_id returned')

      const res = await request(`/api/chat/stream?id=${encodeURIComponent(streamId)}`)
      if (!res.body || typeof res.body.getReader !== 'function') {
        throw new Error('hermes: stream response has no body')
      }
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let last = null

      const dispatch = (event, data) => {
        if (event === 'token') {
          if (onToken) onToken(data.text || '')
        } else if (event === 'tool') {
          if (onTool) onTool(data)
        } else if (event === 'approval') {
          if (onApproval) onApproval(data)
        } else if (event === 'done') {
          last = data
        }
      }

      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        let idx
        while ((idx = buffer.indexOf('\n\n')) >= 0) {
          const block = buffer.slice(0, idx).trim()
          buffer = buffer.slice(idx + 2)
          if (!block) continue
          let event = 'message'
          const dataLines = []
          for (const line of block.split('\n')) {
            if (line.startsWith('event:')) event = line.slice(6).trim()
            else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim())
            else if (line.startsWith(':') || line.startsWith('#')) continue
          }
          if (!dataLines.length) continue
          try {
            dispatch(event, JSON.parse(dataLines.join('\n')))
          } catch {
            /* ignore malformed SSE payloads */
          }
        }
      }

      if (!last) throw new Error('hermes: stream ended without done event')
      return {
        session_id: sid,
        final_response: last.session?.messages?.slice(-1)[0]?.content || '',
        completed: true,
        session: last.session
      }
    },

    async approvalPending() {
      try {
        const res = await request('/api/approval/pending')
        const body = await res.json()
        return body.pending || null
      } catch {
        return null
      }
    },

    async approvalRespond(choice = 'always') {
      const res = await request('/api/approval/respond', { method: 'POST', json: { choice } })
      return res.json()
    }
  }
}

/* ============================================================================
   BOOTSTRAP — attach client to orchestrator + status poller
   ============================================================================ */
let syncTimer = null
let lastStatus = null

export function startHermesSync({ orchestrator }) {
  const cfg = getConfig()
  if (!cfg.enabled) return { started: false, reason: 'USER_HERMES_URL not set' }

  const client = createHermesClient(cfg)
  orchestrator.hermes = client // skills read ctx.hermes
  orchestrator.s.meta.dataSource = orchestrator.s.meta.dataSource || 'seed'

  const tick = async () => {
    const health = await client.health()
    const ok = health.ok
    const status = ok ? 'online' : 'offline'
    if (status !== lastStatus) {
      lastStatus = status
      const old = orchestrator.s.meta.dataSource
      orchestrator.s.meta.dataSource = ok ? 'hermes' : old === 'hermes' ? 'seed' : old
      orchestrator.log('INFO', `hermes link ${status}`)
      orchestrator.pushChat('LINK', ok ? 'Hermes uplink established — delegation live.' : 'Hermes unreachable — fallback to simulated skills.')
      orchestrator.s.meta.hermes = { status, url: cfg.url, model: cfg.model || 'provider-default', checkedAt: Date.now() }
      orchestrator.store.markDirty()
    }
  }

  tick()
  if (syncTimer) clearInterval(syncTimer)
  syncTimer = setInterval(tick, cfg.pollMs)
  return { started: true }
}

export function stopHermesSync() {
  if (syncTimer) clearInterval(syncTimer)
  syncTimer = null
}
