/**
 * STORE // Client-side canonical state.
 *
 * In ONLINE mode the server pushes full snapshots which deep-replace these
 * slices. In OFFLINE (sim) mode the boot sequence mutates this same object so
 * every view renderer always reads one state — no config import drift.
 */

import {
  AGENTS,
  WORKFLOWS,
  KANBAN_COLUMNS,
  KANBAN_CARDS,
  OPEN_ITEMS,
  SCHEDULED_TASKS,
  CHAT_SEED,
  DISPATCH_SEED,
  VAULT_DOCS,
  EMAILS,
  CALENDAR_EVENTS,
  ALERTS,
  REPORTS,
  PROBES,
  SHIP
} from './config.js'

export const STATE = {
  meta: { mission: SHIP.mission, coordinates: [...SHIP.coordinates], tokenTotal: 0 },
  agents: AGENTS.map((a) => ({ ...a })),
  workflows: WORKFLOWS.map((w) => ({ ...w, steps: [...w.steps] })),
  kanban: {
    columns: KANBAN_COLUMNS.map((c) => ({ ...c })),
    cards: KANBAN_CARDS.map((c) => ({ ...c }))
  },
  items: OPEN_ITEMS.map((i) => ({ ...i })),
  schedules: SCHEDULED_TASKS.map((s) => ({ ...s })),
  chat: CHAT_SEED.map((m) => ({ ...m })),
  dispatch: DISPATCH_SEED.map((d) => ({ ...d })),
  vault: VAULT_DOCS.map((d) => ({ ...d })),
  email: EMAILS.map((e) => ({ ...e })),
  calendar: { events: CALENDAR_EVENTS.map((e) => ({ ...e })), day: new Date().getDay() % 5, weekLabel: 'CYCLE 42 / W-2' },
  alerts: ALERTS.map((a) => ({ ...a, acked: false })),
  probes: PROBES.map((p) => ({ ...p })),
  reports: REPORTS.map((r) => ({ ...r })),
  telemetry: { temp: 42, token: 38, lat: 84, ctx: 27, jobs: { done: 0, failed: 0 }, hist: [] },
  approval: { pending: null, history: [] },
  logs: []
}

/**
 * Replace every server-owned slice with the incoming snapshot.
 * Local-only UI state (calendar.day selection) is preserved when present.
 */
export function applyServerState(snap) {
  if (!snap) return
  const localDay = STATE.calendar.day
  const keys = ['agents', 'workflows', 'kanban', 'items', 'schedules', 'chat', 'dispatch', 'vault', 'email', 'alerts', 'probes', 'reports', 'telemetry', 'approval', 'logs', 'meta']
  keys.forEach((k) => {
    if (snap[k] !== undefined) STATE[k] = snap[k]
  })
  if (snap.calendar && snap.calendar.events) {
    STATE.calendar = { ...snap.calendar, day: localDay }
  }
}

/**
 * Apply a delta frame: assign every changed top-level key into STATE.
 * Local-only UI state (calendar.day selection) is preserved when present.
 */
export function applyDelta(updates) {
  if (!updates || typeof updates !== 'object') return
  const localDay = STATE.calendar.day
  Object.keys(updates).forEach((k) => {
    if (updates[k] === undefined) return
    if (k === 'calendar') {
      STATE.calendar = { ...updates.calendar, day: localDay }
    } else {
      STATE[k] = updates[k]
    }
  })
}
