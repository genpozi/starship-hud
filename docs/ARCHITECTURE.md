# STELLARIS-7 Architecture

The HUD is a single-page console that renders fleet state in 12 views. State
has a single source of truth: the **orbit server** (Node/Express + WebSocket).
The browser mirrors state over a WebSocket and issues mutations via REST. If
the server is unreachable the HUD falls back to a self-contained simulation so
the console never goes dark.

```
┌──────────────────────────────┐        ┌───────────────────────────────┐
│  BROWSER (Vite SPA)          │  WS    │  ORBIT SERVER (port 3001)     │
│                              │◄──────►│                               │
│  src/main.js   boot/router   │  /ws   │  server/index.js   express+ws │
│  src/store.js  canonical state│        │  server/orchestrator.js engine│
│  src/views.js  12 renderers  │ REST   │  server/store.js   persistence│
│  src/api.js    ws + rest     │ /api/* │  server/planner.js  LLM/heur. │
│  src/galaxy.js three.js bg   │        │  server/skills.js   tool reg. │
│  src/config.js seed data     │        │  server/seed.js     seed state│
│                              │        │  data/state.json    snapshot  │
└──────────────────────────────┘        └───────────────────────────────┘
```

## Runtime modes

| Mode | When | State owner | Chat planning | Persistence |
|------|------|-------------|---------------|-------------|
| ONLINE | `/ws` connects | orbit server (WS snapshots) | server planner (LLM if keyed, else heuristic) | `data/state.json` |
| OFFLINE | WS fails/unreachable | browser sim in `main.js` | canned local replies | none |

## Data flow

1. `server/index.js` boots the `Orchestrator`, which loads or seeds state.
2. On connect, each WS client receives a full `{type:'state', state}` frame,
   then periodic frames (~1.5s) as the heartbeat mutates agents, workflows,
   telemetry, scheduler, and logs.
3. The browser's `api.js` applies every frame to `STATE` (store.js). A fixed
   render loop re-renders the rollup every 1s and all views every 1.8s.
4. Operator interactions (chat, kanban advance, alert ack, email read,
   calendar, mission create, manual dispatch) POST to `/api/*`. The server
   mutates canonical state and the next broadcast reflects it back.

## Server modules

- **orchestrator.js** — heartbeat engine + all mutation commands. Owns the
  Store; emits `broadcast(msg)` for the WS fan-out.
- **planner.js** — `plan(goal)` returns `[{title, agent, tool}]`. Uses the LLM
  when `USER_LLM_API_KEY` is set, otherwise the heuristic engine. Never fails.
- **skills.js** — sandboxed tool registry (`search`, `shell`, `coder`,
  `memory`, `files`, `terminal`) with simulated executors; extend `executors`
  to bind real integrations.
- **store.js** — JSON persistence (`data/state.json`) with debounced flush.
- **seed.js** — derives the initial state from `src/config.js` so the server
  and the OFFLINE sim start from identical data.

## Frontend modules

- **store.js** — `STATE` object + `applyServerState(snap)`. Every renderer
  reads from `STATE`; local-only UI state (calendar selection) is preserved
  across server snapshots.
- **api.js** — WebSocket client with auto-reconnect, `isOnline()` probe, and
  REST helpers for every mutation.
- **views.js** — one renderer per view. In ONLINE mode interactions call the
  API; in OFFLINE mode they mutate `STATE` directly.
- **main.js** — boot, mission-control rollup renderers, view router, and the
  OFFLINE simulation fallback.

## Adding a real tool / integration

1. Add an executor to `server/skills.js`.
2. (Optional) Point an agent step at it via the planner.
3. The skill mutates shared state through its `ctx` (`log`, `s`, `store`).

## Development

```bash
# terminal 1 — orbit server (REST + WS on :3001)
npm run dev:server

# terminal 2 — Vite dev server (:5173, proxies /api and /ws to :3001)
npm run dev

# production — build then serve everything from the Express server on :3001
npm run build
npm start
```

## Optional LLM planning

Copy `.env.example` to `.env` and set `USER_LLM_API_KEY`,
`USER_LLM_BASE_URL`, `USER_LLM_MODEL`. `plan()` will ask the model to
decompose operator goals into orchestrated steps. Without a key it uses the
heuristic planner — the harness runs fully offline.
