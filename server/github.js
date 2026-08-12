import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * GITHUB SYNC // Optional GitHub -> kanban/items data source.
 *
 * Dependency-free (native fetch + node:fs only). When GITHUB_TOKEN/OWNER/REPO
 * are configured the poller maps repo issues+PRs onto the same board shape the
 * seed produces ({kanban.cards, items}), otherwise the caller stays in seed
 * mode. Mirrors docs/RESEARCH.md section 5.
 */

const __dirname = dirname(fileURLToPath(import.meta.url))
const ETAGS_FILE = join(__dirname, '..', 'data', 'github-etags.json')

const API = 'https://api.github.com'
const GITHUB_API_VERSION = '2022-11-28'
const STATUS_LABELS = ['in-progress', 'wip', 'status/in-progress', 'blocked']
const RATE_LIMIT_SKIP_AT = 5
const TITLE_MAX = 64

// kanban column ids (src/config.js KANBAN_COLUMNS: backlog / doing / review / done).
const COL_DONE = 'done'
const COL_IN_PROGRESS = 'doing'
const COL_BACKLOG = 'backlog'

// module-level cache of the last raw bodies per endpoint so a 304 can be honored
// without refetching; also guards against double-starting the poller.
const lastBodies = new Map()
let syncTimer = null

/* ============================================================================
   CONFIG
   ============================================================================ */
export function getConfig() {
  const token = process.env.GITHUB_TOKEN || ''
  const owner = process.env.GITHUB_OWNER || ''
  const repo = process.env.GITHUB_REPO || ''
  const pollMs = Number(process.env.GITHUB_POLL_MS) > 0 ? Number(process.env.GITHUB_POLL_MS) : 180000
  return { enabled: Boolean(token && owner && repo), token, owner, repo, pollMs }
}

/* ============================================================================
   ETAG / SINCE PERSISTENCE
   ============================================================================ */
function loadEtags() {
  try {
    if (existsSync(ETAGS_FILE)) return JSON.parse(readFileSync(ETAGS_FILE, 'utf8'))
  } catch {}
  return {}
}

function saveEtags(etags) {
  try {
    mkdirSync(dirname(ETAGS_FILE), { recursive: true })
    writeFileSync(ETAGS_FILE, JSON.stringify(etags, null, 2))
  } catch {}
}

/* ============================================================================
   MAPPING HELPERS
   ============================================================================ */
function labelNames(entry) {
  return (entry.labels || []).map((l) => (typeof l === 'string' ? l : l.name || '')).filter(Boolean)
}

function derivePrio(labels) {
  const lower = labels.map((l) => l.toLowerCase())
  for (const l of lower) {
    if (l.startsWith('priority:')) {
      const level = l.split(':')[1].trim().replace(/^p/i, '')
      if (/^[0-3]$/.test(level)) return `P${level}`
    }
  }
  const p = lower.find((l) => /^p[0-3]$/.test(l))
  if (p) return p.toUpperCase()
  return 'P2'
}

function truncate(title) {
  const t = String(title || 'untitled').trim()
  return t.length > TITLE_MAX ? t.slice(0, TITLE_MAX) : t
}

function mapCol(entry) {
  const isPr = Boolean(entry.pull_request)
  const state = String(entry.state || 'open').toLowerCase()
  if (state === 'closed' || entry.merged === true) return COL_DONE
  const labels = (entry.labels || []).map((l) =>
    (typeof l === 'string' ? l : l.name || '').toLowerCase()
  )
  if (isPr && entry.draft !== true) return COL_IN_PROGRESS
  if (!isPr && labels.some((l) => STATUS_LABELS.includes(l))) return COL_IN_PROGRESS
  return COL_BACKLOG
}

function mapItem(entry) {
  const isPr = Boolean(entry.pull_request)
  const state = String(entry.state || 'open').toLowerCase()
  let status = 'open'
  if (isPr && entry.merged === true) status = 'merged'
  else if (state === 'closed') status = 'closed'
  else if (isPr) status = 'review'
  return status
}

function toBoard(entries, lastSync) {
  const cards = []
  const items = []
  for (const e of entries) {
    const labels = labelNames(e)
    const title = truncate(e.title)
    const agent = (e.assignee && e.assignee.login ? e.assignee.login : 'UNASSIGNED').toUpperCase()
    const card = {
      id: `gh-${e.number}`,
      title,
      tags: labels.slice(0, 2),
      agent,
      prio: derivePrio(labels),
      col: mapCol(e)
    }
    cards.push(card)
    items.push({
      id: card.id,
      title,
      type: e.pull_request ? 'PR' : 'ISSUE',
      prio: card.prio,
      assignee: agent,
      status: mapItem(e)
    })
  }
  return { dataSource: 'github', lastSync, cards, items }
}

function extractRateLimit(res) {
  const get = (h) => {
    const v = res.headers.get(h)
    return v ? Number(v) : undefined
  }
  return {
    limit: get('x-ratelimit-limit'),
    remaining: get('x-ratelimit-remaining'),
    reset: get('x-ratelimit-reset')
  }
}

/**
 * Combine an incoming (GitHub-owned) board with integration-sourced entities
 * that already live on the same board. The GitHub sync only owns what it
 * mapped; `src:'hermes'` rows (reverse ingest) are preserved.
 */
export function mergeReplacement(existingCards, existingItems, incomingCards, incomingItems) {
  const keptCards = existingCards.filter((c) => c.src === 'hermes')
  const keptItems = existingItems.filter((i) => i.src === 'hermes')
  return {
    cards: [...keptCards, ...incomingCards],
    items: [...keptItems, ...incomingItems]
  }
}

/* ============================================================================
   FETCH
   ============================================================================ */
async function fetchEndpoint(path, config, etags, since) {
  const headers = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': GITHUB_API_VERSION,
    Authorization: `token ${config.token}`,
    'User-Agent': 'stellaris7-mission-control'
  }
  const etag = etags[path]
  if (etag) headers['If-None-Match'] = etag

  const qs = new URLSearchParams({
    state: 'all',
    per_page: '100',
    sort: 'updated',
    direction: 'desc'
  })
  if (since) qs.set('since', since)

  const url = `${API}/repos/${config.owner}/${config.repo}/${path}?${qs}`
  const res = await fetch(url, { headers })
  const newEtag = res.headers.get('etag')
  const rateLimit = extractRateLimit(res)

  if (res.status === 304) {
    const cached = lastBodies.get(path)
    if (cached) return { status: 304, etag, rateLimit, items: cached.items }
    return { status: 304, etag, rateLimit, items: null }
  }
  if (!res.ok) {
    const err = new Error(`GitHub API ${res.status} ${res.statusText} on ${path}`)
    err.status = res.status
    err.rateLimit = rateLimit
    throw err
  }

  const items = await res.json()
  if (newEtag) lastBodies.set(path, { etag: newEtag, items })
  return { status: 200, etag: newEtag, rateLimit, items }
}

/* ============================================================================
   SYNC
   ============================================================================ */
/**
 * @param {object|null} previousBoard previous mapped board (used as fallback).
 * @param {object}      config       result of getConfig().
 * @returns {null | {error} | {skipped,rateLimit} | {dataSource,lastSync,cards,items,rateLimit}}
 *   304/no-change -> null; failures -> {error} (never throws); rate limit -> {skipped}.
 */
export async function syncGithubState(previousBoard, config) {
  const cfg = config || getConfig()
  if (!cfg.enabled) return { error: 'GitHub sync not enabled (token/owner/repo missing)' }

  const etags = loadEtags()
  const since = etags.since || undefined

  try {
    // Serialized: issues first, pulls second.
    const issues = await fetchEndpoint('issues', cfg, etags, since)
    if (issues.rateLimit.remaining !== undefined && issues.rateLimit.remaining <= RATE_LIMIT_SKIP_AT) {
      return { skipped: true, rateLimit: issues.rateLimit }
    }

    const pulls = await fetchEndpoint('pulls', cfg, etags, since)
    const rateLimit = pulls.rateLimit

    const issueItems = issues.items || []
    const pullItems = pulls.items || []

    // issues endpoint already embeds PRs; pulls fills any gaps. Dedupe by number.
    const byNumber = new Map()
    for (const it of issueItems) byNumber.set(it.number, it)
    for (const it of pullItems) if (!byNumber.has(it.number)) byNumber.set(it.number, it)

    // Persist etags + since on a full successful pass (both endpoints fresh or 304).
    if (issues.etag) etags.issues = issues.etag
    if (pulls.etag) etags.pulls = pulls.etag
    etags.since = new Date().toISOString()
    saveEtags(etags)

    if (byNumber.size === 0) return null

    const board = toBoard([...byNumber.values()], new Date().toISOString())
    board.rateLimit = rateLimit
    return board
  } catch (err) {
    return { error: err.status ? `GitHub API ${err.status}` : err.message, rateLimit: err.rateLimit }
  }
}

/* ============================================================================
   SCHEDULER
   ============================================================================ */
export function startGithubSync({ orchestrator, intervalMs }) {
  const cfg = getConfig()
  if (!cfg.enabled) {
    orchestrator.s.meta.dataSource = 'seed'
    orchestrator.log('INFO', 'GitHub sync disabled — no GITHUB_TOKEN/OWNER/REPO; using seed data')
    return { stop() {} }
  }

  if (syncTimer) {
    orchestrator.log('INFO', 'GitHub sync already running — skipping double start')
    return { stop: stopSync }
  }

  const ms = intervalMs || cfg.pollMs || 180000
  orchestrator.log('INFO', `GitHub sync started — ${cfg.owner}/${cfg.repo} every ${ms}ms`)

  const tick = async () => {
    try {
      const previous = {
        cards: orchestrator.s.kanban.cards,
        items: orchestrator.s.items
      }
      const res = await syncGithubState(previous, cfg)
      if (!res) {
        orchestrator.log('INFO', 'GitHub sync: no changes (304)')
        return
      }
      if (res.skipped) {
        const remaining = res.rateLimit && res.rateLimit.remaining
        orchestrator.log('WARN', `GitHub sync skipped — rate limit near 0 (remaining=${remaining ?? '?'})`)
        return
      }
      if (res.error) {
        orchestrator.log('ERROR', `GitHub sync failed: ${res.error}`)
        return
      }
      // Preserve integration-sourced entities (e.g. Hermes reverse ingest) that
      // live on the same board; the GitHub sync only owns what it mapped.
      const merged = mergeReplacement(
        orchestrator.s.kanban.cards,
        orchestrator.s.items,
        res.cards,
        res.items
      )
      orchestrator.s.kanban.cards = merged.cards
      orchestrator.s.items = merged.items
      orchestrator.s.meta.dataSource = 'github'
      orchestrator.s.meta.lastSync = res.lastSync
      if (orchestrator.store && typeof orchestrator.store.markDirty === 'function') {
        orchestrator.store.markDirty()
      }
      orchestrator.log('INFO', `GitHub sync OK — ${res.cards.length} cards, ${res.items.length} items`)
    } catch (err) {
      orchestrator.log('ERROR', `GitHub sync error: ${err.message}`)
    }
  }

  syncTimer = setInterval(tick, ms)
  tick()
  return { stop: stopSync }
}

function stopSync() {
  if (syncTimer) {
    clearInterval(syncTimer)
    syncTimer = null
  }
}

/* ============================================================================
   DRY RUN / SELF-TEST
   ============================================================================ */
export async function dryRun() {
  const cfg = getConfig()
  if (!cfg.enabled) {
    const msg = 'dataSource:"seed" (no GITHUB_TOKEN)'
    console.log(msg)
    return { dataSource: 'seed', message: msg }
  }

  console.log(`mode: github | ${cfg.owner}/${cfg.repo} | pollMs=${cfg.pollMs}`)
  const res = await syncGithubState(null, cfg)
  if (!res) {
    console.log('no changes (304)')
    return { dataSource: 'github', unchanged: true }
  }
  if (res.error) {
    console.log(`sync error: ${res.error}`)
    return { dataSource: 'seed', error: res.error }
  }
  if (res.skipped) {
    console.log(`sync skipped: rate limit remaining=${res.rateLimit && res.rateLimit.remaining}`)
    return { dataSource: 'github', skipped: true }
  }
  console.log(JSON.stringify(
    { dataSource: res.dataSource, cards: res.cards, items: res.items },
    null,
    2
  ))
  return res
}

// CLI: node server/github.js --dry
if (process.argv[1] && process.argv[1].endsWith('github.js') && process.argv.includes('--dry')) {
  dryRun()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(`dry run failed: ${err.message}`)
      process.exit(0)
    })
}
