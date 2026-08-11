# Hermes WebUI — Integration Analysis & Plan

Date: 2026-08-10 · Status: STEP 1-3 SHIPPED (client, skill, planner); 4-7 PLANNED

Research target: [nesquena/hermes-webui](https://github.com/nesquena/hermes-webui)
Goal: make STELLARIS-7's orchestrator delegate real work to Hermes (and
similar always-on agents) instead of simulated skills.

## 1. Research digest — what hermes-webui actually is

- **Python stdlib HTTP server**, binds `127.0.0.1:8787`, no CORS headers.
  Runs **Hermes Agent in-process** via `AIAgent.run_conversation()`
  (`api/streaming.py`). It is NOT an API in front of an agent loop — the
  WebUI *is* the agent loop.
- **Chat**:
  - `POST /api/chat/start` → `{stream_id}`
  - `GET /api/chat/stream?stream_id=X` → **SSE** events:
    `token` / `tool` / `approval` / `done` / `error`
  - Blocking fallback: `POST /api/chat` (holds until agent finishes)
- **REST**: `/api/sessions`, `/api/session`, `/api/session/new`,
  `/api/session/update`, `/api/session/delete`, `/api/upload`, `/api/list`,
  `/api/file`, `/api/approval/pending`, `/api/approval/respond`,
  `/api/crons/*`, `/api/skills`, `/api/memory`.
- **Approvals**: env-gated (`HERMES_EXEC_ASK`), module-level state shared
  across threads; UIs approve/deny via `POST /api/approval/respond`.
- **MCP server** (`mcp_server.py`): **stdio-only**, 6 tools (project/session
  CRUD). Requires the WebUI Python package; not HTTP-reachable.
- **Gateway path**: `HERMES_WEBUI_CHAT_BACKEND=gateway` routes chat through a
  Hermes Gateway (OpenAI-compatible), but full agent-loop delegation is not
  yet shipped (hermes-webui#1925).
- **State**: sessions `~/.hermes/webui/sessions/*.json`, profiles, skills
  (`SKILL.md`), memory (`MEMORY.md`/`USER.md`), cron jobs, workspaces.

## 2. Integration mapping for STELLARIS-7

The clean seam is **orbit server (Node) → Hermes WebUI (HTTP + SSE)**.

- Frontend cannot call Hermes directly (no CORS) — fits our architecture
  (browser only talks to 5173 → 3001).
- No Python runtime needed in our env: Hermes runs on the operator's server;
  we only talk to it over HTTP.
- Model after the proven GitHub integration pattern (`server/github.js`):
  env-driven config, graceful no-config fallback, `meta.dataSource`.
- Simulated skills stay as fallback when Hermes is unreachable.

## 3. Actionable next steps (ordered)

1. **Hermes client module** — `server/hermes.js`:
   - `health()` → `GET /health`
   - `sessions()` → `GET /api/sessions`
   - `newSession()` → `POST /api/session/new`
   - `syncChat()` → `POST /api/chat` (blocking, first)
   - `streamChat()` → `POST /api/chat/start` + SSE parse of `/api/chat/stream`
   - `approvalStatus()` / `approvalRespond()` → `/api/approval/*`
   - Env config: `USER_HERMES_URL` (default `http://127.0.0.1:8787`),
     `USER_HERMES_PASSWORD`, `USER_HERMES_MODEL`, `USER_HERMES_POLL_MS`
   - Online/offline reflected in `meta.dataSource`.

2. **Real `hermes` skill executor** — extend `server/skills.js` with a
   `hermes` tool whose `execute(ctx)` sends `ctx.params.prompt` to Hermes and
   returns the final response. This is the single change that turns the
   existing step machine (`server/orchestrator.js` `_advanceStep`) into real
   delegation. Keep the simulated fallback when unreachable.

3. **Planner toolset** — add `hermes` to `VALID_TOOLS` + heuristic/LLM
   mappings in `server/planner.js` so goals can map to a hermes step.

4. **Approval bridge** — map Hermes `approval` SSE events to the existing
   interrupt/approval flow; HUD approve/deny → `POST /api/approval/respond`.
   The "premium" UX differentiator.

5. **Reverse ingest (Hermes → STELLARIS)** — poll `GET /api/sessions` +
   `/api/crons` (ETag-style, like GitHub) → feed `kanban` / `items` /
   `alerts`; cron failures become alerts. Skip MCP stdio (Python coupling not
   worth it).

6. **Mock + tests + docs** — `server/mock-hermes.js` implementing `/health`,
   `/api/chat/start`, `/api/chat/stream` (SSE) so all the above is verifiable
   headlessly without installing Hermes. Unit + integration tests
   (skill executes → state reflects result; approval flow; offline fallback).
   Then this doc becomes the operator runbook.

7. **HUD surface** — `SRC: HERMES` dataSource banner, hermes-originated
   alerts/items (reuses existing renderers; no view breakage).

## 4. Recommended cut

Steps 1 + 2 + 6 first: real chat delegation through the existing step
machine, tested against the mock. That proves the architecture end-to-end;
steps 4 and 5 layer on afterwards.

## 6. Implementation status

Shipped (2026-08-10):

- `server/hermes.js` — client: `getConfig`, `createHermesClient` (health /
  listSessions / syncChat / streamChat-SSE / approvalPending / approvalRespond,
  optional password auth cookie, lazy reused session), `startHermesSync`
  status poller that flips `meta.dataSource` to `hermes` and logs link state.
- `server/skills.js` — `hermes` skill: delegates `ctx.params.prompt` (or step
  title) to Hermes via `syncChat`, writes a `DELEGATE` vault doc, returns
  `{delegated, result, tokens}`; graceful simulated fallback when
  unconfigured/unreachable, `{error}` for retry/maxAttempts handling.
- `server/planner.js` — `hermes` added to the tool schema (heuristic research/
  analyze goals gain a "Delegate deep-dive to Hermes" step; LLM prompt updated).
- `server/orchestrator.js` — `_agentCtx` now carries `hermes`, `task`, `step`;
  step machine passes job+step context into skill execution.
- `server/index.js` — `bootstrapHermes()` (self-guarding, mirrors GitHub).
- `server/mock-hermes.js` — standalone test double (port 8787): `/health`,
  `/api/sessions`, `/api/session/new`, `/api/chat/start`, `/api/chat/stream`
  (SSE token/tool/done), blocking `/api/chat`, approvals, `/api/auth/login`.
- `.env.example` — `USER_HERMES_URL/PASSWORD/MODEL/POLL_MS`.

Verified: 16/16 client+skill tests against the mock (incl. SSE parse, offline
fallback, simulated fallback); live E2E via orbit server — a "research and
analyze …" chat produced a 3-step plan, LINK delegated to Hermes
(`hermes: delegated → …`), vault `DELEGATE` doc written, workflow completed
100%, `meta.dataSource = "hermes"`; frontend booted clean (12 views, 0 JS
errors); `npm run build` green.

Stabilization pass (2026-08-11):

- `enabled` now gates on the operator EXPLICITLY setting `USER_HERMES_URL`,
  not on the default URL — a server with no config no longer polls 127.0.0.1
  and flips `dataSource` to `hermes` just because a mock/webui happens to run.
- Chat calls (`syncChat`, `streamChat`, `chat/start`, `chat/stream`) use a
  5-minute `CHAT_TIMEOUT_MS` instead of the 15s fetch timeout, so real
  delegations that run for minutes are no longer aborted mid-flight.
- Bounded growth in the orchestrator: workflows capped at 12 (running ones
  never evicted), terminal dispatch jobs capped at 30, and orphaned
  `_chatWorkflows` tracking dropped with pruned workflows.
- `.env.example` documents the explicit-config activation rule.
- Verified: gating both ways (disabled→seed, enabled→hermes+delegation),
  4/4 protocol checks, phase-4 + hermes suites all pass, 16-mission soak
  held all caps, frontend boot clean.

Remaining (planned): step 4 approval bridge, step 5 reverse ingest, step 7
HUD surface, operator runbook in this doc.

## 5. Constraints & notes

- Credentials come from the operator (`USER_*` env namespace, `.env.example`
  placeholders); never commit real values.
- Cannot install/run Hermes in the agent runtime — the mock is the test seam.
- GitHub remote push requires the operator-supplied PAT while the platform
  credential helper is down.
