# STELLARIS-7 Developer Guide

Version `2.2.0`. Everything you need to extend, test, and debug the mission-control HUD.

- **Operator use manual** → `docs/MANUAL.md`
- **Architecture overview** → `docs/ARCHITECTURE.md`
- **Full API + state reference** → `docs/API.md`
- **Deployment / runbook** → `docs/DEPLOYMENT.md`
- **Hermes bridge + GitHub sync internals** → `docs/HERMES-INTEGRATION.md`
- **Email / calendar adapters** → `docs/COMMS-INTEGRATION.md`

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
  orchestrator.js     heartbeat engine, mutations, probe alerts, approvals,
                      chat mention routing + reply dispatch
  planner.js          LLM (if keyed) or heuristic goal decomposition
  knowledge.js        read-only retrieval over state (vault/reports/cards/...)
  vault.js            filesystem knowledge core (data/vault/*.md + front matter)
  replies.js          conversational reply synthesis (persona + knowledge)
  skills.js           typed tool registry (search/shell/coder/memory/files/terminal/mail/calendar/hermes)
  comms.js            Gmail / Graph / ICS / CalDAV adapters, RRULE, inbound webhook, sync loop
  store.js            debounced JSON persistence (data/state.json)
  seed.js             derives server initial state from src/config.js
  github.js           GitHub → board sync (ETag polling, dedupe, mergeReplacement)
  hermes.js           dependency-free HTTP/SSE hermes-webui client + sync loop
  hermes-ingest.js    reverse ingest: sessions/crons → kanban/items/scheduler/alerts
  hermes-contract.js  npm run probe CLI — live-WebUI contract validation
  mock-hermes.js      standalone test double (hermes-webui API) on :8787/:8788
  cli-config.js       .stellaris.json loader (env wins)
  operators.js        operatorId normalize + default name
bin/stellaris-hud.js  P12 CLI: serve / demo / probe
test/
  run-all.mjs         spawns a fresh mock, runs every suite as a child process
  hermes.test.mjs, hermes-ingest.test.mjs, phase4.test.mjs,
  github.test.mjs, planner.test.mjs, skills.test.mjs, chat.test.mjs,
  comms.test.mjs, cli.test.mjs, operators.test.mjs, vault.test.mjs
scripts/              demo.sh (mock+orbit+vite), probe.sh (contract check)
Dockerfile            multi-stage, non-root, healthcheck
docker-compose.yml    orbit + optional mock, orbit-data volume
.env.example          canonical operator-credential reference (never commit values)
.stellaris.json.example  P12 declarative config (copy to .stellaris.json)
data/                 runtime state (gitignored): state.json, vault/*.md, hermes-ingest.json
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
| `chat` | chat handler, skills (`pushChat`), reply synthesizer | chat |
| `dispatch` | dispatch handler | mission |
| `alerts` | probe engine, ingest (signature-deduped) | alerts |
| `approval` | approval bridge (`pending`/`history`) | approval card |
| `probes`, `reports`, `telemetry`, `vault` | heartbeat / mutations | graphs, vault |
| `email`, `calendar` | comms sync + REST mutations | email, calendar |
| `logs` | every mutation + `this.log(level, msg)` | rollup stream |
| `meta` | bootstrap, github/hermes/comms sync | header (dataSource / comms badge) |

`src` on kanban cards, items, schedules, and alerts is
`seed | github | hermes` and drives the cyan Hermes accent class.
Email/calendar `src` is `seed | google | microsoft | ics | caldav | webhook | local`.

### Chat pipeline (operator → agent reply)

```
POST /api/chat {text}
  → orchestrator.handleChat(text)
      → _detectMention(text)              "@CODA ..." / "CODA, ..." → agent
      → plan(text)                         planner.js keyword/LLM steps
        → steps pinned to the mentioned agent when present
      → workflow + dispatch jobs queued
      → synthesizeReply({goal, agent, steps, state})   replies.js
          persona = agent.summary/capabilities          (identity model)
          hits   = knowledge.retrieve(state, goal)      (grounding)
          LLM mode if USER_LLM_API_KEY, else heuristic
      → pushChat(agent, reply)              the operator's actual answer
  → step machine runs jobs → "Task complete: ..." status lines
```

### Agent identity + knowledge

- `AGENTS` in `src/config.js` carry `summary` (self-description) and
  `capabilities[]` (tool names). `server/replies.js` renders these in reply.
- Persisted state is backfilled with these fields on boot (constructor
  normalization), so pre-identity state rows still answer persona queries.
- `server/knowledge.js` indexes vault docs (including markdown bodies), reports,
  kanban cards, items, schedules, probes, email, and calendar on demand.
  `retrieve(state, query)` → ranked hits;
  `digest(state)` → summary lines. The `search`/`memory` skills ground their
  results in it, and `replies.js` uses it so answers cite real content.
- Offline (browser) chat replies are synthesized in-character from `STATE`
  too, so the sim never falls back to canned lines.

### Sources of truth

- **Server** writes canonical state to `data/state.json` (debounced).
- **Vault** markdown lives in `data/vault/*.md` (P14); skills write the file
  first, then the state row. Boot hydrates files onto `state.vault`.
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
  broadcasts `{type:'approval', pending}`, stamps `owner`, resolves
  `approve|deny|timeout` on `respondApproval(choice)` or a timeout
  (`USER_HERMES_APPROVAL_TIMEOUT`). Foreign operators get `403`. Interrupt
  cards are not resolvable via `/api/approval/respond` (use resume).
- Pause is single-holder (P13): a second operator gets `409` until the holder
  resumes. WS `hello` records `meta.operators[]`; close drops the socket.

Add a mutation: implement a method on the `Orchestrator` (mutate `this.s`,
`markDirty()`, optionally `broadcast`), then register the REST route in
`server/index.js`, and add an `api.*` helper in `src/api.js`. Chat is a
composite mutation: it plans + dispatches + synthesizes a reply — extend
`replies.js` for reply behavior and `knowledge.js` for what agents can ground
answers on.

### Skills (`server/skills.js`)

The registry is an object of typed tool definitions keyed by name. Each entry:

```js
{
  name: 'myTool',
  label: 'My Tool',
  description: 'One-line description shown to the planner',
  parameters: [{ name, type, required, desc }],
  needsApproval: false,            // prompts the approval bridge before running
  maxUsageCount: Infinity,
  execute: async ({ s, log, pushChat, hermes, approvalMode }) => ({
    ok: true
  })
}
```

- Executors receive a `ctx` with `s` (canonical state), `log`, `pushChat`,
  `hermes` (client or `null`), and `approvalMode`.
- `search` and `memory` ground their results through `knowledge.js`
  (`retrieve(ctx.s, query)`) instead of returning fixed numbers.
- The `hermes` skill delegates to the real WebUI through `streamChat` /
  `syncChat`, honors `USER_HERMES_APPROVAL`, and falls back to simulated
  delegation when `USER_HERMES_URL` is unset.
- `mail` and `calendar` dynamically import `server/comms.js`. Without a
  provider they write a local sent-copy / local event (`simulated: true`).
- `memory` / `files` / `hermes` persist vault markdown via `server/vault.js`
  (file first, then state).
- Add a skill, then point the planner's toolset at it, then cover it in
  `test/skills.test.mjs`.

### Replies (`server/replies.js`)

- `synthesizeReply({ goal, agent, steps, state })` → string. Builds the agent
  persona from `state.agents`, retrieves knowledge hits for the goal, then:
  - LLM mode (`USER_LLM_API_KEY`): persona + hits + steps injected into a
    small reply prompt; falls back on any error.
  - Heuristic mode: persona self-description for identity questions, cited
    knowledge hits + plan for actionable goals, and an honest "I'm not sure —
    could you clarify?" for ambiguous ones.
- Never throws. Deterministic in heuristic mode (knowledge hits tie-break by
  source order).

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
  Command palette (`Ctrl/Cmd+K`), `1`–`0` / `[` `]` rail jumps, SNAP/REWIND,
  TODAY, operator chip (`stellaris.operatorId`). Interrupt cards are resume-only.
- **Approval card** (`src/main.js`): reacts to `{type:'approval', pending}`
  frames, renders the pending request, wires `approve`/`deny` to
  `api.approval(choice)`. Does not resolve `pending.tool === 'interrupt'`.
- **Hermes accents**: rows with `src === 'hermes'` get `.he` classes
  (`.kan-card.he`, `.cron-row.he`, `.alert-row.he`) styled cyan.

## 5. Configuration

`.env` (see `.env.example`). Modules activate on presence of their credential:

| Variable | Effect |
|----------|--------|
| `USER_OPERATOR_NAME` | default operator identity when the HUD chip is unset |
| `USER_LLM_API_KEY` | real LLM planning (else heuristic) |
| `GITHUB_TOKEN` + `GITHUB_OWNER`/`GITHUB_REPO` | GitHub board sync |
| `USER_HERMES_URL` | Hermes bridge + reverse ingest ACTIVE |
| `USER_HERMES_PASSWORD` | optional HTTP-basic auth to WebUI |
| `USER_HERMES_MODEL` | model label reported in `meta.hermes` |
| `USER_HERMES_POLL_MS` | client health/sessions/crons poll interval |
| `USER_HERMES_INGEST_MS` | reverse-ingest poll interval |
| `USER_HERMES_APPROVAL` | `prompt` (HUD card) \| `always` \| `never` |
| `USER_HERMES_APPROVAL_TIMEOUT` | max ms before an approval times out |
| `USER_COMMS_EMAIL_PROVIDER` / `USER_COMMS_CALENDAR_PROVIDER` | `auto` \| `google` \| `microsoft` \| `ics` \| `caldav` (calendar). Seed when unset. `auto` concatenates every configured provider. |
| `USER_GOOGLE_*` / `USER_MS_*` / `USER_ICS_*` / `USER_CALDAV_*` | OAuth refresh / ICS subscribe (GET) / CalDAV collection (PUT/DELETE `{uid}.ics`). See `docs/COMMS-INTEGRATION.md`. |
| `USER_COMMS_POLL_MS` | inbox/calendar poll interval (default `120000`) |
| `USER_COMMS_WEBHOOK_SECRET` | optional `X-Stellaris-Secret` for `POST /api/comms/inbound` |
| `PORT` | orbit HTTP/WS port (default `3001`) |
| `STELLARIS_DATA_DIR` | runtime state dir (default `<repo>/data`); isolates `state.json` and `vault/*.md` |

Without any of them the harness runs fully offline with seed data
(`meta.dataSource: 'seed'`).

## 6. Testing

```bash
# run-all.mjs → fresh mock on :8788 → all suites
npm test

# validate a live Hermes WebUI (add --url / --password)
npm run probe

# vite build — must stay green
npm run build
```

- `test/run-all.mjs` spawns a **fresh** mock (deterministic approval parity) and
  sets a fresh `STELLARIS_DATA_DIR` for every suite, so no test ever touches the
  live demo's `data/state.json` (which a running orbit server flushes to
  continuously). Each suite runs as its own child with `MOCK_URL` +
  `USER_HERMES_URL` exported. Failures are surfaced per suite; exit code 1 on
  any red.
- The suites: `hermes`, `hermes-ingest`, `phase4`, `github`, `planner`,
  `skills`, `chat`, `regression`, `views`, `superstep`, `channels`,
  `checkpoints`, `interrupt`, `trace`, `comms`, `cli`, `operators`, `vault`, `integration`, `brand`. `views` headless-renders
  every HUD view via a DOM shim (its `REQUIRED` list plus `renderTrace` guards
  the full slice contract); `superstep` guards the P8 dependency barrier; `channels` guards
  the P9 typed reducers; `checkpoints` guards P10 snapshot/rollback; `interrupt`
  guards P11 hold/resume; `trace` guards the P12 span tree. `integration` boots
  a real orbit server on an isolated port + `STELLARIS_DATA_DIR` and exercises
  the full REST + WebSocket surface.
- Suites that directly construct an `Orchestrator` compute their `STATE_FILE`
  from `STELLARIS_DATA_DIR` when set, otherwise they move `data/state.json`
  aside and restore it — either way they are self-isolating.
- `test/chat.test.mjs` (Phase 0 diagnosis → now a regression guard) asserts the
  chat contract: `@AGENT` mention routing, a grounded conversational answer, and
  honest ambiguity handling. Run standalone with `node test/chat.test.mjs`.
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

## Building the Pages site

The GitHub Pages site is the landing page in `site/` plus the real HUD built
with a derived base path.

```bash
# Build _site/ (landing page + HUD demo + assets)
npm run build:pages

# Serve the built site at http://localhost:4173
npm run preview:pages

# Verify the built site the way Pages serves it (needs global playwright)
NODE_PATH=$(npm root -g) npm run verify:pages
```

The demo is served under `PAGES_BASE` (default `/starship-hud/`). Override it
with `PAGES_BASE=/ npm run build:pages`.

Brand assets and gallery thumbnails are **committed**, not built in CI. To
regenerate them you need a global Playwright:

```bash
npm i -g playwright && npx playwright install chromium
NODE_PATH=$(npm root -g) node scripts/render-brand.mjs
```

`test/brand.test.mjs` fails if `site/tokens.css` drifts from `src/style.css`,
if a suite count goes stale, if the README overclaims, or if a brand asset has
the wrong dimensions.
