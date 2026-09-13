# Changelog

All notable changes to STELLARIS-7 are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **P11 HUD power** — command palette (`Ctrl/Cmd+K`), keyboard nav (`1`–`0`,
  `[` `]`), SNAP/REWIND on the topbar, Health TRACE strip + reader, calendar
  TODAY, workflow mini-DAG from `plan[]`. Docs: `docs/CONTEXT.md`,
  `docs/EVOLUTION.md`.
- **P11.5 knowledge + compose UX** — Vault/Reports title+tag filter, compose
  file chips, WARN log when an attachment exceeds the 200KB cap.
- **P12 operator packaging** — `bin/stellaris-hud.js` (`serve` / `demo` /
  `probe`); `.stellaris.json` mirrors `.env.example` (env still wins).
- **P13 multi-operator** — `meta.operators[]`, WS `hello` with `operatorId`,
  approval routes to the run owner, pause is single-holder (`409`).
- **P14 filesystem vault** — `data/vault/*.md` + front matter; skills and
  mission reports write the file first, then state. Boot hydrates files onto
  `state.vault`. Isolated via `STELLARIS_DATA_DIR`.

### Changed

- Docs honesty pass: vault is `data/vault/*.md`, 19 suites, CalDAV `src`,
  WS `hello`/`goodbye`, interrupt cards resume-only, `.stellaris.json`
  never committed.

### Fixed

- TOKEN USAGE sparkline now plots `token` (was CTX). Topbar version chrome
  binds to `HUD_VERSION` (`2.2.0`). Comms `SYNC WARN` badge. Empty-state
  hints. Short pending lock on item/schedule/report clicks.

## [2.2.0] — 2026-09-09

### Added

- **Comms depth (Phase 9)** — CalDAV PUT/DELETE via `USER_CALDAV_URL`, ICS
  `RRULE` expand into the displayed week, multi-source inbox/calendar merge,
  attachment metadata + capped compose parts. HUD folder tabs, reply, week
  PREV/NEXT, event delete, and a compose file picker (~200KB cap). REST:
  `POST /api/calendar/week`, `POST /api/calendar/events/:id/delete`;
  `/api/email/send` accepts `attachments`.
- **HUD interactivity (Phase 10)** — Items cycle status, scheduler pause/resume
  (seed jobs only), vault/report reader panes, report status cycle. REST:
  `POST /api/items/:id/status`, `POST /api/schedules/:id/pause`,
  `POST /api/reports/:id/status`. Graphs success sparkline from `hist[].jobs`;
  TOKEN USAGE keeps a dedicated `STREAMING` tag plus a budget caption.

## [2.1.0] — 2026-09-08

### Added

- **Email + calendar integration** — Gmail API, Microsoft Graph, ICS subscribe,
  and `POST /api/comms/inbound` webhook. Seed inbox/calendar when no provider
  is configured; live rows keep the HUD seed shape. Compose, archive, and BOOK
  are wired in the HUD; `mail` (LINK) and `calendar` (NUDGE) skills degrade to
  a simulated local sent-copy / local event. `src:'local'` HUD rows survive
  provider sync (`mergeComms`). See `docs/COMMS-INTEGRATION.md`.
- **Superstep DAG (P8)** — planner steps now emit `dependsOn` chains; queued
  dispatch jobs carry them, and pickup is gated until every dependency has
  completed, so workflows run in proper supersteps instead of all-in-parallel.
- **Typed event channels + reducers (P9)** — non-state frames (trace spans,
  approvals, chat hints) are folded client-side through named reducers in
  `src/channels.js`; unknown frame types are ignored so a newer server never
  crashes an older client.
- **Checkpoints + rollback (P10)** — boot guard snapshots the loaded state;
  `POST /api/checkpoint` captures and `POST /api/checkpoint/rollback` restores
  (capped ledger of 8, reverted slices tagged in `meta.lastRollback`).
- **Interrupt / pause / resume (P11)** — single-operator hold sets
  `meta.paused`, gates dispatch pickup (in-flight steps finish), surfaces an
  interrupt card, and `POST /api/control/resume` continues the run. Topbar
  pause button wired to the new control endpoints.
- **Trace / span telemetry (P12)** — per-run span trees with `ms` + token
  accounting, flattened into the `trace` slice and broadcast as typed frames.

### Fixed

- Live widgets (probe gauges, agent rows, workflow rows) update in place
  instead of rebuilding their DOM per delta, so neon sweeps and progress
  animations no longer replay constantly; chart redraws are gated on actual
  series changes.
- Agent progress/tokens stay frozen while a tool step is in flight (no more
  mid-step jumps), and seeded `assigned` dispatch rows complete instead of
  lingering forever.
- `@ORCH` / `ORCH,` aliases resolve to the real `ORCHESTRATOR` crew name, and
  mention detection no longer false-positives on lowercase common words.
- Pause previously only suppressed hint frames; it now genuinely halts new job
  pickup while allowing the interrupt card and deltas to keep flowing.
- `hermes-ingest` suite test isolation: the D11 sync-state reset now resolves
  `hermes-ingest.json` from `STELLARIS_DATA_DIR` (and creates the dir) instead
  of hardcoding `<repo>/data`, so `npm test` passes on a fresh checkout/CI
  where no `data/` directory exists.

### Performance

- Delta frames are now diffed against the last-sent reference and only changed
  top-level slices are broadcast, with hint frames suppressed while paused.

### Security

- Bumped `vite` `5.x → 7.x` (dev-only) — resolves the esbuild dev-server SSRF,
  vite path-traversal/`fs.deny` bypass, and launch-editor advisories.
  `npm audit` now reports 0 vulnerabilities.

## [2.0.0] — 2026-08-17

### Added

- **Realtime transport** — snapshot-on-connect + monotonic `seq` deltas +
  `resync`-on-gap + heartbeat/pong; auto-reconnect with exponential backoff and
  gap detection on the client.
- **Agent runtime upgrade** — typed tool schemas, lifecycle hooks
  (`onRunStart`/`onToolCall`/`onToolResult`/...), supervisor-style dispatch via
  the step machine, error state instead of spin, retry policy.
- **GitHub integration** — ETag + `since` incremental poller, rate-limit watch,
  kanban column mapping, `GITHUB_*` env config, seed fallback + `SRC:` banner.
- **Real vault + alerts** — vault docs live on canonical state (`body` on
  each doc; skills/`_logMission` write real text) and a condition engine that
  raises/clears real alerts from telemetry/probe thresholds each tick.
- **Premium visual pass** — design tokens, clipped panels, scanline/CRT layer,
  neon glow system, Orbitron/Rajdhani/Share Tech Mono type system,
  reduced-motion support; Three.js galaxy with UnrealBloom, hot-core star
  shader, twinkle, spiral arms, nebula, camera damping, adaptive quality
  watchdog.
- **Hermes bridge** — `server/hermes.js` client, real `hermes` skill executor
  (simulated fallback when unreachable), planner toolset mapping, HUD approval
  bridge, and reverse ingest of sessions/crons/alert-failures
  (`server/hermes-ingest.js`).
- **Chat optimization** — agent identity (`summary`/`capabilities`), knowledge
  retrieval layer, LLM-backed reply synthesis with heuristic fallback,
  `@AGENT` mention routing (case-insensitive, with bare-capitalized-name
  detection), ORCH alias, ambiguity paths.
- **Realtime telemetry graphs** — rolling 90-sample history window + `jobs`
  done/failed aggregates feeding the graphs view.
- **Verification fleet** — 10 suites behind `npm test` at 2.0.0 (hermes,
  hermes-ingest, phase-4, github, planner, skills, chat, regression, views,
  integration). Later releases added superstep, channels, checkpoints,
  interrupt, trace, and comms (16 total). Integration suite boots a real orbit
  server on an isolated port/data dir and exercises the full REST + WebSocket
  surface; views suite headless-renders all 12 HUD views via a DOM shim.

### Changed

- Tool-level activity folded into the authoritative `logs` slice (delta-driven)
  instead of hint-only event frames.
- Dispatch seed deduped into `DISPATCH_SEED` in `src/config.js` (shared by
  server seed and client store).
- `STELLARIS_DATA_DIR` env override for self-isolating test state.
- Calendar day-range validation, planner agent-name validation (hallucinated
  names → `ORCHESTRATOR`), malformed-JSON `400` handler.
- Lazy-loaded galaxy chunk: initial bundle 546 kB → 41 kB (gzip 14.4 kB);
  galaxy chunk loads async after the HUD shell paints.
- XSS hardening: `escapeHtml` applied across all state-derived renderers
  (kanban, table, cron, dispatch, chat, log, agenda, agents, workflows, tools).

### Fixed

- WS snapshot-on-connect race (frames now buffered from socket creation).
- `sparklineSvg` divide-by-zero on a single-sample series.
- `phase4` suite flake from demo-persisted state (self-isolating backup).
- `assigned` seed rows now picked up by idle agents instead of being orphaned.

### Security

- All state-derived strings HTML-escaped before `innerHTML` injection.
- Credentials never committed; `.env.example` ships placeholders only.
- Malformed input returns `400` JSON without leaking stack traces.

## [1.0.0] — 2026-08-15

### Added

- 12-view HUD single-page console (Vite + Three.js).
- Orbit server (Express + WS) as single source of truth with JSON persistence
  (`data/state.json`).
- Orchestrator heartbeat driving agents/workflows with simulated progress.
- Simulated skills registry and heuristic planner.
- Static vault and alerts.
- OFFLINE simulation fallback so the console never goes dark.
- Docker multi-stage image, non-root, with healthcheck; `docker-compose.yml`
  with `orbit-data` volume.

[Unreleased]: https://github.com/genpozi/starship-hud/compare/2.2.0...HEAD
[2.2.0]: https://github.com/genpozi/starship-hud/releases/tag/2.2.0
[2.1.0]: https://github.com/genpozi/starship-hud/releases/tag/2.1.0
[2.0.0]: https://github.com/genpozi/starship-hud/releases/tag/2.0.0
[1.0.0]: https://github.com/genpozi/starship-hud/releases/tag/1.0.0
