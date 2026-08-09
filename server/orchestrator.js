import { Store } from './store.js'
import { buildSeedState } from './seed.js'
import { plan } from './planner.js'
import { runSkill } from './skills.js'

/**
 * ORCHESTRATOR // The core engine of the harness.
 *
 * Owns the canonical state (persisted via Store), advances agents and
 * workflows on a heartbeat, evaluates the scheduler, answers chat commands,
 * and pushes snapshots to all connected HUD clients.
 */

const TICK_MS = 1000
const AGENT_SPEED = { ORCH: 1.6, CODA: 1.3, PILOT: 1.5, SAGE: 1.1, LINK: 1.8, NUDGE: 0.4 }
const rand = (min, max) => min + Math.random() * (max - min)

export class Orchestrator {
  constructor({ onBroadcast }) {
    this.store = new Store(buildSeedState)
    this.onBroadcast = onBroadcast
    this.timers = []
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

  start() {
    this.log('INFO', 'Orchestrator online — all subsystems nominal')
    this.timers.push(setInterval(() => this.tickAgents(), TICK_MS))
    this.timers.push(setInterval(() => this.tickWorkflows(), 1400))
    this.timers.push(setInterval(() => this.tickTelemetry(), 1200))
    this.timers.push(setInterval(() => this.tickScheduler(), 2000))
    this.timers.push(setInterval(() => this.broadcastState(), 1500))
    this.timers.push(setInterval(() => this.ambientChat(), 9000))
    return this
  }

  stop() {
    this.timers.forEach(clearInterval)
    this.timers = []
  }

  broadcastState() {
    this.broadcast({ type: 'state', state: this.s })
  }

  // ---- agents ---- //
  tickAgents() {
    const { agents } = this.s
    let changed = false
    agents.forEach((a) => {
      if (a.state === 'idle') {
        // pick up from dispatch queue if available
        const job = this.s.dispatch.find((d) => d.state === 'waiting' && d.agent === a.name)
        if (job) {
          job.state = 'assigned'
          a.state = 'busy'
          a.task = job.task
          a.progress = 4
          changed = true
          this.log('INFO', `${a.name} picked up: ${job.task}`)
        }
        return
      }
      const speed = AGENT_SPEED[a.id] || 1
      a.progress = Math.min(100, a.progress + rand(0.4, 1.8) * speed)
      a.tokens += rand(0.05, 0.4)
      changed = true
      if (a.progress >= 100) {
        const done = a.task
        this.log('OK', `${a.name} completed: ${done}`)
        this.pushChat(a.name, `Task complete: ${done}`)
        // retire the dispatch job
        const job = this.s.dispatch.find((d) => d.task === done)
        if (job) job.state = 'done'
        a.state = 'idle'
        a.task = 'Standing by'
        a.progress = 0
        this.s.meta.tokenTotal += 2
      }
    })
    if (changed) this.store.markDirty()
  }

  // ---- workflows / missions ---- //
  tickWorkflows() {
    const { workflows } = this.s
    let changed = false
    workflows.forEach((w) => {
      if (w.state === 'running') {
        w.progress = Math.min(100, w.progress + rand(0.15, 0.7))
        w.curStep = Math.min(w.steps.length - 1, Math.floor((w.progress / 100) * w.steps.length))
        w.steps = w.steps.map((st, i) => (i <= w.curStep ? 1 : 0))
        changed = true
        if (w.progress >= 100) {
          w.state = 'done'
          this.log('OK', `Workflow complete: ${w.name}`)
          this.pushChat('ORCH', `Mission complete: ${w.name}. Logged to vault.`)
          this.s.meta.tokenTotal += 5
        }
      } else if (w.state === 'queued' && Math.random() < 0.02) {
        w.state = 'running'
        this.log('INFO', `Workflow dispatched: ${w.name}`)
        changed = true
      }
    })
    if (changed) this.store.markDirty()
  }

  // ---- telemetry / probes ---- //
  tickTelemetry() {
    const t = this.s.telemetry
    t.temp = Math.max(35, Math.min(88, t.temp + rand(-1.2, 1.2)))
    t.lat = Math.max(40, Math.min(420, t.lat + rand(-14, 14)))
    t.ctx = Math.max(15, Math.min(92, t.ctx + rand(-1.5, 1.5)))
    t.token = Math.min(100, t.token + 0.05)
    this.s.meta.tokenTotal += rand(0.4, 1.6)
    // probes drift
    this.s.probes.forEach((p) => {
      if (p.warnAt === 0) return
      p.value = Math.max(5, Math.min(100, p.value + rand(-2.2, 2.2)))
    })
    this.store.markDirty()
  }

  // ---- scheduler ---- //
  tickScheduler() {
    const now = new Date()
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
   * creates a workflow and dispatches agents.
   */
  async handleChat(text) {
    this.pushChat('USER', text)
    const steps = await plan(text)
    const name = text.toUpperCase().slice(0, 28)
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
    this.pushChat('ORCH', `Plan generated — ${steps.length} steps. Dispatching ${wf.agents} agent(s).`)
    steps.forEach((step, i) => {
      setTimeout(() => {
        this.s.dispatch.push({ task: step.title, agent: step.agent, state: 'waiting' })
        this.log('INFO', `${step.agent} queued: ${step.title}`)
        runSkill(step.tool, this).then(() => this.store.markDirty())
      }, i * 2500)
    })
    this.store.markDirty()
    return { ok: true, steps: steps.length }
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
    return { ok: true, id: wf.id }
  }
}
