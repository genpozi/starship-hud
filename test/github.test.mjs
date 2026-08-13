/**
 * GITHUB SUITE // issue/PR → board mapping + hermes-preservation merge.
 * Pure unit tests — no network, no token. Guards the GitHub data-source path.
 */
import { mergeReplacement, derivePrio, mapCol, mapItem, toBoard, getConfig } from '../server/github.js'

const results = []
const pass = (name, cond) => results.push(`${cond ? 'PASS' : 'FAIL'} ${name}`)

// ---- 1. derivePrio ----
pass('prio priority:2 label → P2', derivePrio(['priority:2', 'bug']) === 'P2')
pass('prio bare p1 label → P1', derivePrio(['p1']) === 'P1')
pass('prio priority:3 colon-form → P3', derivePrio(['priority:3']) === 'P3')
pass('prio no label → P2 default', derivePrio([]) === 'P2')

// ---- 2. mapCol ----
const openIssue = { state: 'open', labels: [], pull_request: undefined }
pass('col open issue → backlog', mapCol(openIssue) === 'backlog')
pass('col open issue with in-progress label → doing', mapCol({ ...openIssue, labels: ['in-progress'] }) === 'doing')
pass('col open PR (non-draft) → doing', mapCol({ state: 'open', labels: [], pull_request: { url: 'x' } }) === 'doing')
pass('col open draft PR → backlog', mapCol({ state: 'open', labels: [], pull_request: {}, draft: true }) === 'backlog')
pass('col closed issue → done', mapCol({ state: 'closed', labels: [] }) === 'done')
pass('col merged PR → done', mapCol({ state: 'open', labels: [], pull_request: {}, merged: true }) === 'done')

// ---- 3. mapItem ----
pass('item open issue → open', mapItem(openIssue) === 'open')
pass('item open PR → review', mapItem({ state: 'open', pull_request: {} }) === 'review')
pass('item merged PR → merged', mapItem({ state: 'open', pull_request: {}, merged: true }) === 'merged')
pass('item closed issue → closed', mapItem({ state: 'closed', labels: [] }) === 'closed')

// ---- 4. toBoard ----
const board = toBoard([
  { number: 42, title: 'Fix ingress p99 latency spike', labels: ['priority:1', 'bug'], assignee: { login: 'coda' }, state: 'open', pull_request: undefined },
  { number: 43, title: 'Release canary v1.4.2', labels: [], assignee: null, state: 'open', pull_request: { url: 'x' } },
  { number: 44, title: 'Chore: archive stale blobs', labels: ['chore'], assignee: { login: 'link' }, state: 'closed', pull_request: undefined }
], '2026-08-13T00:00:00Z')
pass('toBoard dataSource github', board.dataSource === 'github')
pass('toBoard 3 cards with gh- ids', board.cards.length === 3 && board.cards.every((c) => c.id.startsWith('gh-')))
const c42 = board.cards.find((c) => c.id === 'gh-42')
pass('toBoard card 42 title/prio/agent/col', c42.title === 'Fix ingress p99 latency spike' && c42.prio === 'P1' && c42.agent === 'CODA' && c42.col === 'backlog')
const it43 = board.items.find((i) => i.id === 'gh-43')
pass('toBoard PR item type PR status review', it43.type === 'PR' && it43.status === 'review')
const it44 = board.items.find((i) => i.id === 'gh-44')
pass('toBoard closed issue item status closed', it44.type === 'ISSUE' && it44.status === 'closed')

// ---- 5. mergeReplacement (hermes preservation) ----
const existingCards = [{ id: 'he-1', src: 'hermes' }, { id: 'gh-1' }, { id: 'seed-x' }]
const existingItems = [{ id: 'he-1', src: 'hermes' }, { id: 'gh-1' }]
const incoming = [{ id: 'gh-2' }]
const merged = mergeReplacement(existingCards, existingItems, incoming, incoming)
pass('replacement keeps hermes card + incoming, drops gh-1 and seed-x',
  merged.cards.length === 2 && merged.cards[0].id === 'he-1' && merged.cards[1].id === 'gh-2'
  && !merged.cards.some((c) => c.id === 'gh-1' || c.id === 'seed-x'))
pass('replacement keeps hermes item + incoming', merged.items.length === 2 && merged.items[0].id === 'he-1' && merged.items[1].id === 'gh-2')
pass('replacement with no hermes rows → only incoming', mergeReplacement([], [], incoming, incoming).cards.length === 1)

// ---- 6. getConfig disabled without env ----
const saved = { t: process.env.GITHUB_TOKEN, o: process.env.GITHUB_OWNER, r: process.env.GITHUB_REPO }
process.env.GITHUB_TOKEN = ''
process.env.GITHUB_OWNER = ''
process.env.GITHUB_REPO = ''
pass('getConfig disabled when no token/owner/repo', getConfig().enabled === false)
process.env.GITHUB_TOKEN = saved.t; process.env.GITHUB_OWNER = saved.o; process.env.GITHUB_REPO = saved.r

console.log(results.join('\n'))
const fails = results.filter((r) => r.startsWith('FAIL'))
console.log(fails.length ? `\n${fails.length} FAILURES` : '\nALL PASS')
process.exit(fails.length ? 1 : 0)
