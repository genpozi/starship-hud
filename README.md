# STELLARIS-7 // Starship HUD Mission Control

A dynamic, richly animated **starship HUD dashboard** for **multi-agent agentic workflows** and **daily driver** operations. Rendered over a live **3D procedural galaxy** (spiral galaxy, nebula, starfield, ringed planets) built with Three.js.

![stack](https://img.shields.io/badge/stack-Vite%20%2B%20Three.js-00e5ff) ![license](https://img.shields.io/badge/license-MIT-ffb347)

---

## Overview

This dashboard is a **template / mission control** that rolls up everything an operator needs to supervise a fleet of AI agents and manage their daily workflow:

| Sector | Purpose |
| --- | --- |
| **Agent Fleet** | Live crew manifest — state, current task, token spend, activity progress |
| **Mission Pipeline** | Agentic workflow orchestration — running/queued pipelines, ETA, step progress |
| **Tool Bay** | Quick-launch launcher for all tooling (coder, shell, browser, search, memory, MCP…) |
| **System Telemetry** | Radial gauges — core temp, token budget, latency, context load |
| **Comms Log** | Live event stream (STDIN/STDOUT of the fleet) |
| **Daily Driver** | Operator agenda with milestone/deploy tagging and check-off |
| **Ship Status Bar** | UTC clock, active mission, fleet count, threat level, fuel/warp charge |

Everything is data-driven from a single config file (`src/config.js`) so the template can be re-skinned or repurposed without touching render code.

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

Open the local URL printed by Vite (default `http://localhost:5173`).

---

## Project structure

```
.
├── index.html            # HUD shell markup
├── package.json
├── vite.config.js        # dev server + build config
└── src/
    ├── main.js           # boot + live simulation + DOM render loop
    ├── galaxy.js         # Three.js 3D scene (galaxy, nebula, planets, stars)
    ├── style.css         # full HUD theme + animations
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
```

- **Agent states** — `active | busy | idle | error` (drives color + animation).
- **Workflow states** — `running | queued | done | failed`.
- **Tool status** — `ok | warn` (dot in the top-right of each tile).
- **Agenda tags** — `mil` (milestone, green) or `dep` (deploy, amber).

The live simulation in `main.js` advances progress/telemetry on a timer. Replace it with real data by calling the renderers directly (`renderAgents()`, `renderWorkflows()`, `log(level, msg)`, …).

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
- **CRT layer** — scanline overlay + a slow moving scan bar for the "live viewport" feel.
- **Motion** — pulsing status dots, flowing warp bar, progress fills, log line entrance, mouse-parallax on the camera, slow galaxy rotation, breathing planet glows.
- **Fonts** — Orbitron (display), Rajdhani (UI), Share Tech Mono (data) via Google Fonts, with system fallbacks.

---

## License

MIT
