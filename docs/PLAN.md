# STELLARIS-7 Evolution Plan

Historical plan for Phases 1–10 (shipped in `2.2.0`). P11–P14 also shipped in
`2.2.0`. Post-cut leftovers (screenshot recapture) live in `docs/EVOLUTION.md`.
Operator use: `docs/MANUAL.md`.

Goal: evolve the starship HUD from a working demo into a **premium
multi-agent orchestration harness** — modeled on the research in
`docs/RESEARCH.md` + `docs/ORCHESTRATION-RESEARCH.md` — with every surface
visually verified at production quality.

## Current state (baseline)

- 12-view HUD (Vite SPA) + Node orbit server (Express + WS).
- Server owns state; broadcasts FULL snapshot every 1.5s; JSON persistence.
- Orchestrator heartbeat advances agents/workflows with simulated progress.
- Skills registry is simulated; planner is heuristic + optional LLM.
- No external data sources; vault is static; alerts are static.

## Phases

### Phase 1 — Realtime transport (premium sync)  [DONE]
Model: Supabase Realtime / Phoenix / Socket.IO.
- Server: snapshot on connect + monotonic `seq` + delta batches + `resync`
  request handling + heartbeat/pong + per-client baseline diff.
- Client: auto-reconnect with exponential backoff, resync on reconnect,
  gap detection (`seq` jump → `resync`), versioned `applyServerState`.
- Keep OFFLINE sim fallback untouched.

### Phase 2 — Agent runtime upgrade (real orchestration)  [DONE]
Model: CrewAI / OpenAI Agents / LangGraph.
- Skills registry → typed tool schemas with unique-name validation.
- Agent loop: NextStep union (`finalOutput|handoff|runAgain|interrupt`),
  maxTurns + retry policy, error state instead of spin.
- Lifecycle hooks/emitter (`onRunStart/onToolCall/onToolResult/...`) rewired
  through existing `log/pushChat/broadcast`.
- Supervisor handoffs replace raw `setTimeout` dispatch; workflow advance
  gated on handoff job completion.
- Tool-level activity folded into the authoritative `logs` slice (delta-driven)
  so the HUD animates agent work without hint-only event frames.
- **State shape stays compatible** — no frontend renderer breakage.

### Phase 3 — GitHub integration (real data)  [DONE]
Model: Octokit + DevLake.
- `server/github.js`: ETag + `since` incremental poller, serialized requests,
  per_page 100, rate-limit watch, kanban column mapping.
- Env-driven: `GITHUB_TOKEN`, `GITHUB_OWNER`, `GITHUB_REPO` (user-supplied,
  `.env.example`). No token → seeded demo data + `meta.dataSource:"seed"`.
- Wire into orchestrator: populate `kanban.cards` + `items` from GitHub when
  configured; banner on the HUD shows data source.

### Phase 4 — Vault + alerts become real  [DONE]
- Vault: docs live on canonical state (`body` on each doc). `memory`/`files`
  skills read and write real text; reports generated from vault docs.
- Alerts: condition engine evaluates telemetry/probe thresholds each tick and
  raises/clears real `crit|warn|info` alerts (no longer static).

### Phase 5 — Premium visual pass  [DONE]
Model: eDEX-UI / augmented-ui / Dynamic-SciFi kit / galaxy-explorer.
- CSS: design tokens; clipped panels + corner brackets; scanline + radial
  tint + vignette depth stack; neon glow system; type system (Orbitron /
  Rajdhani / Share Tech Mono + tabular-nums); micro-interactions;
  prefers-reduced-motion.
- Galaxy: UnrealBloom + ACES pipeline; hot-core+halo star shader; vertex
  twinkle; knot-clumped spiral arms; baked nebula; depth fade; camera damping;
  adaptive quality watchdog.
- Chrome: diegetic header + per-view footer data line.

### Phase 6 — Verification & ship  [DONE]
- REST + WS integration tests (`test/integration.test.mjs`) booting a real
  orbit server on an isolated port + data dir: full REST surface (state, chat,
  dispatch, kanban, alerts, email, calendar, mission, approval, malformed
  JSON) and the realtime protocol (snapshot on connect, delta flow, ping/pong,
  resync-on-gap). Wired into `npm test`.
- Headless render of every HUD view body (`test/views.test.mjs`) via a
  dependency-free DOM shim — zero JS errors, container populated per surface,
  plus stream-renderer incremental-append and escapeHtml guards.
- Cleanup batch: removed dead `toggleAgenda`/`requestResync` stubs, folded the
  typed `task:*`/`tool:*` event stream into the authoritative `logs` slice,
  deduped the dispatch seed into `DISPATCH_SEED` in `src/config.js`.
- Hardening: calendar day range validation, LLM planner agent-name validation
  (hallucinated names → ORCHESTRATOR), malformed-JSON 400 handler, and lazy
  galaxy chunk (546 kB → 41 kB initial + async 505 kB).
- OFFLINE-sim regression covered by existing suites + live preview checks.
- Docs, commit, push, preview, report.

### Phase 7 — Chat optimization (agent identity + grounded replies)  [DONE]
Motivation: operator-per-agent evaluation showed only keyword-matched goals
landed on the right agent; there was no mention routing, no conversational
answer, no knowledge grounding, no self-model, and no honest ambiguity path.
- Phase 0: `test/chat.test.mjs` diagnosis harness → 13 checks asserting the
  chat contract (mention routing, answering, grounding, awareness,
  ambiguity). Baselined 11 failures.
- Phase 1: agent identity (`summary` + `capabilities` in `src/config.js`,
  backfilled on boot) + `server/knowledge.js` retrieval layer; `search`/
  `memory` skills grounded in it.
- Phase 2: `server/replies.js` reply synthesis (LLM if keyed, else heuristic)
  → `handleChat` replies with a grounded, in-character answer.
- Phase 3: `@AGENT` mention detection pins plan + reply owner to that agent.
- Phase 4: ambient + offline chat replies drawn from persona/knowledge
  instead of hardcoded banks.
- Phase 5: chat suite wired into `run-all.mjs` (regression guard), docs
  updated, `npm test` + `npm run build` green. Final state: 13/13 PASS.

### Phase 8 — Email + calendar integration  [DONE]
Wire Email/Calendar HUD surfaces to Gmail, Microsoft Graph, ICS, and an
inbound webhook — same contract as GitHub/Hermes: env-driven, seed fallback,
no extra npm deps, orbit never crashes on upstream failure.
- `server/comms.js`: mappers, ICS parse, OAuth refresh, sync loop, `mergeComms`
  (keeps `src:'local'` HUD rows).
- REST: send / archive / inbound / createEvent; `setCalDay` 0–6; id lookup
  with numeric-index fallback.
- HUD: compose, archive, BOOK, 7-day grid, source badges; offline local mutate.
- Skills `mail` (LINK) + `calendar` (NUDGE); heuristic planner steps.
- `test/comms.test.mjs` + integration coverage (suite count at that cut: 16;
  current runner is 19).

IMAP/SMTP stays out. CalDAV write, attachments, and RRULE expansion shipped in
Phase 9.

### Phase 9 — Comms depth (CalDAV write, RRULE, attachments, folders)  [DONE]
Close the Phase 8 follow-ups that fit the existing contract (no extra npm
deps, seed fallback, orbit never crashes). IMAP/SMTP stays out — Gmail +
Graph already cover send/receive.

- ICS `RRULE` expand (DAILY / WEEKLY / MONTHLY + BYDAY / INTERVAL / COUNT / UNTIL) into the displayed week.
- CalDAV PUT/DELETE when `USER_CALDAV_URL` is set; ICS GET remains subscribe-only.
- Attachment metadata on mapped messages; compose may attach small base64 parts (capped).
- Multi-source merge: `auto` fetches every configured provider (Google + Microsoft + ICS) instead of first-wins.
- HUD: inbox/sent/archive tabs, reply-to-selected, week PREV/NEXT, delete event.
- REST: `POST /api/calendar/week`, `POST /api/calendar/events/:id/delete`; send accepts `attachments`.

Still out: raw IMAP/SMTP, multi-login per provider, binary attachment download, EXDATE/RDATE, CalDAV REPORT queries.

### Phase 10 — HUD interactivity (Items, Scheduler, Vault, Reports)  [DONE]
Wire the remaining display-only surfaces the same way as kanban/email: click
to mutate, REST when online, local `STATE` when offline, no extra npm deps.

- Items: click row cycles `open → watch → review → closed`. `POST /api/items/:id/status`.
- Scheduler: click row pauses/resumes seed jobs (`paused` flag). Hermes rows stay ingest-authoritative. `POST /api/schedules/:id/pause`.
- Vault: click card opens a reader pane (`body` on the doc). Skills/`_logMission` write real body text. Selection is HUD-local (like email).
- Reports: click card opens a reader; click status cycles `draft → review → published`. `POST /api/reports/:id/status`.
- Graphs: success sparkline from `hist[].jobs`; `#graph-token-foot` budget
  caption (TOKEN USAGE keeps a dedicated `STREAMING` tag).

Out: GitHub issue write-back, Hermes cron create, orchestration research leftovers.

## Final — Premium repo format & operator docs  [DONE]
- `LICENSE` (MIT), `CODE_OF_CONDUCT.md`, `SECURITY.md`, `.editorconfig`.
- `.github/`: CI workflow (Node 20/22 test+build, Docker build), bug report +
  feature request issue templates, PR template, template `config.yml`.
- `CHANGELOG.md` (Keep a Changelog; current cut is `[2.2.0]`).
- `.env.example` completed with `PORT`, `STELLARIS_DATA_DIR`, `MOCK_PASSWORD`;
  `docker-compose.yml` passes `MOCK_PASSWORD` through.
- README: CI/test badges, docs table + project tree updated for all repo meta
  files, suite count corrected (16); `docs/DEVELOPER.md` + `docs/DEPLOYMENT.md`
  suite counts and env tables corrected; `docs/API.md` documents the
  `telemetry.hist` + `telemetry.jobs` shapes.
- All YAML validated; later cuts grew the suite list to **19** (`cli`,
  `operators`, `vault`). `npm test` + `npm run build` stay green.
- Test isolation fix: `run-all.mjs` now sets a fresh `STELLARIS_DATA_DIR` per
  run and `hermes-ingest.js`/`github.js` persistence respects it — eliminates
  the flake where a live demo orbit server recreated `data/state.json` mid-test
  and poisoned `freshOrchestrator()` seeds.

## Execution order & parallelism

| Batch | Workstreams (parallel) | Owns |
|-------|------------------------|------|
| 1 | A: galaxy premium · B: CSS/HTML chrome · C: GitHub module | `src/galaxy.js` · `src/style.css`+`index.html` · `server/github.js`+`.env.example` |
| 2 | D: server core (realtime + agent runtime) | `server/*` + `src/api.js`+`src/store.js`+`src/main.js` |
| 3 | Wiring (GitHub into orchestrator), integration fixes | orchestrator + index |
| 4 | Verification fleet: API tests, headless 12-view, screenshots | /tmp scripts |
| 5 | Fix pass until premium; docs; commit; push; preview | — |

## Success criteria

- All 12 surfaces render with zero console errors (online + offline).
- Chat dispatch creates real agent workflows (handoff-driven, not timers).
- GitHub mode live when token provided; seed fallback + banner otherwise.
- Vault/alerts driven by real runtime events.
- 60fps galaxy with bloom, twinkling hot-core stars, clumped spiral arms.
- Screenshot-verified premium styling on every view.
- Committed, pushed, preview live.
- Email/Calendar live when a provider is configured; seed inbox/calendar otherwise.

## Remaining (not in this slice)

See `docs/EVOLUTION.md`. P11–P14 shipped in `2.2.0`; leftover is 12-view
screenshot recapture (gallery stays 7 PNGs).

Orchestration research leftovers stay out: server-side channel reducers,
AgentSpec vs AgentRuntime split, parse/execute/reflect tool cycle,
handoffs-as-tools, AsyncLocalStorage traces, WS `Command(resume)`.
Comms still out: raw IMAP/SMTP, multi-login per provider, binary attachment
download, EXDATE/RDATE, CalDAV REPORT.
