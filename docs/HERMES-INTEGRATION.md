# Hermes WebUI — Integration Analysis & Plan

Date: 2026-08-12 · Status: STEP 1-5 SHIPPED (client, skill, planner, approval bridge, reverse ingest); 7 PLANNED

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

Remaining (planned): step 7 HUD surface, operator runbook in this doc.

## 6c. Step 5 — reverse ingest (shipped 2026-08-12)

Poll the running Hermes WebUI and merge real agent activity onto the existing
HUD surfaces (same shapes the seed / GitHub sync produce — zero frontend
changes). `server/hermes-ingest.js`:

- **sessions → kanban cards + items** — each session becomes a card
  `he-<session_id>` (`src:'hermes'`, agent `HERMES`, tags `HERMES/SESSION`) and
  an items row (`type:'SESSION'`). Column derives from session state
  (archived → `done`, pinned or recently active → `doing`, else `backlog`);
  priority from `message_count`. **Upsert only — never auto-removes**, so the
  operator keeps full control: advancing a card off the board removes it.
- **crons → scheduler** — each cron becomes a row `he-<cron_id>`
  (`src:'hermes'`); `status` maps to `OK/WARN/FAIL`, `next_run` → next label.
  Upsert only. The orchestrator scheduler emulator now **skips `src:'hermes'`
  rows** so it never overwrites authoritative upstream status.
- **cron failures → alerts** — a cron whose status is `failed`/`warn` raises an
  alert (`source:'HERMES'`, `sev:'warn'`, detail from the last history entry).
  Dedup by `sig` (`id + status + last_run`): an identical failure is never
  re-raised after ack; a genuinely new failure (new `last_run`) raises a fresh
  alert.
- **Change detection** — content-hash diffing (sha1 of the fetched bodies)
  persisted to `data/hermes-ingest.json`; an unchanged payload skips the merge
  entirely (ETag-style intent without depending on the upstream honoring 304s).
- **Coexistence with GitHub** — `github.js` gained `mergeReplacement()`, so its
  full-board replacement preserves `src:'hermes'` cards/items; `meta.dataSource`
  only flips to `hermes` when GitHub is not the board source.
- Config: `USER_HERMES_INGEST_MS` (default 60s); gated on `USER_HERMES_URL`.
- Mock: `GET /api/crons` (3 stable crons incl. one `failed`), 4 pre-seeded
  sessions on `GET /api/sessions` with `pinned`/`archived`/`updated_at`.

Verified: 36/36 unit tests (merge idempotency + update semantics, alert
raise/dedup/re-raise, live-mock `syncHermesState` incl. content-hash skip,
scheduler guard, `mergeReplacement` preservation); E2E — HUD shows the
`he-` kanban cards, `HERMES` scheduler rows and `HERMES` alert, advancing a
`he-` card works, acking the `HERMES` alert works, zero JS errors across all
views; `npm run build` green.

## 6b. Step 4 — approval bridge (shipped 2026-08-12)

Map Hermes `approval` SSE events to a HUD approval card; operator approve/deny
flows back to Hermes via `POST /api/approval/respond`.

- `server/orchestrator.js` — new `approval: { pending, history }` state slice
  (surfaced in server seed, snapshots, and the client store); `_awaitApproval
  (payload, agent)` blocks the skill step while surfacing the card + WARN log
  + `{type:'approval'}` broadcast; a 500ms poller resolves on the operator's
  choice (`approve` | `deny` | `timeout`, timeout defaults to approve so long
  delegations aren't stuck); `respondApproval(choice)` writes the operator's
  choice for the awaiting step; history capped at 20. `approvalTimeoutMs`
  configurable via `USER_HERMES_APPROVAL_TIMEOUT` (default 120s).
- `server/skills.js` — the `hermes` skill now delegates through `streamChat`
  with an `onApproval` handler driven by `USER_HERMES_APPROVAL`:
  `always` → respond `always` immediately, `never` → respond `never`,
  `prompt` (default) → `ctx.awaitApproval(data)` then respond `once` (approve)
  or `never` (deny); falls back to `syncChat` on stream failure.
- `server/hermes.js` — `getConfig()` exposes `approvalMode`.
- `server/index.js` — `POST /api/approval/respond` (`{choice}`), 400 on
  anything other than `approve|deny`.
- `server/mock-hermes.js` — stream emits an `approval` event on alternating
  calls and holds the SSE stream open until the pending request is responded
  to, then emits tool + done.
- Frontend — `#approval-card` (amber-blink) above `.chat-input`;
  `renderApproval()` in `src/views.js`; APPROVE/DENY bindings in `src/main.js`;
  `api.approval(choice)` in `src/api.js`. Card is signature-gated through the
  existing delta pipeline, so idle ticks never rebuild it.
- `.env.example` — `USER_HERMES_APPROVAL` (`always|never|prompt`),
  `USER_HERMES_APPROVAL_TIMEOUT`.

Verified: 25/25 client+skill+orchestrator tests against the mock (approval
callback, orchestrator bridge resolve/clear/history, respond-route guard,
offline/simulated fallback); E2E against the orbit server — chat goal → hermes
step → approval card appears → APPROVE (and separately DENY) → stream
completes → card hides → workflow 100% → vault `DELEGATE` doc written →
`approval.history` records the choice; non-approval parity run completes with
no card; 12-view sweep + interaction suite zero JS errors; `npm run build`
green.

## 5. Constraints & notes

- Credentials come from the operator (`USER_*` env namespace, `.env.example`
  placeholders); never commit real values.
- Cannot install/run Hermes in the agent runtime — the mock is the test seam.
- GitHub remote push requires the operator-supplied PAT while the platform
  credential helper is down.
