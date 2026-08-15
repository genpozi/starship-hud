# STELLARIS-7 Evolution Plan

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
- Typed event stream (`task:*`, `tool:*`, `interrupt`) broadcast alongside
  state so the HUD can animate agent work.
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
- Vault: filesystem-backed (`data/vault/*.md`); `memory`/`files` skills read
  & write real markdown; reports generated from vault docs.
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

### Phase 6 — Verification & ship  [IN PROGRESS — verified, committing]
- REST + WS integration tests; headless render of all 12 views (zero JS
  errors); interaction tests (chat→mission, kanban, alerts, email, dispatch);
  screenshot suite of every surface; OFFLINE-sim regression check.
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
