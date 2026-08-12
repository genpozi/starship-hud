import { Store } from './store.js'
import { buildSeedState } from './seed.js'
import { plan } from './planner.js'
import { runSkill } from './skills.js'
import { PROBES as DEFAULT_PROBES } from '../src/config.js'

/**
 * ORCHESTRATOR // The core engine of the harness.
 *
 * Owns the canonical state (persisted via Store), advances agents and
 * workflows on a heartbeat, evaluates the scheduler, answers chat commands,
 * and streams snapshot/delta frames to all connected HUD clients.
 *
 * REALTIME TRANSPORT
 *   Snapshot-on-connect, deltas after. A single shared monotonic `_seq` and a
 *   `_sentRef` (JSON of every top-level slice last emitted) drive the diff;
 *   clients that fall behind request a resync and get a fresh snapshot.
 *
 * AGENT RUNTIME
 *   Dispatch jobs that carry `steps: [{tool,title}]` are executed by a step
 *   machine (one step every ~2-3 ticks, progress = steps completed). Tool
 *   calls fire typed `tool:start`/`tool:finish` events; jobs complete or fail
 *   bounded by maxAttempts. Seed jobs with no steps keep the classic simulated
 *   progress advance so the HUD stays alive with no load.
 */

const TICK_MS = 1000
const AGENT_SPEED = { ORCH: 1.6, CODA: 1.3, PILOT: 1.5, SAGE: 1.1, LINK: 1.8, NUDGE: 0.4 }
const rand = (min, max) => min + Math.random() * (max - min)
const noop = () => {}
const STEP_ODDS = 0.4 // ~one step every 2.5 ticks
const DEFAULT_MAX_ATTEMPTS = 3

export class Orchestrator {
  constructor({ onBroadcast }) {
    this.store = new Store(buildSeedState)
    this.onBroadcast = onBroadcast
    this.timers = []

    // realtime protocol state
    this._seq = 0
    this._sentRef = null

    // agent runtime state (kept off the persisted state objects)
    this._agentJobs = new Map() // agentName -> { job, steps, stepIndex, retries, maxAttempts, inFlight }
    this._chatWorkflows = new Map() // workflowId -> { total, done, failed }

    // alert condition engine state (not persisted; recomputed from state)
    this._alertSeq = 0
    this._probeAlerts = new Map() // probeName -> active alert id
    this._alertMinute = Math.floor(Date.now() / 60000)

    // resume the dynamic-alert counter past any persisted dynN ids
    for (const a of this.s.alerts) {
      const m = /^dyn(\d+)$/.exec(a.id || '')
      if (m) this._alertSeq = Math.max(this._alertSeq, Number(m[1]))
    }

    // normalize persisted state: backfill probe thresholds from the canonical
    // config so older state rows pick up fields introduced later (critAt).
    this.s.probes.forEach((p) => {
      const def = DEFAULT_PROBES.find((d) => d.name === p.name)
      if (!def) return
      if (typeof p.warnAt !== 'number') p.warnAt = def.warnAt || 0
      if (typeof p.critAt !== 'number') p.critAt = def.critAt || 0
    })

    // lifecycle hooks (all no-op by default)
    this.hooks = {
      onRunStart: noop,
      onTurnStart: noop,
      onToolCall: noop,
      onToolResult: noop,
      onRunEnd: noop
    }

    this.s.meta.dataSource = this.s.meta.dataSource || 'seed'

    // approval bridge state (Hermes delegation approvals; operator responds via HUD)
    if (!this.s.approval) this.s.approval = { pending: null, history: [] }
    this.approvalTimeoutMs = Number(process.env.USER_HERMES_APPROVAL_TIMEOUT) > 0 ? Number(process.env.USER_HERMES_APPROVAL_TIMEOUT) : 120000
  }

  get s() {
    return this.store.data
  }

  // ---- infrastructure ---- //
  log(level, msg) {
    const t = new Date().toISOString().slice(11, 19)
    this.s.logs.push({ t, level, msg })
    if (this.s.logs.length > 200) this.s.logs.shift()
    this.store.markDirty()
  }

  pushChat(from, text) {
    this.s.chat.push({ from, text, ts: Date.now() })
    if (this.s.chat.length > 200) this.s.chat.shift()
    this.store.markDirty()
    this.broadcast({ type: 'chat' })
  }

  broadcast(msg) {
    if (this.onBroadcast) this.onBroadcast(msg)
  }

  /**
   * Emit a typed event frame to all clients. Events are hint-only (the delta
   * carries the authoritative state) so they never carry a seq and never
   * advance the shared seq counter.
   */
  _emit(kind, fields) {
    const frame = { type: 'event', kind, ...fields, ts: Date.now() }
    this.broadcast(frame)
    return frame
  }

  // ---- realtime transport ---- //
  _bumpSeq() {
    return ++this._seq
  }

  _refKey(key) {
    try {
      return JSON.stringify(this.s[key])
    } catch {
      return null
    }
  }

  _allKeys() {
    return Object.keys(this.s)
  }

  /**
   * Send a full authoritative snapshot to `client` (or return it). Resets the
   * shared baseline so subsequent deltas diff against this snapshot.
   *
   * NOTE: snapshots do NOT advance the global seq. Only deltas bump `_seq`, so
   * delta frames stay strictly contiguous for EVERY client regardless of how
   * many connect or resync (a client that bumps seq on resync would break the
   * other clients' contiguity and cause a resync cascade).
   */
  snapshot(client) {
    const seq = this._seq
    this._sentRef = {}
    for (const key of this._allKeys()) this._sentRef[key] = this._refKey(key)
    const frame = { type: 'snapshot', seq, state: this.s }
    if (client && typeof client.send === 'function') client.send(JSON.stringify(frame))
    return frame
  }

  /**
   * Diff the current state against `_sentRef` and broadcast only the changed
   * top-level slices as a delta frame. Skips empty frames (push on change).
   */
  broadcastDelta() {
    const updates = {}
    if (!this._sentRef) this._sentRef = {}
    for (const key of this._allKeys()) {
      const current = this._refKey(key)
      if (this._sentRef[key] !== current) {
        updates[key] = this.s[key]
        this._sentRef[key] = current
      }
    }
    if (Object.keys(updates).length === 0) return this._seq
    const seq = this._bumpSeq()
    this.broadcast({ type: 'delta', seq, updates })
    return seq
  }

  /** Re-send a full snapshot to a client that fell out of sync. */
  requestResync(client) {
    return this.snapshot(client)
  }

  // ---- lifecycle ---- //
  start() {
    this.hooks.onRunStart({ ts: Date.now() })
    this.log('INFO', 'Orchestrator online — all subsystems nominal')
    this.timers.push(setInterval(() => this.tickAgents(), TICK_MS))
    this.timers.push(setInterval(() => this.tickWorkflows(), 1400))
    this.timers.push(setInterval(() => this.tickTelemetry(), 1200))
    this.timers.push(setInterval(() => this.tickScheduler(), 2000))
    this.timers.push(setInterval(() => this.broadcastDelta(), 1500))
    this.timers.push(setInterval(() => this.ambientChat(), 9000))
    return this
  }

  stop() {
    this.timers.forEach(clearInterval)
    this.timers = []
    this._agentJobs.clear()
    this._chatWorkflows.clear()
  }

  // ---- agents ---- //
  tickAgents() {
    const { agents } = this.s
    let changed = false
    agents.forEach((a) => {
      this.hooks.onTurnStart({ agent: a.name, state: a.state })
      if (a.state === 'idle') {
        const job = this.s.dispatch.find((d) => d.state === 'waiting' && d.agent === a.name)
        if (job) {
          this._pickupJob(a, job)
          changed = true
        }
        return
      }
      const ctxObj = this._agentJobs.get(a.name)
      if (ctxObj && ctxObj.steps.length && !ctxObj.inFlight) {
        // step machine: complete one step every ~2-3 ticks
        if (Math.random() < STEP_ODDS) {
          this._advanceStep(a, ctxObj)
          changed = true
        }
        return
      }
      // no job steps (seed/manual dispatch): classic simulated progress
      const speed = AGENT_SPEED[a.id] || 1
      a.progress = Math.min(100, a.progress + rand(0.4, 1.8) * speed)
      a.tokens += rand(0.05, 0.4)
      changed = true
      if (a.progress >= 100) {
        const done = a.task
        this.log('OK', `${a.name} completed: ${done}`)
        this.pushChat(a.name, `Task complete: ${done}`)
        const job = this.s.dispatch.find((d) => d.task === done)
        if (job) job.state = 'done'
        this.hooks.onRunEnd({ agent: a.name, task: done, ok: true })
        a.state = 'idle'
        a.task = 'Standing by'
        a.progress = 0
        this.s.meta.tokenTotal += 2
      }
    })
    if (changed) this.store.markDirty()
  }

  _pickupJob(a, job) {
    job.state = 'assigned'
    a.state = 'busy'
    a.task = job.task
    a.progress = 4
    this.log('INFO', `${a.name} picked up: ${job.task}`)
    this._emit('task:start', { agent: a.name, task: job.task })
    this._agentJobs.set(a.name, {
      job,
      steps: Array.isArray(job.steps) && job.steps.length ? job.steps : [],
      stepIndex: 0,
      retries: 0,
      maxAttempts: job.maxAttempts || DEFAULT_MAX_ATTEMPTS,
      inFlight: false
    })
  }

  _agentCtx(a, job, step) {
    return {
      agent: a.name,
      s: this.s,
      log: (level, msg) => this.log(level, msg),
      pushChat: (from, text) => this.pushChat(from, text),
      broadcast: (msg) => this.broadcast(msg),
      hermes: this.hermes || null,
      approvalMode: this.approvalMode || 'prompt',
      awaitApproval: (payload) => this._awaitApproval(payload, a.name),
      task: job && job.task,
      step: step && step.title
    }
  }

  _advanceStep(a, ctxObj) {
    const { job, steps } = ctxObj
    if (ctxObj.stepIndex >= steps.length) {
      this._completeJob(a, ctxObj)
      return
    }
    const step = steps[ctxObj.stepIndex]
    const tool = step.tool || 'search'
    const t0 = Date.now()
    ctxObj.inFlight = true
    this.hooks.onToolCall({ agent: a.name, tool, step: step.title })
    this._emit('tool:start', { agent: a.name, tool, step: step.title })
    runSkill(tool, this._agentCtx(a, ctxObj.job, step))
      .then((res) => {
        const ms = Date.now() - t0
        ctxObj.inFlight = false
        const ok = !(res && res.error)
        this.hooks.onToolResult({ agent: a.name, tool, ok, ms })
        this._emit('tool:finish', { agent: a.name, tool, ok, ms })
        if (!ok) {
          ctxObj.retries += 1
          this.log('WARN', `${a.name} tool "${tool}" returned error: ${res.error}`)
          this.store.markDirty()
          if (ctxObj.retries > ctxObj.maxAttempts) {
            this._failJob(a, ctxObj)
            return
          }
          return
        }
        ctxObj.retries = 0
        ctxObj.stepIndex += 1
        a.progress = Math.round((ctxObj.stepIndex / steps.length) * 100)
        a.tokens += 0.4
        this.store.markDirty()
        if (ctxObj.stepIndex >= steps.length) this._completeJob(a, ctxObj)
      })
      .catch((err) => {
        const ms = Date.now() - t0
        ctxObj.inFlight = false
        this.hooks.onToolResult({ agent: a.name, tool, ok: false, ms })
        this._emit('tool:finish', { agent: a.name, tool, ok: false, ms })
        ctxObj.retries += 1
        this.log('WARN', `${a.name} tool "${tool}" threw: ${err.message}`)
        this.store.markDirty()
        if (ctxObj.retries > ctxObj.maxAttempts) this._failJob(a, ctxObj)
      })
  }

  _completeJob(a, ctxObj) {
    const { job, steps } = ctxObj
    a.progress = 100
    this.log('OK', `${a.name} completed: ${job.task}`)
    a.tokens += steps.length * 0.4
    this.s.meta.tokenTotal += 2
    this.pushChat(a.name, `Task complete: ${job.task}`)
    this._trackJobDone(job, true)
    this._agentJobs.delete(a.name)
    a.state = 'idle'
    a.task = 'Standing by'
    a.progress = 0
    job.state = 'done'
    this.hooks.onRunEnd({ agent: a.name, task: job.task, ok: true })
    this._emit('task:finish', { agent: a.name, task: job.task, ok: true })
  }

  _failJob(a, ctxObj) {
    const { job } = ctxObj
    this.log('WARN', `${a.name} failed job: ${job.task} (max attempts reached)`)
    this.pushChat('ORCH', `${a.name} job failed: ${job.task}`)
    this._trackJobDone(job, false)
    this._agentJobs.delete(a.name)
    a.state = 'idle'
    a.task = 'Standing by'
    a.progress = 0
    job.state = 'failed'
    this.hooks.onRunEnd({ agent: a.name, task: job.task, ok: false })
    this._emit('task:finish', { agent: a.name, task: job.task, ok: false })
  }

  _trackJobDone(job, ok) {
    if (!job || !job.wfId) return
    const track = this._chatWorkflows.get(job.wfId)
    if (!track) return
    if (ok) track.done += 1
    else track.failed += 1
  }

  /**
   * Mission completion → real vault artifacts. Archives a mission report doc
   * into `state.vault` and publishes a research report entry, both surfaced by
   * the VAULT / RESEARCH REPORTS views. Persisted via the store.
   */
  _logMission(name) {
    const ts = Date.now()
    this.s.vault.unshift({
      id: `v${ts}`,
      title: `Mission report — ${name}`,
      type: 'REPORT',
      tags: ['MISSION', 'ORCH'],
      size: '24KB',
      updated: 'just now',
      agent: 'ORCH'
    })
    if (this.s.vault.length > 30) this.s.vault.pop()
    this.s.reports.unshift({
      id: `r${ts}`,
      title: `${name} — run summary`,
      author: 'ORCH',
      status: 'draft',
      tags: ['ORCH', 'MISSION'],
      updated: 'just now',
      abstract: `Auto-generated on mission completion. ${Math.round(this.s.meta.tokenTotal)} fleet tokens logged to the core bank.`
    })
    if (this.s.reports.length > 12) this.s.reports.pop()
    this.log('OK', `vault: mission report archived — ${name}`)
  }

  // ---- workflows / missions ---- //
  tickWorkflows() {
    const { workflows } = this.s
    let changed = false
    workflows.forEach((w) => {
      // chat-created workflows derive progress from completed jobs
      if (this._chatWorkflows.has(w.id)) {
        const track = this._chatWorkflows.get(w.id)
        const total = track.total || 1
        const done = Math.min(total, track.done + track.failed)
        w.progress = Math.round((done / total) * 100)
        w.curStep = done
        w.steps = Array.from({ length: total }, (_, i) => (i < done ? 1 : 0))
        if (w.state !== 'done' && done >= total) {
          w.state = 'done'
          this.log('OK', `Workflow complete: ${w.name}`)
          this.pushChat('ORCH', `Mission complete: ${w.name}. Report archived to vault.`)
          this.s.meta.tokenTotal += 5
          this._logMission(w.name)
        }
        changed = true
        return
      }
      if (w.state === 'running') {
        w.progress = Math.min(100, w.progress + rand(0.15, 0.7))
        w.curStep = Math.min(w.steps.length - 1, Math.floor((w.progress / 100) * w.steps.length))
        w.steps = w.steps.map((st, i) => (i <= w.curStep ? 1 : 0))
        changed = true
        if (w.progress >= 100) {
          w.state = 'done'
          this.log('OK', `Workflow complete: ${w.name}`)
          this.pushChat('ORCH', `Mission complete: ${w.name}. Report archived to vault.`)
          this.s.meta.tokenTotal += 5
          this._logMission(w.name)
        }
      } else if (w.state === 'queued' && Math.random() < 0.02) {
        w.state = 'running'
        this.log('INFO', `Workflow dispatched: ${w.name}`)
        changed = true
      }
    })
    if (changed) this.store.markDirty()
    this._pruneWorkflows()
    this._pruneDispatch()
  }

  // ---- telemetry / probes ---- //
  tickTelemetry() {
    const t = this.s.telemetry
    t.temp = Math.max(35, Math.min(88, t.temp + rand(-1.2, 1.2)))
    t.lat = Math.max(40, Math.min(420, t.lat + rand(-14, 14)))
    t.ctx = Math.max(15, Math.min(92, t.ctx + rand(-1.5, 1.5)))
    t.token = Math.min(100, t.token + 0.05)
    this.s.meta.tokenTotal += rand(0.4, 1.6)
    // probes drift + condition engine (raise / escalate / clear on thresholds)
    this.s.probes.forEach((p) => {
      if (p.warnAt === 0) return
      p.value = Math.max(5, Math.min(100, p.value + rand(-2.2, 2.2)))
      this._checkProbe(p)
    })
    this._refreshAlertTimes()
    this.store.markDirty()
  }

  /**
   * Alert condition engine. Raises a `warn` alert when a probe crosses its
   * `warnAt` threshold, escalates to `crit` past `critAt`, and clears (acks)
   * the alert with hysteresis once the probe falls 3pts under `warnAt`.
   */
  _checkProbe(p) {
    const activeId = this._probeAlerts.get(p.name)
    const overCrit = p.critAt > 0 && p.value >= p.critAt
    const overWarn = p.value >= p.warnAt
    if (overWarn) {
      if (activeId) {
        const a = this.s.alerts.find((x) => x.id === activeId)
        if (a && overCrit && a.sev !== 'crit') {
          a.sev = 'crit'
          a.title = `${p.name} critical threshold crossed`
          a.detail = `${p.name} at ${p.value}${p.unit} (crit ${p.critAt}${p.unit}).`
          this.log('WARN', `ALERT ESCALATED crit: ${p.name} at ${p.value}${p.unit}`)
          this.pushChat('ORCH', `ALERT ESCALATED · ${p.name} CRITICAL at ${p.value}${p.unit}`)
        }
        return
      }
      const sev = overCrit ? 'crit' : 'warn'
      const id = this._nextAlertId()
      this.s.alerts.unshift({
        id,
        sev,
        source: p.name,
        title: overCrit ? `${p.name} critical threshold crossed` : `${p.name} above warning threshold`,
        detail: `${p.name} at ${p.value}${p.unit} (threshold ${overCrit ? p.critAt : p.warnAt}${p.unit}).`,
        time: 'just now',
        raisedAt: Date.now()
      })
      if (this.s.alerts.length > 20) this.s.alerts.pop()
      this._probeAlerts.set(p.name, id)
      this.log('WARN', `ALERT ${sev}: ${p.name} at ${p.value}${p.unit}`)
      if (sev === 'crit') this.pushChat('ORCH', `ALERT ${sev.toUpperCase()} · ${p.name} at ${p.value}${p.unit}`)
      return
    }
    if (activeId && p.value < p.warnAt - 3) {
      const a = this.s.alerts.find((x) => x.id === activeId)
      if (a) {
        a.acked = true
        a.time = 'resolved'
        delete a.raisedAt
      }
      this._probeAlerts.delete(p.name)
      this.log('INFO', `alert cleared: ${p.name} back under threshold`)
    }
  }

  _nextAlertId() {
    return `dyn${++this._alertSeq}`
  }

  /** Refresh relative "Xm ago" labels once per minute for raised alerts. */
  _refreshAlertTimes() {
    const nowMin = Math.floor(Date.now() / 60000)
    if (nowMin === this._alertMinute) return
    this._alertMinute = nowMin
    for (const a of this.s.alerts) {
      if (!a.raisedAt || a.acked) continue
      const mins = Math.max(1, Math.floor((Date.now() - a.raisedAt) / 60000))
      a.time = `${mins}m ago`
    }
  }

  // ---- scheduler ---- //
  tickScheduler() {
    this.s.schedules.forEach((job) => {
      // every job roughly checks if its minute window has passed; emulate next-run
      if (Math.random() < 0.01) {
        job.last = Math.random() < 0.9 ? 'OK' : 'WARN'
        job.next = this._nextCronLabel(job.cron)
        this.log('INFO', `scheduler fired: ${job.name} → ${job.last}`)
        this.store.markDirty()
      }
    })
  }

  _nextCronLabel(cron) {
    const m = String(Math.floor(rand(5, 55))).padStart(2, '0')
    const h = String(Math.floor(rand(0, 23))).padStart(2, '0')
    return `${h}:${m}`
  }

  ambientChat() {
    const bank = [
      ['ORCH', 'Re-scoring task priorities against mission objectives.'],
      ['CODA', 'Static analysis pass complete. 3 minor warnings, 0 errors.'],
      ['SAGE', 'Appending fresh telemetry to weekly digest.'],
      ['LINK', 'Heartbeat received from all integration channels.'],
      ['PILOT', 'Canary health checks steady. No rollout pause needed.'],
      ['NUDGE', 'Agenda sync — no collisions with scheduled blocks.']
    ]
    if (Math.random() < 0.7) {
      const [who, text] = bank[Math.floor(Math.random() * bank.length)]
      this.pushChat(who, text)
    }
  }

  // ==========================================================================
  // COMMANDS (from HUD / REST API)
  // ==========================================================================

  /**
   * Operator chat command. The orchestrator plans the goal into steps,
   * creates a workflow and queues one job per step — the step machine picks
   * them up (no setTimeout handoff).
   */
  async handleChat(text) {
    this.pushChat('USER', text)
    const steps = await plan(text)
    const name = text.toUpperCase().slice(0, 28).trim()
    const wf = {
      id: `wf${Date.now()}`,
      name,
      state: 'running',
      progress: 0,
      steps: steps.map(() => 0),
      curStep: 0,
      agents: new Set(steps.map((s) => s.agent)).size,
      eta: `${Math.round(steps.length * 4)} min`
    }
    this.s.workflows.unshift(wf)
    this._chatWorkflows.set(wf.id, { total: steps.length, done: 0, failed: 0 })
    this.pushChat('ORCH', `Plan generated — ${steps.length} steps. Dispatching ${wf.agents} agent(s).`)
    steps.forEach((step) => {
      this.s.dispatch.push({
        task: step.title,
        agent: step.agent,
        state: 'waiting',
        steps: [{ tool: step.tool, title: step.title }],
        maxAttempts: DEFAULT_MAX_ATTEMPTS,
        wfId: wf.id
      })
      this.log('INFO', `${step.agent} queued: ${step.title}`)
    })
    this.store.markDirty()
    this._pruneWorkflows()
    this._pruneDispatch()
    return { ok: true, steps: steps.length }
  }

  /**
   * Keep newest `WORKFLOW_CAP` workflows; never evict a `running` one (its
   * jobs may still be in flight). Drops orphaned chat-workflow tracking.
   */
  _pruneWorkflows() {
    const cap = 12
    const keep = new Set()
    for (const w of this.s.workflows) {
      if (keep.size < cap || w.state === 'running') keep.add(w.id)
    }
    if (keep.size < this.s.workflows.length) {
      this.s.workflows = this.s.workflows.filter((w) => keep.has(w.id))
      this.store.markDirty()
    }
    for (const id of this._chatWorkflows.keys()) {
      if (!keep.has(id)) this._chatWorkflows.delete(id)
    }
  }

  /**
   * Cap terminal (done/failed) dispatch jobs to the newest 30. Waiting and
   * in-flight jobs are never touched.
   */
  _pruneDispatch() {
    const terminal = this.s.dispatch.filter((j) => j.state === 'done' || j.state === 'failed')
    if (terminal.length <= 30) return
    const doomed = new Set(terminal.slice(0, terminal.length - 30))
    this.s.dispatch = this.s.dispatch.filter((j) => !doomed.has(j))
    this.store.markDirty()
  }

  dispatchTask(task, agent) {
    this.s.dispatch.push({ task, agent, state: 'waiting' })
    this.log('INFO', `Manual dispatch: ${agent} ← ${task}`)
    this.store.markDirty()
  }

  advanceKanban(cardId) {
    const card = this.s.kanban.cards.find((c) => c.id === cardId)
    if (!card) return { ok: false }
    const idx = this.s.kanban.columns.findIndex((c) => c.id === card.col)
    if (idx < this.s.kanban.columns.length - 1) {
      card.col = this.s.kanban.columns[idx + 1].id
    } else {
      this.s.kanban.cards = this.s.kanban.cards.filter((c) => c.id !== cardId)
    }
    this.log('INFO', `kanban: ${card.title} → ${card.col.toUpperCase()}`)
    this.store.markDirty()
    return { ok: true }
  }

  ackAlert(id) {
    const a = this.s.alerts.find((x) => x.id === id)
    if (a) {
      a.acked = true
      this.log('INFO', `alert acked: ${a.source}`)
      this.store.markDirty()
      return { ok: true }
    }
    return { ok: false }
  }

  /**
   * Hermes approval bridge. Surfaces an approval request to the HUD and blocks
   * (up to approvalTimeoutMs) until the operator responds via respondApproval.
   * Resolves with 'approve' | 'deny' | 'timeout'. The pending request and a
   * bounded history live in `s.approval` so the HUD renders the card.
   */
  _awaitApproval(payload, agent) {
    const req = {
      id: `ap${Date.now()}`,
      tool: (payload && payload.tool) || 'tool',
      summary: (payload && payload.summary) || (payload && payload.title) || 'Hermes requests approval',
      detail: (payload && payload.detail) || '',
      from: agent,
      choice: null,
      at: Date.now()
    }
    this.s.approval.pending = req
    this.log('WARN', `approval requested by ${agent}: ${req.summary}`)
    this.broadcast({ type: 'approval', pending: req })
    this.store.markDirty()
    return new Promise((resolve) => {
      const started = Date.now()
      const timer = setInterval(() => {
        if (req.choice) {
          clearInterval(timer)
          resolve(req.choice)
          return
        }
        if (Date.now() - started >= this.approvalTimeoutMs) {
          clearInterval(timer)
          resolve('timeout')
        }
      }, 500)
    }).then((choice) => {
      if (this.s.approval.pending === req) this.s.approval.pending = null
      this.s.approval.history.unshift({ ...req, resolvedAt: Date.now() })
      if (this.s.approval.history.length > 20) this.s.approval.history.pop()
      this.log('INFO', `approval ${choice}: ${req.summary}`)
      this.broadcast({ type: 'approval', pending: null })
      this.store.markDirty()
      return choice
    })
  }

  /** Operator response from the HUD: 'approve' | 'deny' against the pending request. */
  respondApproval(choice) {
    const req = this.s.approval && this.s.approval.pending
    if (!req) return { ok: false, error: 'no pending approval' }
    const resolved = choice === 'deny' ? 'deny' : 'approve'
    req.choice = resolved
    this.store.markDirty()
    return { ok: true, id: req.id, choice: resolved }
  }

  readEmail(idx) {
    const e = this.s.email[idx]
    if (e) {
      e.read = true
      this.store.markDirty()
      return { ok: true, email: e }
    }
    return { ok: false }
  }

  toggleAgenda(idx) {
    return { ok: false } // agenda is local UI state; keep server immutable
  }

  setCalDay(day) {
    this.s.calendar.day = day
    this.store.markDirty()
  }

  createMission(payload) {
    const { name, agents } = payload
    const wf = {
      id: `wf${Date.now()}`,
      name: String(name).toUpperCase().slice(0, 32),
      state: 'running',
      progress: 0,
      steps: [0, 0, 0, 0],
      curStep: 0,
      agents: agents.length,
      eta: '16 min'
    }
    this.s.workflows.unshift(wf)
    agents.forEach((a) => {
      this.s.dispatch.push({ task: `${wf.name} / step`, agent: a, state: 'waiting' })
    })
    this.log('INFO', `mission created: ${wf.name}`)
    this.store.markDirty()
    this._pruneWorkflows()
    this._pruneDispatch()
    return { ok: true, id: wf.id }
  }
}
