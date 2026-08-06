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
| 5 | **Chat** | Agent orchestration console — fleet chat + dispatch console + live command input |
| 6 | **Graphs** | Analytics — token usage, task throughput, context pressure, success rate |
| 7 | **Vault** | Knowledge core — documents, schemas, runbooks with tags |
| 8 | **Email** | Inbox with reading pane — click a row to open the message |
| 9 | **Calendar** | Cycle week grid + selected-day agenda |
| 10 | **Alerts** | Condition monitor — severity summary + alert feed |
| 11 | **System Health** | Subsystem probes + full diagnostic log stream |
| 12 | **Research Reports** | Fleet findings — drafts, reviews, published reports |

---

## Getting started

```bash
# Install dependencies
npm install

# Start the dev server (HMR)
npm run dev

# Production build
npm run build

# Preview the production build
npm run preview
```

Open the local URL printed by Vite (default `http://localhost:5173`). Use the **left nav rail** to switch views.

---

## Project structure

```
.
├── index.html            # HUD shell markup + all view containers
├── package.json
├── vite.config.js        # dev server + build config
└── src/
    ├── main.js           # boot, live simulation, view router
    ├── views.js          # renderer for every view (kanban → reports)
    ├── galaxy.js         # Three.js 3D scene (galaxy, nebula, planets, stars)
    ├── style.css         # full HUD theme + animations + per-view styles
    └── config.js         # ⭐ single source of truth for all dashboard data
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

The live simulation in `main.js` advances progress/telemetry on timers. Replace it with real data by calling renderers directly (`renderAgents()`, `renderKanban()`, `pushChat(from, text)`, `log(level, msg)`, …).

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
