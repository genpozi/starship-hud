import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DATA_DIR = join(__dirname, '..', 'data')
const STATE_FILE = join(DATA_DIR, 'state.json')

/**
 * STORE // Tiny JSON file persistence with debounced writes.
 * The orchestrator mutates an in-memory state object and marks it dirty;
 * the store flushes to disk periodically so state survives restarts.
 */
export class Store {
  constructor(seedFn) {
    this.data = null
    this.seedFn = seedFn
    this.dirty = false
    this.timer = null
    mkdirSync(DATA_DIR, { recursive: true })
    this._load()
  }

  _load() {
    if (existsSync(STATE_FILE)) {
      try {
        this.data = JSON.parse(readFileSync(STATE_FILE, 'utf-8'))
        return
      } catch {
        // corrupt state file — fall through to fresh seed
      }
    }
    this.data = this.seedFn()
    this._flush()
  }

  markDirty() {
    if (this.dirty) return
    this.dirty = true
    clearTimeout(this.timer)
    this.timer = setTimeout(() => this._flush(), 1500)
  }

  _flush() {
    this.dirty = false
    try {
      writeFileSync(STATE_FILE, JSON.stringify(this.data, null, 2))
    } catch (err) {
      console.error('[store] flush failed', err.message)
    }
  }
}
