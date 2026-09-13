# STELLARIS-7 — Application Context

Working memory for the HUD, orbit server, and evolution line. Read this before
changing product behavior. Detailed next-phase work lives in `docs/EVOLUTION.md`.

## What this is

A **starship HUD** wrapping a real multi-agent orchestrator. Node/Express +
WebSocket orbit server is the single source of truth. The Vite SPA mirrors
state in 12 views over a 3D galaxy. Offline sim keeps the console alive if
the orbit is down.

**Version:** `2.2.0` (Phase 1–10 shipped; P11–P14 on this branch as
`fa71aa1`). Branch of record: `260909-feat-comms-depth-hud-interact`. PR:
https://github.com/genpozi/starship-hud/pull/2

## Contract (do not break)

- Env-driven live sources; **seed fallback** when credentials are missing.
- **No extra npm runtime deps.** No orbit crash on upstream 4xx/5xx.
- Operator credentials only via `USER_*` / `GITHUB_*` in `.env` (never commit).
- Live email/calendar rows **match HUD seed shapes** so renderers do not branch on source.
- `npm test` (19 suites) and `npm run build` stay green.
- Offline: mutate `STATE` locally. Online: REST, then WS snapshot/delta confirms.

## Surfaces (12)

Mission Control, Kanban, Open Items, Scheduler, Chat, Graphs, Vault, Email,
Calendar, Alerts, System Health, Research Reports.

Click-to-mutate (online REST / offline `STATE`): kanban advance, item status
cycle, scheduler pause (seed only; Hermes `409`), report status cycle, email
compose/archive/reply/folders, calendar BOOK/week/TODAY/delete, alert ACK, chat,
dispatch, pause/resume, SNAP/REWIND, approval. Command palette `Ctrl/Cmd+K`.
Vault/Reports title+tag filter. Compose file chips; WARN over the 200KB cap.
Operator chip (HUD setting + `USER_OPERATOR_NAME`); pause is single-holder.

## Live integrations (operator-supplied)

| Source | Env | Fallback |
| --- | --- | --- |
| GitHub issues/PRs | `GITHUB_TOKEN`, `GITHUB_OWNER`, `GITHUB_REPO` | seed kanban/items |
| Hermes WebUI | `USER_HERMES_URL`, `USER_HERMES_PASSWORD`, … | simulated skill |
| LLM planner | `USER_LLM_*` | heuristic planner |
| Email/calendar | `USER_COMMS_*`, `USER_GOOGLE_*`, `USER_MS_*`, `USER_ICS_*`, `USER_CALDAV_*` | seed inbox/week |

`auto` concatenates every configured comms provider, then `mergeComms`.
`src:'local'` HUD rows survive provider sync. `USER_CALDAV_URL` is writable
(`{uid}.ics` PUT/DELETE); plain `USER_ICS_URL` is GET-only.

## State ownership

- Server: `data/state.json` (or `STELLARIS_DATA_DIR`). Boot-guard checkpoint.
- Browser: `src/store.js` `STATE`. WS snapshot + delta (`seq` gap → resync).
- Vault docs are **markdown files** (`data/vault/{id}.md` + front matter). Skills
  write the file first, then the state row. Boot hydrates files onto `state.vault`.
- Scheduler pause is HUD/REST local. Hermes cron rows stay ingest-authoritative.

## Key files

| Path | Role |
| --- | --- |
| `server/orchestrator.js` | Heartbeat, mutations, chat, control |
| `server/comms.js` | Gmail / Graph / ICS / CalDAV / RRULE / attachments |
| `server/index.js` | Express + `/ws` + REST |
| `src/views.js` | 12 renderers + readers + selection state |
| `src/main.js` | Boot, router, offline sim, chrome |
| `src/api.js` | WS + REST helpers + operatorId |
| `bin/stellaris-hud.js` | P12 CLI (`serve` / `demo` / `probe`) |
| `src/config.js` | Seed + crew + `HUD_VERSION` |
| `server/vault.js` | P14 filesystem vault (`*.md` + front matter) |
| `docs/PLAN.md` | Phases 1–10 DONE (historical) |
| `docs/EVOLUTION.md` | P11–P14 DONE on this branch |
| `docs/API.md` | REST/WS contract |
| `docs/COMMS-INTEGRATION.md` | Provider contract |

## Explicitly out of this product line

IMAP/SMTP, GitHub issue write-back, Hermes cron create, orchestration leftovers
(server reducers, AgentSpec split, handoffs-as-tools, ALS traces, WS
`Command(resume)`), binary attachment download, EXDATE/RDATE, CalDAV REPORT,
per-provider multi-login.

## Run

```bash
npm install
npm run dev:server
npm run dev
```

Orbit `:3001`, Vite `:5173` (proxies `/api` and `/ws`). Preview host allowlist:
`.monkeycode-ai.live`.
