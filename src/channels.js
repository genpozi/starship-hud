/**
 * CHANNELS // Typed event channels (P9).
 *
 * Server frames carry `type`. Snapshot/delta frames are folded straight into
 * STATE; everything else is routed through a named reducer registered here.
 * Reducers are pure over the event + STATE, keep the channel list explicit,
 * and stay unit-testable without a socket.
 */

import { STATE } from './store.js'

const REDUCERS = {}

export function registerChannel(name, reducer) {
  if (typeof reducer !== 'function') return
  REDUCERS[name] = reducer
}

export function hasChannel(name) {
  return Object.prototype.hasOwnProperty.call(REDUCERS, name)
}

/**
 * Fold one typed frame into STATE. Returns true if a reducer handled it.
 * Unknown types are ignored so a newer server never crashes an older client.
 */
export function reduceEvent(event) {
  if (!event || typeof event.type !== 'string') return false
  const reducer = REDUCERS[event.type]
  if (!reducer) return false
  reducer(event, STATE)
  return true
}

// ---- built-in channels -----------------------------------------------------

registerChannel('events', (ev) => {
  // P12 span frames: newest-first, capped like the server-side slice.
  if (!Array.isArray(ev.events)) return
  STATE.trace = [...ev.events.slice().reverse(), ...(STATE.trace || [])].slice(0, 50)
})

registerChannel('approval', (ev) => {
  // Interrupt/approval frames overwrite the pending request (null clears it).
  if (ev.pending === undefined) return
  STATE.approval = STATE.approval || { pending: null, history: [] }
  STATE.approval.pending = ev.pending
})

registerChannel('chat', () => {
  // Hint-only frame; the authoritative message arrives in the next delta.
})

export { REDUCERS }
