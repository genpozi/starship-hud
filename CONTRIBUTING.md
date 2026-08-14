# Contributing to STELLARIS-7

## Getting started

```bash
npm install
npm test        # all suites must pass
npm run build   # bundle must build
```

Run the stack to try changes live:

```bash
./scripts/demo.sh          # mock hermes (:8787) + orbit (:3001) + vite (:5173)
# or, for a real WebUI: point USER_HERMES_URL at it, then ./scripts/probe.sh
```

## Branching & commits

- Small, focused commits; message style `type(scope): subject`
  (e.g. `feat(ingest): merge cron failures into alerts`,
  `fix(orchestrator): skip empty delta broadcasts`).
- One logical change per commit; keep `master` green at all times.
- For larger changes, work on a feature branch and open a merge request:
  branch name `YYMMDD-(feat|fix|chore|refactor)-<short-description>`.

## What to cover

- **New skill** → add to `server/skills.js`, wire the planner toolset, test in
  `test/skills.test.mjs`.
- **New mutation** → method on `Orchestrator` + REST route in
  `server/index.js` + `api.*` helper in `src/api.js` + test in the relevant
  suite.
- **New data source** → follow the GitHub/Hermes pattern: poller writes onto
  the board shape, sets `meta.dataSource`, preserves other sources' rows, and
  is covered by a suite that runs against the test mock.
- **Frontend view** → renderer in `src/views.js`, container + nav in
  `index.html`, interaction via `api.*` in ONLINE mode, direct `STATE`
  mutation in OFFLINE mode.

## Rules

1. `npm test` and `npm run build` must pass before you push.
2. Never commit operator credentials — `.env`, real `USER_LLM_*`/`GITHUB_*`
   values, or tokens. `.env.example` is the only allowed credential file and
   must contain placeholders only.
3. No new dependencies without a stated reason; the server intentionally ships
   with only `express` + `ws`.
4. Keep the docs honest — update `docs/ARCHITECTURE.md`, `docs/API.md`, or
   `docs/DEVELOPER.md` when a module, route, or state slice changes.
5. Simulated surfaces (seed/orchestrator/offline sim/mock hermes) are
   explicitly labeled as such in docs and README; never present them as real
   integrations.

## Review checklist

- [ ] `npm test` green, `npm run build` green
- [ ] No hardcoded credentials; `.env.example` placeholders only
- [ ] Errors return `{ok:false, error}` / `400`; success mutations broadcast
- [ ] New state slices documented in `docs/API.md`
- [ ] Existing suites updated or extended where behavior changed
