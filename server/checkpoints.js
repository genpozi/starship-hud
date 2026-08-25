/**
 * CHECKPOINTS // Snapshot + rollback store (P10).
 * Full-state snapshots captured on demand; rollback restores the previous
 * checkpoint and tags every reverted slice so the UI can reflect it.
 */

export const CHECKPOINT_CAP = 8

export function snapshotState(state, { reason = 'manual' } = {}) {
  return {
    id: `ckpt_${Date.now()}_${Math.floor(Math.random() * 1e6)}`,
    ts: Date.now(),
    reason,
    state: JSON.parse(JSON.stringify(state))
  }
}

export function captureCheckpoint(list, state, opts) {
  const next = [...list, snapshotState(state, opts)]
  return next.length > CHECKPOINT_CAP ? next.slice(next.length - CHECKPOINT_CAP) : next
}

/**
 * Apply the latest checkpoint back onto `state`. Returns the id of the
 * restored checkpoint (null if none) plus the list of slices that were
 * actually reverted (deep-diff vs current).
 */
export function rollbackToLatest(list, state) {
  if (!list.length) return { id: null, slices: [] }
  const ckpt = list[list.length - 1]
  const slices = []
  Object.keys(ckpt.state).forEach((k) => {
    if (k === 'checkpoints') return // the ledger itself is never reverted
    const was = ckpt.state[k]
    const now = state[k]
    if (JSON.stringify(was) !== JSON.stringify(now)) {
      state[k] = was
      slices.push(k)
    }
  })
  return { id: ckpt.id, slices }
}
