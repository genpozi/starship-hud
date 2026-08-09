import {
  SHIP,
  AGENTS,
  WORKFLOWS,
  KANBAN_COLUMNS,
  KANBAN_CARDS,
  OPEN_ITEMS,
  SCHEDULED_TASKS,
  CHAT_SEED,
  VAULT_DOCS,
  EMAILS,
  CALENDAR_EVENTS,
  ALERTS,
  REPORTS,
  PROBES
} from '../src/config.js'

/**
 * SEED // Builds the canonical runtime state from the shared config.
 * This is the server's single source of truth; the frontend mirrors it.
 */
export function buildSeedState() {
  return {
    meta: {
      mission: SHIP.mission,
      coordinates: [...SHIP.coordinates],
      threat: 'ALPHA',
      tokenTotal: 0,
      bootedAt: Date.now()
    },
    agents: AGENTS.map((a) => ({ ...a })),
    workflows: WORKFLOWS.map((w) => ({ ...w, steps: [...w.steps] })),
    kanban: {
      columns: KANBAN_COLUMNS.map((c) => ({ ...c })),
      cards: KANBAN_CARDS.map((c) => ({ ...c }))
    },
    items: OPEN_ITEMS.map((i) => ({ ...i })),
    schedules: SCHEDULED_TASKS.map((s) => ({ ...s })),
    chat: CHAT_SEED.map((m) => ({ ...m, ts: Date.now() })),
    dispatch: [
      { task: 'Review failing CI job: e2e-surface', agent: 'CODA', state: 'assigned' },
      { task: 'Investigate ingress latency p99', agent: 'PILOT', state: 'assigned' },
      { task: 'Draft cycle 42 planning notes', agent: 'NUDGE', state: 'waiting' },
      { task: 'Sweep vault for stale blobs', agent: 'LINK', state: 'waiting' },
      { task: 'Compile context-compaction digest', agent: 'SAGE', state: 'assigned' }
    ],
    vault: VAULT_DOCS.map((d) => ({ ...d })),
    email: EMAILS.map((e) => ({ ...e })),
    calendar: {
      events: CALENDAR_EVENTS.map((e) => ({ ...e })),
      day: new Date().getDay() % 5,
      weekLabel: 'CYCLE 42 / W-2'
    },
    alerts: ALERTS.map((a) => ({ ...a, acked: false })),
    probes: PROBES.map((p) => ({ ...p })),
    reports: REPORTS.map((r) => ({ ...r })),
    telemetry: { temp: 42, token: 38, lat: 84, ctx: 27 },
    logs: []
  }
}
