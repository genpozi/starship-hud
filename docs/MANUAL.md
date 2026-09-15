# STELLARIS-7 Operator Manual

Version `2.2.0` (tag `2.2.0`, `master` `fc614af`). This is the day-to-day
guide for running the HUD. Architecture and REST live in `docs/ARCHITECTURE.md`
and `docs/API.md`. Hermes-specific wiring is in `docs/HERMES-INTEGRATION.md`.
Email/calendar adapters are in `docs/COMMS-INTEGRATION.md`.

STELLARIS-7 is a **starship HUD around a real multi-agent orchestrator**. A
Node/Express + WebSocket **orbit server** owns fleet state. The Vite SPA
mirrors it in 12 views over a 3D galaxy. If orbit is down, an offline sim
keeps the console alive.

Contract: env-driven live sources, **seed fallback**, no extra npm runtime
deps, orbit never crashes on upstream 4xx/5xx. Credentials stay in `.env` or
`.stellaris.json` (never committed). Env wins over JSON.

---

## 1. Quick start

Requires **Node.js 20+**. Nothing else is required for the seed experience.

```bash
npm install
```

```bash
npm run dev:server
```

```bash
npm run dev
```

Open the URL Vite prints (default `http://localhost:5173`). Orbit is `:3001`.
Vite proxies `/api` and `/ws`.

One-command demo (mock Hermes `:8787` + orbit `:3001` + Vite `:5173`):

```bash
./scripts/demo.sh
```

Production (Express serves `dist/` + API + WS on `:3001`):

```bash
npm run build
```

```bash
npm start
```

Packaged CLI (loads `.stellaris.json` from cwd, then the repo; env still wins):

```bash
npx stellaris-hud serve
```

```bash
npx stellaris-hud demo
```

```bash
npx stellaris-hud probe --url http://127.0.0.1:8787
```

Copy `.env.example` to `.env` and/or `.stellaris.json.example` to
`.stellaris.json`. Empty env keys are filled from JSON. Never commit either
file.

---

## 2. Chrome

### Top bar

| Control | What it does |
| --- | --- |
| Ship name / class | Diegetic identity from `src/config.js` `SHIP` |
| UTC clock | Zulu time |
| ACTIVE MISSION | `meta.mission` |
| ACTIVE VIEW | Current left-rail view |
| Status line | `ALL SYSTEMS NOMINAL` plus `SRC: HERMES` / `SRC: GITHUB` when a board source is live |
| `v2.2.0` | Bound to `HUD_VERSION` |
| OP chip | Operator identity. Stored in `localStorage` (`stellaris.operatorId`). Default `USER_OPERATOR_NAME` |
| SNAP | Capture a full-state checkpoint (`POST /api/checkpoint`, reason `hud`). Online only |
| REWIND | Restore the latest checkpoint (`POST /api/checkpoint/rollback`). Online only |
| PAUSE | Single-holder interrupt. In-flight steps finish; dispatch pickup stops. Second operator gets `409` until the holder resumes |

Offline SNAP/REWIND log `WARN` and do not mutate disk.

### Left rail (12 views)

Mission, Kanban, Items, Scheduler, Chat, Graphs, Vault, Email, Calendar,
Alerts, Health, Reports.

### Command palette

`Ctrl/Cmd+K` opens the palette. Type to filter. Enter runs the highlighted
row. Esc / click the backdrop closes it.

Palette commands: jump to any view, PAUSE / RESUME, SNAP, REWIND, ACK ALL
ALERTS, CALENDAR TODAY, COMPOSE EMAIL.

### Keyboard

Ignored while focus is in an input, textarea, or the palette.

| Key | Action |
| --- | --- |
| `Ctrl/Cmd+K` | Toggle palette |
| `1`–`9` | Jump views 1–9 (Mission … Calendar) |
| `0` | Jump Alerts (10th view) |
| `[` / `]` | Previous / next rail view (wraps, includes Health and Reports) |
| `Esc` | Close palette |
| `R` | Reply to the selected email (opens Email and fills compose) |

`prefers-reduced-motion` is respected.

---

## 3. Online vs offline

| Mode | When | Mutations |
| --- | --- | --- |
| ONLINE | `/ws` connected | REST, then WS snapshot/delta confirms |
| OFFLINE | WS down | Local `STATE` only. Console never goes dark |

Reconnect uses exponential backoff. A `seq` gap on a delta triggers `resync`
(full snapshot). Server pings every ~15s; three missed pongs drop the socket.

WS `hello` sends `{type:'hello', operatorId, name?}`. Roster is
`meta.operators[]`. Socket close is `goodbye`.

---

## 4. Crew and chat

Six agents: **ORCHESTRATOR** (planner), **CODA** (engineer), **PILOT**
(release), **SAGE** (research), **LINK** (comms / Hermes), **NUDGE**
(schedule).

Type a goal in Chat and Send. The planner decomposes it into steps with
`dependsOn` (superstep DAG). A synthesized, vault-grounded reply appears
immediately; steps then run through the tool registry.

`@CODA …` or `CODA, …` pins the plan and the reply to that agent.

Dispatch console (Chat side panel) queues a single task for one agent.

Without `USER_LLM_API_KEY` the planner and replies are deterministic
heuristics. With a key they call an OpenAI-compatible endpoint
(`USER_LLM_BASE_URL`, `USER_LLM_MODEL`). Failures fall back to heuristic —
orbit does not crash.

### Approvals

Tools that need a human (Hermes `prompt` mode) raise an amber card above the
chat input: APPROVE / DENY.

- Routed to the run **owner**. A foreign operator gets `403`.
- Unanswered cards auto-approve after `USER_HERMES_APPROVAL_TIMEOUT`
  (default 120s).
- Interrupt cards (`pending.tool === 'interrupt'`) are **not** resolved by
  APPROVE/DENY. Use PAUSE's resume (`POST /api/control/resume`).

`USER_HERMES_APPROVAL=always` / `never` skip the card.

### Pause

PAUSE is a single holder. The holder resumes. Everyone else sees `409` until
then. Hermes cron rows stay ingest-authoritative; pause does not rewrite them.

---

## 5. The 12 views

Clicks mutate via REST when online, `STATE` when offline. Item / schedule /
report clicks take a short pending lock (~400ms) so double-clicks cannot race
the next WS delta.

### Mission Control

Rollup: agent fleet, comms log, mission pipeline (mini-DAG from `plan[]` on
chat workflows), tool bay, telemetry gauges, daily agenda. Read-mostly.

### Kanban

Click a card to advance: BACKLOG → IN PROGRESS → IN REVIEW → DONE (then
removed). Cyan `he` accent on `src:'hermes'` cards.

### Open Items

Click a row to cycle status: `open → watch → review → closed`.

### Scheduler

Click a **seed** job to pause/resume. Hermes ingest rows (`src:'hermes'`)
return `409` — they are upstream-authoritative. Paused seed jobs show HOLD.

### Chat

Fleet log, approval card, compose, dispatch. See §4.

### Graphs

TOKEN USAGE sparkline plots `token` (not CTX). CONTEXT PRESSURE plots
`ctxSeries`. Success sparkline uses `hist[].jobs`. STREAMING tag + BUDGET
caption.

### Vault

Markdown knowledge core. Filter by title or tag (`#vault-filter`). Click a
doc to open the reader.

On disk: `data/vault/{id}.md` + front matter. Skills and mission reports write
the **file first**, then the state row. Boot `hydrateVault()` overlays files
onto `state.vault` (files win on matching ids; file-only docs prepend). Cap
30. `STELLARIS_DATA_DIR` relocates both `state.json` and `vault/`.

HUD shape is unchanged: `id`, `title`, `type`, `tags`, `size`, `updated`,
`agent`, `body`.

### Email

Folder tabs: inbox / sent / archive. Click a message to read. REPLY fills
compose. ARCHIVE moves to `folder:'archive'` (best-effort remote). Compose
accepts To / Subject / Body plus a file picker. Attachments are base64 parts
capped at **~200KB**; oversize files are dropped and a WARN is logged. Chips
show selected files.

`SYNC WARN` appears when `meta.comms.error` or email `_errors` is set. Empty
folders show a hint, not a blank table.

`src` on rows: `seed | google | microsoft | webhook | local`. `src:'local'`
rows survive provider sync (`mergeComms`).

### Calendar

7-day grid relative to `weekStart` (Sunday). PREV / NEXT shift weeks. TODAY
snaps to this Sunday. Click a day to select. BOOK / create form posts
`{title, day, start, end}`. Click an event to select; delete is best-effort
remote.

ICS `RRULE` (DAILY / WEEKLY / MONTHLY with `INTERVAL`, `BYDAY`, `COUNT`,
`UNTIL`) expands into the displayed week. Google/Graph already send instances.

`USER_CALDAV_URL` is writable (`PUT`/`DELETE` `{uid}.ics`). Plain
`USER_ICS_URL` is GET-only.

`src`: `seed | google | microsoft | ics | caldav | local`.

### Alerts

Click a row to ACK. ACK ALL acknowledges every active alert. Hermes failing
crons raise signature-deduped `HERMES` alerts.

### System Health

Probe gauges, diagnostic log (ALL / INFO / WARN / OK chips), TRACE strip
(last spans: name, ms, tokens, ok/fail) + span reader.

### Research Reports

Filter by title or tag. Click a card to read. Click the status chip to cycle
`draft → review → published`.

---

## 6. Optional live sources

No credentials → seed data. Configured + healthy → live rows on the **same
HUD shapes**. Upstream failure → last-known state, orbit stays up.

| Source | Env | What you see |
| --- | --- | --- |
| GitHub | `GITHUB_TOKEN`, `GITHUB_OWNER`, `GITHUB_REPO` | Issues + PRs on kanban/items. ETag poll. `mergeReplacement` keeps Hermes rows |
| Hermes WebUI | `USER_HERMES_URL` (must be set explicitly) | Delegation + approval + reverse ingest of sessions/crons. Probe first |
| LLM planner | `USER_LLM_API_KEY`, `USER_LLM_BASE_URL`, `USER_LLM_MODEL` | Goal decomposition + reply synthesis. Heuristic fallback |
| Email / calendar | `USER_COMMS_*`, `USER_GOOGLE_*`, `USER_MS_*`, `USER_ICS_*`, `USER_CALDAV_*` | Inbox + week. `auto` concatenates every configured provider then `mergeComms` |

Before enabling Hermes:

```bash
npm run probe -- --url http://127.0.0.1:8787
```

PASS = safe to set `USER_HERMES_URL`. WARN = mapping caveat. FAIL = fix the
instance. Full operator notes: `docs/HERMES-INTEGRATION.md` (Step 7 runbook).

Comms provider matrix and OAuth refresh tokens: `docs/COMMS-INTEGRATION.md`.
Inbound mail without IMAP:

```bash
curl -X POST http://localhost:3001/api/comms/inbound \
  -H 'Content-Type: application/json' \
  -H 'X-Stellaris-Secret: YOUR_SECRET' \
  -d '{"from":"ops@example.com","subject":"ping","body":"hello"}'
```

`USER_COMMS_WEBHOOK_SECRET` is optional; when set, the header must match.

---

## 7. Operator identity and multi-session

- HUD OP chip is the session identity. It is sent as `X-Stellaris-Operator`
  and as `operatorId` on chat / dispatch / pause / approval bodies.
- `USER_OPERATOR_NAME` is the server default when a session has not set a chip.
- Pause is **one holder**. Approvals go to the run owner (`403` otherwise).
- There is no in-app OAuth and no per-provider multi-login.

---

## 8. Persistence

| Path | Role |
| --- | --- |
| `data/state.json` | Canonical runtime snapshot (debounced). Self-heals from seed if corrupt |
| `data/vault/*.md` | Knowledge core. File first, then state |
| `data/hermes-ingest.json` | Content-hash cursor for Hermes reverse ingest |
| `data/github-etags.json` | GitHub ETags |
| Checkpoints | In-state ledger, cap 8, plus a boot-guard snapshot every start |

Override the directory with `STELLARIS_DATA_DIR` (tests and parallel
instances). All of `data/` is gitignored.

Backup `data/` before upgrades.

---

## 9. Docker

```bash
docker compose up -d --build orbit
```

Named volume `orbit-data` → `/app/data`. Healthcheck hits `/api/health`.

The `mock` service is the bundled hermes-webui test double on `:8787`. Use it
for demos, not with a real WebUI.

Compose passes GitHub, Hermes, and LLM env from the host `.env`. Comms /
CalDAV / operator name are read from the container environment if you export
them; they are not all listed in `docker-compose.yml` by default — prefer a
host `.env` and extend compose if you need those adapters in the image.

The image runs as non-root `node`. Put any public bind behind TLS + auth.
Orbit binds the process port (`PORT`, default 3001).

---

## 10. Troubleshooting

| Symptom | Check |
| --- | --- |
| HUD shows OFFLINE sim | Orbit on `:3001`? Vite `/ws` proxy? `/api/health` → `{ok:true}` |
| Repeated resyncs | Delta `seq` gaps — inspect WS frames; client resyncs automatically |
| SNAP/REWIND no-op | Offline. Link orbit first |
| Second PAUSE fails | Single-holder. Holder must resume (`409`) |
| Approval DENY/APPROVE fails with `403` | You are not the run owner. Match the OP chip |
| Interrupt card ignores APPROVE | Use resume, not `/api/approval/respond` |
| Empty inbox / no events | Seed is empty for that folder/week, or provider not configured. `SYNC WARN` means upstream error |
| Attachment missing | File exceeded ~200KB; WARN in the comms log |
| No `he-` kanban cards | `USER_HERMES_URL` must be set; WebUI up; `data/hermes-ingest.json` written |
| Scheduler click does nothing on a cyan row | Hermes cron — `409` by design |
| Vault doc missing after restart | File lives under `STELLARIS_DATA_DIR` / `data/vault/`. Hydrate is file-wins |
| Planner ignores the LLM | `USER_LLM_API_KEY` empty or the endpoint failed; heuristic is the fallback |
| `.stellaris.json` ignored | Env key is set (even empty-string handling: env wins when present). Check cwd vs repo root |

Logs: orbit stdout (INFO/WARN), `data/state.json`, `data/hermes-ingest.json`.

---

## 11. What this product does not do

IMAP/SMTP, GitHub issue write-back, Hermes cron create, binary attachment
download, EXDATE/RDATE, CalDAV REPORT, per-provider multi-login, in-app OAuth,
plugin system, server-side channel reducers, AgentSpec split, handoffs-as-tools,
ALS traces, WS `Command(resume)`.

---

## 12. Further reading

| Doc | Audience |
| --- | --- |
| `README.md` | Project overview + screenshots |
| `docs/CONTEXT.md` | Working memory / contract |
| `docs/API.md` | REST + WebSocket + state shape |
| `docs/ARCHITECTURE.md` | Runtime, modules, protocol |
| `docs/DEVELOPER.md` | Extending skills, tests, debugging |
| `docs/DEPLOYMENT.md` | Probe, Docker, data sources |
| `docs/HERMES-INTEGRATION.md` | Hermes bridge + reverse ingest |
| `docs/COMMS-INTEGRATION.md` | Gmail / Graph / ICS / CalDAV |
| `docs/EVOLUTION.md` | Post-2.2.0 leftovers (screenshot recapture) |
| `CHANGELOG.md` | Version history |
