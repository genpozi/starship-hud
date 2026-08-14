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
│  src/galaxy.js three.js bg   │           │  server/skills.js    tool registry│
│  src/config.js seed + consts │           │  server/seed.js      seed state   │
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

1. `server/index.js` boots the `Orchestrator`, which loads or seeds state.
2. On connect, each WS client receives a full `{type:'snapshot', seq, state}`
   frame (the authoritative baseline), then `{type:'delta', seq, updates}`
   frames (~1.5s) as the heartbeat mutates agents, workflows, telemetry,
   scheduler, probes, and logs.
3. The browser's `api.js` applies every frame to `STATE` (store.js). A fixed
   render loop re-renders the rollup every 1s and all views every 1.8s.
   Renderers diff slices (`changed(slice, value)`) so idle ticks do not rebuild
   unchanged DOM.
4. Operator interactions (chat, kanban advance, alert ack, approval respond,
   email read, calendar, mission create, manual dispatch) POST to `/api/*`. The
   server mutates canonical state and the next broadcast reflects it back.
5. Optional data sources poll on their own cadence and write onto the same
   board shape: **GitHub** (issues/PRs) replaces the seed board;
   **Hermes WebUI** (sessions/crons) reverse-ingests onto kanban/items/
   scheduler/alerts. `meta.dataSource` tells the HUD which is live.

## Server modules

- **index.js** — HTTP + WS bootstrap; REST route table; `bootstrapGithub()`
  and `bootstrapHermes()` (self-guarding imports); heartbeat + half-open
  detection; serves the built `dist/` in production.
- **orchestrator.js** — the engine. Owns the Store; heartbeat ticks for agents,
  workflows, telemetry/probes, scheduler; the WS broadcast diff; the step
  machine for dispatched jobs; the probe alert condition engine; the operator
  approval bridge (`approval.pending` / `respondApproval`).
- **planner.js** — `plan(goal)` → `[{title, agent, tool}]`. Uses a real LLM
  when `USER_LLM_API_KEY` is set, otherwise the deterministic heuristic engine.
  Output is sanitized (`normalizeSteps`) so the step machine never runs an
  unregistered tool.
- **skills.js** — typed tool registry (`search`, `shell`, `coder`, `memory`,
  `files`, `terminal`, `hermes`). Executors receive a `ctx` (`s`, `log`,
  `pushChat`, `hermes`, `approvalMode`) and mutate shared state. The `hermes`
  skill delegates to a real WebUI through `streamChat`/`syncChat`, handles
  approvals per `USER_HERMES_APPROVAL`, and falls back to simulated delegation.
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

## Frontend modules

- **store.js** — `STATE` object + `applyServerState(snap)` /
  `applyDelta(updates)`. Every renderer reads from `STATE`; local-only UI state
  (calendar selection) is preserved across server snapshots.
- **api.js** — WebSocket client with auto-reconnect and seq-gap resync,
  `isOnline()` probe, and REST helpers for every mutation (`api.approval`).
- **views.js** — one renderer per view; all read `STATE`. In ONLINE mode
  interactions call the API; in OFFLINE mode they mutate `STATE` directly.
  Hermes-sourced entities get a cyan `he` accent (`.kan-card.he`,
  `.cron-row.he`, `.alert-row.he`).
- **main.js** — boot, mission-control rollup renderers, view router, approval
  card wiring, and the OFFLINE simulation fallback.
- **galaxy.js** — the Three.js background (spiral galaxy, nebula, starfield,
  ringed planets).
- **config.js** — canonical constants + seed data (agents, columns, cards,
  items, schedules, probes, alerts…) shared by seed and offline sim.

## Realtime protocol (WS)

- `{type:'snapshot', seq, state}` — authoritative full state on connect and on
  client `resync` (does NOT advance `seq`).
- `{type:'delta', seq, updates}` — per-tick diffs of changed top-level slices;
  advances `seq`. Client drops the delta and requests `resync` on a gap.
- `{type:'approval', pending}` / `{type:'approval', pending:null}` — approval
  card visibility changes from the Hermes delegation bridge.
- Server `{type:'ping'}` every ~15s; client replies `{type:'pong'}`. A client
  that misses 3 consecutive pongs is terminated (half-open detection).

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
