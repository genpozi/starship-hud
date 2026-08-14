# STELLARIS-7 Developer Guide

Everything you need to extend, test, and debug the mission-control HUD.

- **Architecture overview** → `docs/ARCHITECTURE.md`
- **Full API + state reference** → `docs/API.md`
- **Deployment / runbook** → `docs/DEPLOYMENT.md`
- **Hermes bridge + GitHub sync internals** → `docs/HERMES-INTEGRATION.md`

---

## 1. Repo layout

```
index.html            SPA shell — 12 view containers + nav
src/
  main.js             boot, view router, OFFLINE sim, approval card
  api.js              WebSocket client + REST helpers (isOnline, api.*)
  store.js            STATE + applyServerState/applyDelta, offline defaults
  views.js            one renderer per view + render-gating (changed())
  galaxy.js           Three.js background
  config.js           canonical constants + seed data (shared with server)
  style.css           console styling
server/
  index.js            Express + WS bootstrap, REST routes, env guards
  orchestrator.js     heartbeat engine, mutations, probe alerts, approvals
  planner.js          LLM (if keyed) or heuristic goal decomposition
  skills.js           typed tool registry (search/shell/coder/memory/files/terminal/hermes)
  store.js            debounced JSON persistence (data/state.json)
  seed.js             derives server initial state from src/config.js
  github.js           GitHub → board sync (ETag polling, dedupe, mergeReplacement)
  hermes.js           dependency-free HTTP/SSE hermes-webui client + sync loop
  hermes-ingest.js    reverse ingest: sessions/crons → kanban/items/scheduler/alerts
  hermes-contract.js  npm run probe CLI — live-WebUI contract validation
  mock-hermes.js      standalone test double (hermes-webui API) on :8787/:8788
test/
  run-all.mjs         spawns a fresh mock, runs every suite as a child process
  hermes.test.mjs, hermes-ingest.test.mjs, phase4.test.mjs,
  github.test.mjs, planner.test.mjs, skills.test.mjs
scripts/              demo.sh (mock+orbit+vite), probe.sh (contract check)
Dockerfile            multi-stage, non-root, healthcheck
docker-compose.yml    orbit + optional mock, orbit-data volume
.env.example          canonical operator-credential reference (never commit values)
data/                 runtime state (gitignored): state.json, hermes-ingest.json
```

## 2. Data model

State is one JSON object with top-level **slices**. Slices are the unit of WS
snapshots, deltas, and render-gating. See `docs/API.md` → *State shape* for the
exact fields.

| Slice | Who writes it | HUD view |
|-------|--------------|----------|
| `agents` | heartbeat, dispatch, missions | rollup, health |
| `workflows` | planner/chat, missions, step machine | mission |
| `kanban` | card advance, github/hermes ingest | kanban |
| `items` | github/hermes ingest, dispatches | items |
| `schedules` | heartbeat, hermes ingest | scheduler |
| `chat` | chat handler, skills (`pushChat`) | chat |
| `dispatch` | dispatch handler | mission |
| `alerts` | probe engine, ingest (signature-deduped) | alerts |
| `approval` | approval bridge (`pending`/`history`) | approval card |
| `probes`, `reports`, `telemetry`, `vault`, `email`, `calendar` | heartbeat / mutations | graphs, vault, email, calendar |
| `logs` | every mutation + `this.log(level, msg)` | rollup stream |
| `meta` | bootstrap, github/hermes sync | header (dataSource badge) |

`src` on kanban cards, items, schedules, and alerts is
`seed | github | hermes` and drives the cyan Hermes accent class.

### Sources of truth

- **Server** writes canonical state to `data/state.json` (debounced).
- **Browser** never mutates shared state; it POSTs and applies the broadcast.
- **Offline fallback** clones the config-derived defaults in `store.js` and
  simulates locally so the console never goes dark.

## 3. Server internals

### Orchestrator (`server/orchestrator.js`)

- Owns the `Store`; every mutation ends with `this.store.markDirty()`.
- Heartbeat timers: agent state machine, workflow step machine, telemetry +
  probe values, scheduler, broadcast delta (~1.5s), WS ping (~15s).
- Probe engine: thresholds per probe; sustained breach → alert with signature
  dedup.
- Approval bridge: `_awaitApproval(payload, agent)` sets `s.approval.pending`,
  broadcasts `{type:'approval', pending}`, resolves `approve|deny|timeout` on
  `respondApproval(choice)` or a timeout (`USER_HERMES_APPROVAL_TIMEOUT`).

Add a mutation: implement a method on the `Orchestrator` (mutate `this.s`,
`markDirty()`, optionally `broadcast`), then register the REST route in
`server/index.js`, and add an `api.*` helper in `src/api.js`.

### Skills (`server/skills.js`)

The registry is an array of typed tool definitions. Each entry:

```js
{
  name: 'myTool',
  label: 'My Tool',
  desc: 'One-line description shown to the planner',
  parameters: [{ name, type, required, desc }],
  needsApproval: false,            // prompts the approval bridge before running
  maxUsageCount: 3,
  execute: async ({ s, log, pushChat, hermes, approvalMode, _user }) => ({
    ok: true, text: 'did the thing', tokens: 120
  })
}
```

- Executors receive a `ctx` with `s` (canonical state), `log`, `pushChat`,
  `hermes` (client or `null`), and `approvalMode`.
- The `hermes` skill delegates to the real WebUI through `streamChat` /
  `syncChat`, honors `USER_HERMES_APPROVAL`, and falls back to simulated
  delegation when `USER_HERMES_URL` is unset.
- Add a skill, then point the planner's toolset at it, then cover it in
  `test/skills.test.mjs`.

### Planner (`server/planner.js`)

`plan(goal)` returns sanitized `[{title, agent, tool}]` steps. With
`USER_LLM_API_KEY` it calls the model and JSON-parses; otherwise the
deterministic heuristic engine decomposes common goals. `normalizeSteps`
filters to registered tools so the step machine never runs an unknown tool.

### Hermes client + reverse ingest

- `hermes.js` — `startHermesSync(orchestrator, cfg)` flips `meta.dataSource`
  to `'hermes'` on first healthy poll. Client is dependency-free
  (fetch + SSE parser) and tolerant of real-instance field variance
  (`pick`, `asArray`, `lastMessageContent`, `sessionIdFrom`).
- `hermes-ingest.js` — `toEpochSec` handles epoch s/ms/ISO; content-hash diff
  in `data/hermes-ingest.json` skips unchanged payloads; merge is idempotent
  and additive; failing crons raise signature-deduped `HERMES` alerts;
  `mergeReplacement` preserves `src:'hermes'` rows when GitHub replaces board.
- Validate a live instance before enabling it: `npm run probe`.

### GitHub sync (`server/github.js`)

ETag-polled; issues+PRs deduped into `{cards, items}`; persisted etags and
rate-limit guard; `mergeReplacement()` keeps Hermes rows when swapping the
board source.

## 4. Frontend internals

- **Realtime bridge** (`src/api.js`): connects `wss/ws://<host>/ws`, applies
  snapshots and seq-checked deltas, requests `resync` on gaps, replies to
  `ping` with `pong`, auto-reconnects with backoff. `isOnline()` gates
  interaction: ONLINE mutations hit `api.*`; OFFLINE they mutate `STATE`.
- **Store** (`src/store.js`): `applyServerState(snap)` rebuilds from a server
  snapshot, preserving local-only UI keys; `applyDelta(updates)` merges top
  level slices. All renderers read `STATE`.
- **Render-gating** (`src/views.js`): `changed(name, value)` computes a
  signature per slice; unchanged slices skip DOM rebuilds on idle ticks.
- **View router** (`src/main.js`): nav buttons toggle `.view.active` by id.
- **Approval card** (`src/main.js`): reacts to `{type:'approval', pending}`
  frames, renders the pending request, wires `approve`/`deny` to
  `api.approval(choice)`.
- **Hermes accents**: rows with `src === 'hermes'` get `.he` classes
  (`.kan-card.he`, `.cron-row.he`, `.alert-row.he`) styled cyan.

## 5. Configuration

`.env` (see `.env.example`). Modules activate on presence of their credential:

| Variable | Effect |
|----------|--------|
| `USER_LLM_API_KEY` | real LLM planning (else heuristic) |
| `GITHUB_TOKEN` + `GITHUB_OWNER`/`GITHUB_REPO` | GitHub board sync |
| `USER_HERMES_URL` | Hermes bridge + reverse ingest ACTIVE |
| `USER_HERMES_PASSWORD` | optional HTTP-basic auth to WebUI |
| `USER_HERMES_MODEL` | model label reported in `meta.hermes` |
| `USER_HERMES_POLL_MS` | client health/sessions/crons poll interval |
| `USER_HERMES_INGEST_MS` | reverse-ingest poll interval |
| `USER_HERMES_APPROVAL` | `prompt` (HUD card) \| `always` \| `never` |
| `USER_HERMES_APPROVAL_TIMEOUT` | max ms before an approval times out |

Without any of them the harness runs fully offline with seed data
(`meta.dataSource: 'seed'`).

## 6. Testing

```bash
npm test          # run-all.mjs → fresh mock on :8788 → all 6 suites
npm run probe     # validate a live Hermes WebUI (add --url / --password)
npm run build     # vite build — must stay green
```

- `test/run-all.mjs` spawns a **fresh** mock (deterministic approval parity),
  then runs each suite as its own child with `MOCK_URL` + `USER_HERMES_URL`
  exported. Failures are surfaced per suite; exit code 1 on any red.
- Suites that touch `data/state.json` move it aside and restore it, so they are
  self-isolating.
- New capability ⇒ new suite (or extend an existing one); keep `npm test`
  green and the probe PASSing for the surfaces you touched.

### E2E smoke (scripts)

```bash
./scripts/demo.sh           # mock :8787 + orbit :3001 + vite :5173
./scripts/probe.sh --url http://127.0.0.1:8787
```

## 7. Debugging

- `data/state.json` is the server's canonical snapshot — inspect after
  `npm run dev:server` + interactions.
- Watch logs: orbit prints WARN/INFO; `data/` state and `data/hermes-ingest.json`
  show what was merged.
- WS: check `/api/health` is `ok`, then confirm snapshot/delta/approval frames
  arrive in the browser console (`connect` logs sync/resync events).
- If delta `seq` gaps appear, the client requests a resync automatically —
  frame ordering bugs show up as repeated resyncs.
- When the HUD shows the OFFLINE sim, the WS is failing — verify orbit is up
  on :3001 and the Vite proxy `/ws` is configured.

## 8. Conventions

- ES modules everywhere (`"type": "module"`); no build step for the server.
- JSDoc header block per module; terse comment style; no inline end-of-line
  shell comments in docs.
- Mutations: validate input → mutate `this.s` → `markDirty()` → return
  `{ok:true, ...}`; REST routes return `400` on bad input.
- Keep dependencies zero-extra: the server only uses `express` + `ws`;
  hermes client and probe are dependency-free fetch/SSE.
- Commit small, message-style `type(scope): subject`; never commit operator
  credentials (`.env`, real keys).
