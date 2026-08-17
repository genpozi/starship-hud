# STELLARIS-7 API Reference

Base URL: `http://localhost:3001` (or the proxied origin in dev/preview).

## WebSocket (`/ws`)

Realtime transport. Frames are JSON with a `type` discriminator. A **snapshot**
is authoritative and does not advance `seq`; **deltas** advance `seq`. The
client verifies delta continuity and requests a resync on any gap.

| Direction | Frame | Meaning |
|-----------|-------|---------|
| server → | `{type:'snapshot', seq, state}` | Full authoritative state. Sent on connect and in reply to a client `resync`. |
| server → | `{type:'delta', seq, updates}` | Per-tick (≈1.5s) diffs of changed top-level slices; `updates[k] = <new value>`. |
| server → | `{type:'approval', pending}` | Hermes delegation approval card appeared (`pending` is the request object). |
| server → | `{type:'approval', pending:null}` | Pending approval cleared/resolved. |
| server → | `{type:'ping'}` | Liveness probe every ~15s. |
| client → | `{type:'pong'}` | Required reply to `ping`; 3 missed = connection terminated. |
| client → | `{type:'resync'}` | Client saw a `seq` gap; server answers with a fresh snapshot. |

Client handling in `src/api.js`:

- `snapshot` → `applyServerState` (rebuild full store)
- `delta` → `seq === expected ? applyDelta(updates) : send resync`
- `approval` → toggle the approval card in `STATE.approval`
- `ping` → reply `pong`

### State change events (delta payloads)

Agent `state` transitions and workflow step advances are derived by the client
from slice deltas — there are no fine-grained event frames. Empty delta frames
are skipped server-side.

## REST

### State & health

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/state` | Full canonical state snapshot (JSON) |
| GET | `/api/health` | `{ok, agents, uptime}` liveness probe |

### Mutations

All mutations return JSON; success mutations broadcast the new state.

| Method | Path | Body | Description |
|--------|------|------|-------------|
| POST | `/api/chat` | `{text}` | Operator goal. Detects a direct `@AGENT` mention (pins plan + reply owner), plans into steps, creates a workflow, queues agents, and replies with a synthesized answer. Returns `{ok, steps, agent}`. |
| POST | `/api/dispatch` | `{task, agent}` | Manually queue a task for an agent. |
| POST | `/api/kanban/:id/advance` | — | Move card `id` to the next column (removes if already `done`). |
| POST | `/api/alerts/:id/ack` | — | Acknowledge alert `id`. |
| POST | `/api/approval/respond` | `{choice: 'approve'\|'deny'}` | Resolve the pending Hermes approval. `400` if choice invalid; `{ok:false,error}` if none pending. |
| POST | `/api/email/:idx/read` | — | Mark email at index `idx` read. |
| POST | `/api/calendar/:day` | — | Select calendar day `0-4`. |
| POST | `/api/mission` | `{name, agents}` | Create a workflow mission and dispatch the listed agents. |

## State shape

Top-level slices (`meta`, `approval`, `agents`, …) are the units of WS
snapshots and deltas.

```jsonc
{
  "meta": {
    "mission": "OP ORBITAL CANARY", "coordinates": "...", "threat": "MODERATE",
    "tokenTotal": 0, "bootedAt": 0,
    "dataSource": "seed | github | hermes",      // which source owns the board
    "lastSync": 0,                               // github/hermes last poll
    "hermes": { "status", "url", "model", "checkedAt" }  // when hermes bridge enabled
  },
  "approval": {
    "pending": null | { "id", "tool", "summary", "detail", "from", "choice", "at" },
    "history": [ ...resolved approvals, newest first, bounded 20 ]
  },
  "agents":     [{ "id", "name", "role", "state", "task", "progress", "tokens", "summary", "capabilities": [] }],
  "workflows":  [{ "id", "name", "state", "progress", "steps", "curStep", "agents", "eta" }],
  "kanban":     { "columns": [...], "cards": [ { "id", "title", "col", "priority", "src" } ], "done": [...] },
  "items":      [ { "id", "label", "status", "src" } ],
  "schedules":  [ { "id", "title", "next", "cron", "status", "src" } ],
  "chat":       [...], "dispatch": [...],
  "vault":      [...], "email": [...],
  "calendar":   { "events": [...], "day": 0, "weekLabel": "CYCLE 42 / W-2" },
  "alerts":     [ { "id", "level", "msg", "src", "ack" } ],
  "probes":     [...], "reports": [...],
  "telemetry":  { "temp", "token", "lat", "ctx",
                  "jobs": { "done", "failed" },
                  "hist":  [ { "ts", "temp", "lat", "ctx", "token",
                               "tokenTotal", "jobs" } ] },
  "logs":       [{ "t", "level", "msg" }]
}
```

`src` on kanban cards, items, schedules and alerts is `seed | github | hermes`
and drives the cyan `he` accent on Hermes-sourced rows.

## Examples

```bash
# Operator goal → planner decomposes into orchestrated steps; the addressed
# agent replies with a synthesized, knowledge-grounded answer
curl -X POST http://localhost:3001/api/chat \
  -H 'Content-Type: application/json' \
  -d '{"text":"@CODA who are you and what can you do?"}'
# {"ok":true,"steps":3,"agent":"CODA"}
# chat gains: <CODA> I'm CODA, software engineer. I scaffold, implement, review
# and unit-test source changes across the fleet. On the tool side I can handle
# shell, coder, search, memory.
```
