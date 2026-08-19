# Changelog

All notable changes to STELLARIS-7 are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Security

- Bumped `vite` `5.x → 7.x` (dev-only) — resolves the esbuild dev-server SSRF,
  vite path-traversal/`fs.deny` bypass, and launch-editor advisories.
  `npm audit` now reports 0 vulnerabilities.

### Fixed

- `hermes-ingest` suite test isolation: the D11 sync-state reset now resolves
  `hermes-ingest.json` from `STELLARIS_DATA_DIR` (and creates the dir) instead
  of hardcoding `<repo>/data`, so `npm test` passes on a fresh checkout/CI
  where no `data/` directory exists.

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
- **Real vault + alerts** — filesystem-backed vault (`data/vault/*.md`) and a
  condition engine that raises/clears real alerts from telemetry/probe
  thresholds each tick.
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
- **Verification fleet** — 10 suites behind `npm test` (hermes, hermes-ingest,
  phase-4, github, planner, skills, chat, regression, views, integration).
  Integration suite boots a real orbit server on an isolated port/data dir and
  exercises the full REST + WebSocket surface; views suite headless-renders all
  12 HUD views via a DOM shim.

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

[Unreleased]: https://github.com/genpozi/starship-hud/compare/2.0.0...HEAD
[2.0.0]: https://github.com/genpozi/starship-hud/releases/tag/2.0.0
[1.0.0]: https://github.com/genpozi/starship-hud/releases/tag/1.0.0
