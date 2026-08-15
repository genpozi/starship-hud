# STELLARIS-7 // Starship HUD Mission Control

A dynamic, richly animated **starship HUD dashboard** for **multi-agent agentic workflows** and **daily driver** operations. Rendered over a live **3D procedural galaxy** (spiral galaxy, nebula, starfield, ringed planets) built with Three.js.

![stack](https://img.shields.io/badge/stack-Vite%20%2B%20Three.js-00e5ff) ![license](https://img.shields.io/badge/license-MIT-ffb347)

---

## Overview

The dashboard is organized into **12 views**, each a focused screen for a use case. The **Mission Control** view is the rollup of the most important tools and information; every other view is a detailed drill-down of a grouped concern.

| # | View | Purpose |
| --- | --- | --- |
| 1 | **Mission Control** | Rollup — agent fleet, mission pipeline, tool bay, telemetry, comms log, daily driver |
| 2 | **Kanban** | Board with Backlog / In Progress / In Review / Done columns; click a card to advance it |
| 3 | **Open Items** | Issue / PR / task tracker — ID, type, priority, owner, status |
| 4 | **Scheduler** | Cron / recurring job registry — schedule, agent, next run, duration, last result |
| 5 | **Chat** | Agent orchestration console — fleet chat + dispatch console + live command input; `@AGENT` mentions get grounded, in-character replies |
| 6 | **Graphs** | Analytics — token usage, task throughput, context pressure, success rate |
| 7 | **Vault** | Knowledge core — documents, schemas, runbooks with tags |
| 8 | **Email** | Inbox with reading pane — click a row to open the message |
| 9 | **Calendar** | Cycle week grid + selected-day agenda |
| 10 | **Alerts** | Condition monitor — severity summary + alert feed |
| 11 | **System Health** | Subsystem probes + full diagnostic log stream |
| 12 | **Research Reports** | Fleet findings — drafts, reviews, published reports |

---

## Architecture

The HUD is driven by a realtime **orbit server** (Node/Express + WebSocket)
that is the single source of truth for fleet state. The browser mirrors state
over WebSocket and issues mutations via REST. When the server is unreachable
the HUD falls back to an offline simulation so the console never goes dark.

```
Browser (Vite SPA)                Orbit server (Node, port 3001)
┌──────────────────────┐   WS    ┌────────────────────────────────┐
│ src/main.js   boot   │◄───────►│ server/index.js    express + ws │
│ src/store.js  state  │  /ws    │ server/orchestrator.js  engine │
│ src/views.js  views  │  REST   │ server/planner.js   LLM/heuris.│
│ src/api.js    bridge │ /api/*  │ server/skills.js    tool reg.  │
│ src/galaxy.js 3D bg  │         │ server/store.js     persistence│
│ src/config.js seed   │         │ data/state.json                │
└──────────────────────┘         └────────────────────────────────┘
```

See `docs/ARCHITECTURE.md` and `docs/API.md` for details.

## Getting started

```bash
# Install dependencies
npm install

# Terminal 1 — orbit server (REST + WebSocket on :3001)
npm run dev:server

# Terminal 2 — dev server with HMR (:5173, proxies /api and /ws to :3001)
npm run dev

# Production build
npm run build

# Production — build then serve everything from the Express server on :3001
npm start
```

Open the local URL printed by Vite (default `http://localhost:5173`). Use the **left nav rail** to switch views.

> **Optional LLM planning** — copy `.env.example` to `.env` and set
> `USER_LLM_API_KEY`, `USER_LLM_BASE_URL`, `USER_LLM_MODEL`. The chat planner
> will then ask the model to decompose operator goals into orchestrated steps.
> Without a key it uses the deterministic heuristic planner — fully offline.

### Quick start with the Hermes demo (no external services)

```bash
# One command: mock hermes-webui (:8787) + orbit (:3001) + Vite dev (:5173)
./scripts/demo.sh

# Headless validation — 6 test suites (client, ingest, phase-4, github, planner, skills)
npm test

# Validate a live Hermes WebUI against the bridge contract before enabling it
./scripts/probe.sh --url http://127.0.0.1:8787
```

### Optional data sources (operator-supplied creds in `.env`)

| Source | Env vars | Effect |
| --- | --- | --- |
| **GitHub** | `GITHUB_TOKEN`, `GITHUB_OWNER`, `GITHUB_REPO` | Issues + PRs replace the seed board (hermes rows preserved) |
| **Hermes WebUI** | `USER_HERMES_URL`, `USER_HERMES_PASSWORD`, `USER_HERMES_INGEST_MS`, `USER_HERMES_APPROVAL` | Real agent delegation + approval bridge + reverse ingest of sessions/crons |
| **LLM planner** | `USER_LLM_API_KEY`, `USER_LLM_BASE_URL`, `USER_LLM_MODEL` | LLM goal decomposition (heuristic offline fallback) |

Run `npm run probe -- --url <hermes-url>` against a real instance first; see
`docs/HERMES-INTEGRATION.md` (operator runbook) and `docs/DEPLOYMENT.md`.

---

## Documentation

| Doc | What it covers |
| --- | --- |
| `docs/ARCHITECTURE.md` | runtime modes, data flow, module map, WS protocol, adding integrations |
| `docs/API.md` | full REST + WebSocket reference, state shape |
| `docs/DEVELOPER.md` | developer guide — data model, skills, mutations, testing, debugging |
| `docs/HERMES-INTEGRATION.md` | operator runbook for the Hermes bridge + GitHub sync |
| `docs/DEPLOYMENT.md` | Docker, compose, demo/probe, data sources |
| `CONTRIBUTING.md` | commit style, branch/PR flow, review checklist |

## Project structure

```
.
├── index.html            # HUD shell markup + all view containers
├── package.json
├── vite.config.js        # dev server + build config + /api /ws proxy
├── .env.example          # operator credentials (user-supplied, never committed)
├── Dockerfile            # multi-stage, non-root, healthcheck
├── docker-compose.yml    # orbit + optional mock, orbit-data volume
├── CONTRIBUTING.md
├── docs/
│   ├── ARCHITECTURE.md   # runtime modes, data flow, module guide
│   ├── API.md            # REST + WebSocket reference
│   ├── DEVELOPER.md      # developer guide (extend, test, debug)
│   ├── HERMES-INTEGRATION.md
│   └── DEPLOYMENT.md
├── server/               # STELLARIS-7 orbit backend
│   ├── index.js          # express + ws entry point
│   ├── orchestrator.js   # heartbeat engine + all mutations
│   ├── planner.js        # LLM-backed (optional) + heuristic planning
│   ├── knowledge.js      # retrieval layer (vault/reports/cards/...)
│   ├── replies.js        # conversational reply synthesis
│   ├── skills.js         # sandboxed tool registry (incl. hermes skill)
│   ├── store.js          # JSON persistence (data/state.json)
│   ├── seed.js           # seeds state from src/config.js
│   ├── github.js         # optional GitHub → board sync
│   ├── hermes.js         # hermes-webui client + sync loop
│   ├── hermes-ingest.js  # reverse ingest: sessions/crons → board
│   ├── hermes-contract.js# npm run probe — live-WebUI validation
│   └── mock-hermes.js    # hermes-webui test double
├── test/                 # 7 suites + run-all.mjs (spawns fresh mock)
├── scripts/              # demo.sh, probe.sh
└── src/
    ├── main.js           # boot, offline sim fallback, view router
    ├── store.js          # canonical client STATE + server snapshots
    ├── api.js            # WebSocket mirror + REST mutations
    ├── views.js          # renderer for every view (kanban → reports)
    ├── galaxy.js         # Three.js 3D scene (galaxy, nebula, planets, stars)
    ├── style.css         # full HUD theme + animations + per-view styles
    └── config.js         # ⭐ seed data for every dashboard view
```

---

## Customization

All dashboard content lives in `src/config.js`. Edit these exports:

```js
export const SHIP = { name, class, mission, coordinates }
export const AGENTS = [ /* fleet members */ ]
export const WORKFLOWS = [ /* pipelines */ ]
export const TOOLS = [ /* tool bay grid */ ]
export const AGENDA = [ /* daily driver schedule */ ]
export const KANBAN_COLUMNS / KANBAN_CARDS   // kanban view
export const OPEN_ITEMS                       // open items view
export const SCHEDULED_TASKS                  // scheduler view
export const CHAT_SEED                        // chat bootstrap messages
export const VAULT_DOCS                       // vault view
export const EMAILS                           // email view
export const CALENDAR_EVENTS                  // calendar view
export const ALERTS                           // alerts view
export const PROBES                           // system health probes
export const REPORTS                          // research reports
```

- **Agent states** — `active | busy | idle | error` (drives color + animation).
- **Workflow states** — `running | queued | done | failed`.
- **Kanban columns** — edit `KANBAN_COLUMNS` to rename/reorder columns; cards reference `col` by id.
- **Calendar** — events use `day` (0–4 = Mon–Fri), `start`/`end` (24h hours), `type` (`mil`/`dep`).
- **Alerts** — `sev` is `crit | warn | info`; drives the summary cards and feed styling.
- **Reports** — `status` is `draft | review | published`.

The live simulation in `main.js` is the **offline fallback** only. In ONLINE
mode the orbit server owns state: `src/api.js` applies WebSocket snapshots to
`src/store.js`, and interactions (chat dispatch, kanban advance, alert ack,
email read, mission create) mutate the server via REST. Use `api.chat(text)`,
`api.advanceCard(id)`, `pushChat(from, text)`, `log(level, msg)`, …

### Adding a new view

1. Add a `<section id="view-yourname" class="view">` in `index.html`.
2. Add a `<button class="nav-btn" data-view="yourname">` in the nav rail.
3. Write a `renderYourName()` in `src/views.js` and call it in `main.js` `boot()` + refresh loop.

### Theme

Color and motion tokens are CSS custom properties at the top of `src/style.css`:

```css
--line-cyan: #00e5ff;      /* primary accent  */
--line-amber: #ffb347;     /* secondary/warn  */
--ok: #39ff88;             /* good status     */
--crit: #ff4d5e;           /* critical        */
--scan-time: 9s;           /* scanline speed  */
```

The 3D scene parameters (galaxy arm count, particle counts, planet positions, nebula colors) are constants at the top of `src/galaxy.js`.

---

## Design notes

- **HUD panels** — clipped angular corners (`clip-path`), corner brackets, backdrop blur over the 3D scene.
- **View router** — instant panel switching with a fade/scale transition; the 3D galaxy persists behind every view.
- **CRT layer** — scanline overlay + slow moving scan bar for the "live viewport" feel.
- **Motion** — pulsing status dots, flowing warp bar, progress fills, log line entrance, mouse-parallax camera, breathing planet glows, ambient agent chat.
- **Fonts** — Orbitron (display), Rajdhani (UI), Share Tech Mono (data) via Google Fonts, with system fallbacks.

---

## License

MIT
