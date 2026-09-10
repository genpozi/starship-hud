# STELLARIS-7 Architecture

The HUD is a single-page console that renders fleet state in 12 views. State
has a single source of truth: the **orbit server** (Node/Express + WebSocket).
The browser mirrors state over a WebSocket and issues mutations via REST. If
the server is unreachable the HUD falls back to a self-contained simulation so
the console never goes dark.

```
┌──────────────────────────────┐  WS       ┌───────────────────────────────────┐
│  BROWSER (Vite SPA)          │◄────────► │  ORBIT SERVER (port 3001)         │
│                              │  /ws      │                                   │
│  src/main.js   boot + router │  REST     │  server/index.js   express + ws   │
│  src/store.js  canonical state│ /api/*   │  server/orchestrator.js  engine    │
│  src/views.js  12 renderers  │           │  server/store.js     persistence  │
│  src/api.js    ws + rest     │           │  server/planner.js   LLM/heuristic│
│  src/channels.js typed reducers│        │  server/skills.js    tool registry│
│  src/galaxy.js three.js bg   │           │  server/knowledge.js retrieval    │
│                              │           │  server/replies.js   reply synth  │
│  src/config.js seed + consts │           │  server/trace.js     span tree    │
│                              │           │  server/checkpoints.js snapshots  │
│                              │           │  server/seed.js      seed state   │
│                              │           │  server/github.js   GitHub source │
│                              │           │  server/hermes.js   Hermes client │
│                              │           │  server/hermes-ingest.js  reverse │
│                              │           │  server/hermes-contract.js  probe │
│                              │           │  server/mock-hermes.js  test seam │
│                              │           │  data/state.json     snapshot     │
└──────────────────────────────┘           └───────────────────────────────────┘
```

## Runtime modes

| Mode | When | State owner | Chat planning | Persistence |
|------|------|-------------|---------------|-------------|
| ONLINE | `/ws` connects | orbit server (WS snapshots + deltas) | server planner (LLM if keyed, else heuristic) | `data/state.json` |
| OFFLINE | WS fails/unreachable | browser sim in `main.js` | canned local replies | none |

`src/api.js` reconnects with backoff; while disconnected the OFFLINE sim owns
`STATE` so every view keeps animating.

## Data flow

1. `server/index.js` boots the `Orchestrator`, which loads or seeds state and
   captures a boot-guard checkpoint (P10).
2. On connect, each WS client receives a full `{type:'snapshot', seq, state}`
   frame (the authoritative baseline), then `{type:'delta', seq, updates}`
   frames (~1.5s) as the heartbeat mutates agents, workflows, telemetry,
   scheduler, probes, and logs.
3. The browser's `api.js` applies every frame to `STATE` (store.js). Non-state
   frames (`events`, `approval`, `chat`) are folded through typed channel
   reducers (`channels.js`). A fixed render loop re-renders the rollup every 1s
   and all views every 1.8s. Renderers diff slices (`changed(slice, value)`) so
   idle ticks do not rebuild unchanged DOM.
4. Operator interactions (chat, kanban advance, alert ack, approval respond,
    email read/send/archive, calendar select/create, inbound webhook, mission create, manual dispatch, checkpoint capture/
   rollback, pause/interrupt/resume) POST to `/api/*`. The server mutates
   canonical state and the next broadcast reflects it back.
   Chat is special: `handleChat` detects a direct `@AGENT` mention, pins the
   plan + reply owner to that agent, plans the goal into steps (P8 `dependsOn`
   chains preserved), and immediately replies with a synthesized,
   knowledge-grounded answer (`replies.js`) — the operator gets an actual
   answer, not just a queued task. Steps run as supersteps: `tickAgents` gates
   pickup until every step's dependencies complete.
5. Dispatch runs a step machine (`_advanceStep`). Each run/tool call feeds the
   P12 trace span tree (`trace.js`), which is flattened, prepended to the
   `trace` slice, and broadcast as `{type:'events', events}`.
6. Optional data sources poll on their own cadence and write onto the same
   board shape: **GitHub** (issues/PRs) replaces the seed board;
   **Hermes WebUI** (sessions/crons) reverse-ingests onto kanban/items/
    scheduler/alerts. **Comms** (Gmail / Graph / ICS / webhook) syncs email +
    calendar onto the same seed shapes; `meta.comms` records the live source.
    `meta.dataSource` tells the HUD which board source is live.

## Server modules

- **index.js** — HTTP + WS bootstrap; REST route table; `bootstrapGithub()`,
  `bootstrapHermes()`, and `bootstrapComms()` (self-guarding imports); heartbeat + half-open
  detection; serves the built `dist/` in production.
- **orchestrator.js** — the engine. Owns the Store; heartbeat ticks for agents,
  workflows, telemetry/probes, scheduler; the WS broadcast diff; the step
  machine for dispatched jobs with the P8 superstep dependency barrier; the
  probe alert condition engine; the operator approval bridge
  (`approval.pending` / `respondApproval`); the P10 checkpoint capture/rollback
  surface; and P11 `pause`/`interrupt`/`resume` (single-operator hold that
  gates dispatch pickup while in-flight steps finish).
- **planner.js** — `plan(goal)` → `[{title, agent, tool, dependsOn}]`. Uses a
  real LLM when `USER_LLM_API_KEY` is set, otherwise the deterministic
  heuristic engine. Output is sanitized (`normalizeSteps`) — unknown agent
  names and tools are coerced, and `dependsOn` references to earlier step
  titles are validated so the step machine never runs an unregistered tool or
  a dangling dependency.
- **knowledge.js** — read-only retrieval layer over canonical state (vault
  docs, reports, kanban cards, items, schedules, probes, email, calendar). `retrieve()` returns
  ranked hits; `digest()` summarizes. Pure function of state.
- **replies.js** — conversational reply synthesis. `synthesizeReply()` renders
  a grounded, in-character answer (agent persona + knowledge hits) via the LLM
  when keyed, else a deterministic heuristic — including honest "I don't have
  a clear read" for ambiguous goals.
- **skills.js** — typed tool registry (`search`, `shell`, `coder`, `memory`,
  `files`, `terminal`, `mail`, `calendar`, `hermes`). Executors receive a `ctx` (`s`, `log`,
  `pushChat`, `hermes`, `approvalMode`) and mutate shared state. `search` and
  `memory` now ground their results in `knowledge.js`. The `hermes`
  skill delegates to a real WebUI through `streamChat`/`syncChat`, handles
  approvals per `USER_HERMES_APPROVAL`, and falls back to simulated delegation.
  `mail` / `calendar` call `server/comms.js` and simulate locally when no provider is set.
- **comms.js** — Gmail / Microsoft Graph / ICS adapters, OAuth refresh, ICS
  parse, inbound webhook normalize, `mergeComms` (keeps `src:'local'`), sync loop.
  Env-driven; seed fallback; never throws into the orbit.
- **store.js** — JSON persistence (`data/state.json`) with debounced flush;
  `markDirty()`.
- **seed.js** — derives the initial state from `src/config.js` so the server
  and the OFFLINE sim start from identical data.
- **github.js** — optional GitHub → board sync. ETag polling with persisted
  etags, rate-limit guard, issues+PRs deduped into `{cards, items}`.
  `mergeReplacement()` preserves `src:'hermes'` rows when GitHub replaces the
  board.
- **hermes.js** — dependency-free HTTP+SSE client for hermes-webui
  (health, sessions, crons, session/new, blocking + streaming chat, approval
  pending/respond, optional password auth cookie). Tolerant of real-instance
  field variance. `startHermesSync` flips `meta.dataSource`.
- **hermes-ingest.js** — reverse ingest: polls sessions/crons, content-hash
  diff skips unchanged payloads (`data/hermes-ingest.json`), and merges onto
  kanban/items/scheduler/alerts. Idempotent additive merge; failing crons raise
  signature-deduped `HERMES` alerts.
- **hermes-contract.js** — operator CLI (`npm run probe`) validating a live
  Hermes WebUI against the bridge contract before enabling it.
- **mock-hermes.js** — standalone test double for hermes-webui
  (port 8787): health, sessions, crons, SSE streaming chat with approval
  events, blocking chat, approval endpoints, optional auth.
- **trace.js** — P12 span tree (`beginTrace` / `childSpan` / `endSpan` /
  `flattenTrace`) with `ms` + token accounting per span. Bounded and
  dependency-free; the orchestrator folds completed spans into the `trace`
  slice and the `events` frame.
- **checkpoints.js** — P10 snapshot + rollback (`captureCheckpoint` capped at
  8, `rollbackToLatest` deep-diffs and restores changed slices, never reverting
  the checkpoint ledger itself).

## Frontend modules

- **store.js** — `STATE` object + `applyServerState(snap)` /
  `applyDelta(updates)`. Every renderer reads from `STATE`; local-only UI state
  (calendar selection) is preserved across server snapshots.
- **api.js** — WebSocket client with auto-reconnect and seq-gap resync,
  `isOnline()` probe, and REST helpers for every mutation
  (`api.approval`, `api.pause`, `api.resume`, `api.captureCheckpoint`,
  `api.rollback`, `api.sendMail`, `api.archiveEmail`, `api.createEvent`, …).
- **channels.js** — P9 typed event channels. Every non-state frame type has a
  named reducer (`events` → fold spans into `STATE.trace`, `approval` → set/
  clear `STATE.approval.pending`, `chat` → hint-only). Unknown frame types are
  ignored so a newer server never crashes an older client.
- **views.js** — one renderer per view; all read `STATE`. In ONLINE mode
  interactions call the API; in OFFLINE mode they mutate `STATE` directly.
  Hermes-sourced entities get a cyan `he` accent (`.kan-card.he`,
  `.cron-row.he`, `.alert-row.he`). Health TRACE strip + reader. Comms
  `SYNC WARN` from `meta.comms.error`. Short pending lock on item/schedule/
  report clicks.
- **main.js** — boot, mission-control rollup renderers, view router, approval
  card wiring, command palette (`Ctrl/Cmd+K`), SNAP/REWIND, keyboard nav,
  and the OFFLINE simulation fallback. Offline chat replies are synthesized
  in-character from `STATE` (persona + vault) instead of canned lines.
  Chat workflows stamp `plan[]` for the mission-pipeline mini-DAG.
- **galaxy.js** — the Three.js background (spiral galaxy, nebula, starfield,
  ringed planets).
- **config.js** — canonical constants + seed data (agents, columns, cards,
  items, schedules, probes, alerts…) plus `HUD_VERSION` for diegetic chrome.

## Realtime protocol (WS)

- `{type:'snapshot', seq, state}` — authoritative full state on connect and on
  client `resync` (does NOT advance `seq`).
- `{type:'delta', seq, updates}` — per-tick diffs of changed top-level slices;
  advances `seq`. Client drops the delta and requests `resync` on a gap.
- `{type:'approval', pending}` / `{type:'approval', pending:null}` — approval
  card visibility changes. Serves both the Hermes delegation bridge and the
  P11 interrupt surface (`pending.tool === 'interrupt'`).
- `{type:'events', events}` — P12 trace span frames; folded client-side into
  `STATE.trace` via the `events` channel.
- `{type:'chat'}` — hint that chat changed; authoritative rows arrive in the
  next delta.
- Server `{type:'ping'}` every ~15s; client replies `{type:'pong'}`. A client
  that misses 3 consecutive pongs is terminated (half-open detection).

While `meta.paused` is set (P11), the server suppresses hint frames
(`chat`/`events`) but keeps `delta`/`ping`/`approval` flowing so connected
HUDs stay consistent and the interrupt card still reaches them.

## Adding a real tool / integration

1. Add an executor to `server/skills.js` (register name/label/description/
   parameters/needsApproval/maxUsageCount/execute).
2. (Optional) Point an agent step at it via the planner's toolset.
3. The skill mutates shared state through its `ctx` (`s`, `log`, `pushChat`,
   `hermes`, `approvalMode`).
4. Add tests in `test/` and run `npm test`.

See `docs/DEVELOPER.md` for the full developer guide and `docs/API.md` for the
complete API + state shape reference.

## Development

```bash
# terminal 1 — orbit server (REST + WS on :3001)
npm run dev:server

# terminal 2 — Vite dev server (:5173, proxies /api and /ws to :3001)
npm run dev

# headless test suite (spawns a fresh hermes mock)
npm test

# validate a live Hermes WebUI against the bridge contract
npm run probe -- --url http://127.0.0.1:8787

# production — build then serve everything from the Express server on :3001
npm run build
npm start

# full demo with the bundled hermes mock (mock :8787 + orbit :3001 + vite :5173)
./scripts/demo.sh
```

## Optional LLM planning

Copy `.env.example` to `.env` and set `USER_LLM_API_KEY`,
`USER_LLM_BASE_URL`, `USER_LLM_MODEL`. `plan()` will ask the model to
decompose operator goals into orchestrated steps. Without a key it uses the
heuristic planner — the harness runs fully offline.
