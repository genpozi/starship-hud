# STELLARIS-7 // Deployment & operations

How to run the orbit server in production, wire it to real data sources, and
validate it before it touches your Hermes WebUI / GitHub / LLM.

## Prerequisites

- Node.js 20+ (built/tested on Node 22).
- Operator-supplied credentials in `.env` (copy `.env.example`). Nothing is
  embedded in the image or committed to the repo.

## 1. Validate a real Hermes WebUI first

The bridge is coded against the hermes-webui HTTP/SSE contract, but instance
builds vary. **Before** enabling `USER_HERMES_URL`, probe the real instance:

```bash
npm run probe -- --url http://your-host:8787
# or, with an auth password:
npm run probe -- --url http://your-host:8787 --password secret
```

Every surface the bridge consumes is checked (health, sessions, crons,
session/create, chat round-trip, approval/pending, auth). PASS = safe to
enable; WARN = works but with a mapping caveat; FAIL = fix the instance or the
mapping. Exit code is non-zero on any FAIL.

## 2. Run it

### Bare metal

```bash
npm ci
npm run build                 # bundle the frontend
npm start                     # Express serves dist/ + API + WS on :3001
```

### Docker

```bash
docker compose up -d --build orbit
docker compose ps             # healthcheck hits /api/health every 30s
```

`data/` is a named volume (`orbit-data`) so state survives restarts. The
optional `mock` service runs the bundled hermes-webui test double on :8787 for
demos; it is not required (and not desired) in production with a real webui.

## 3. Data sources

Set these in `.env` (see `.env.example` for the full list):

| Source | Env vars | Notes |
| --- | --- | --- |
| GitHub | `GITHUB_TOKEN`, `GITHUB_OWNER`, `GITHUB_REPO` | Maps issues + PRs onto the board; ETag polling (`data/github-etags.json`); hermes rows preserved via `mergeReplacement` |
| Hermes WebUI | `USER_HERMES_URL`, `USER_HERMES_PASSWORD`, `USER_HERMES_MODEL`, `USER_HERMES_POLL_MS`, `USER_HERMES_INGEST_MS`, `USER_HERMES_APPROVAL`, `USER_HERMES_APPROVAL_TIMEOUT` | Chat delegation, HUD approval bridge, reverse ingest of sessions/crons |
| LLM planner | `USER_LLM_API_KEY`, `USER_LLM_BASE_URL`, `USER_LLM_MODEL` | Goal decomposition; falls back to the deterministic heuristic planner offline |

Activation rule: `dataSource` flips to `hermes` only when `USER_HERMES_URL` is
explicitly set **and** `/health` responds; to `github` only when a full
GitHub sync succeeds. Missing config keeps the seed board.

## 4. Operator runbook (Hermes)

Full behavior — approvals, reverse ingest mapping, offline fallback,
troubleshooting — is in `docs/HERMES-INTEGRATION.md` §"Step 7 — HUD surface +
operator runbook".

Quick facts:

- **Approvals** default to `prompt` (HUD card). `always`/`never` bypass the
  card. An unanswered card auto-approves after `USER_HERMES_APPROVAL_TIMEOUT`
  (default 120 s) so long delegations are never stuck.
- **Reverse ingest** upserts `he-` kanban cards, `SESSION` items, `he-` cron
  rows and `HERMES` alerts. It never auto-removes — advance/ack via the normal
  HUD tools. Failing-cron alerts dedup by signature and only re-raise on a new
  `last_run`.
- **Offline**: no `USER_HERMES_URL` → simulated delegation; unreachable while
  configured → the poller logs the link state and the HUD keeps last-known
  data.

## 5. Tests & verification

```bash
npm test          # 6 suites: hermes client, reverse ingest, phase-4 engine,
                  # github mapping, planner, skills (spawns a fresh mock)
npm run build     # frontend bundle must compile
```

## 6. Operations notes

- `data/state.json` is the persisted runtime state (gitignored). Back it up
  before upgrades; it self-heals from seed on corrupt/missing reads.
- The scheduler rows with `src:'hermes'` are authoritative from upstream — the
  seed emulator never overwrites them.
- Rotate `GITHUB_TOKEN` / `USER_HERMES_PASSWORD` / any LLM key on a schedule;
  never commit real values.
