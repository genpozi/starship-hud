# STELLARIS-7 API Reference

Version `2.2.0`. Base URL: `http://localhost:3001` (or the proxied origin in
dev/preview). Operator chrome and 12-view behavior: `docs/MANUAL.md`.

## WebSocket (`/ws`)

Realtime transport. Frames are JSON with a `type` discriminator. A **snapshot**
is authoritative and does not advance `seq`; **deltas** advance `seq`. The
client verifies delta continuity and requests a resync on any gap.

| Direction | Frame | Meaning |
|-----------|-------|---------|
| server → | `{type:'snapshot', seq, state}` | Full authoritative state. Sent on connect and in reply to a client `resync`. |
| server → | `{type:'delta', seq, updates}` | Per-tick (≈1.5s) diffs of changed top-level slices; `updates[k] = <new value>`. |
| server → | `{type:'approval', pending}` | Approval card appeared (`pending` is the request object). Used by both the Hermes delegation bridge and the P11 interrupt surface (`pending.tool === 'interrupt'`). |
| server → | `{type:'approval', pending:null}` | Pending approval / interrupt cleared. |
| server → | `{type:'events', events}` | P12 trace span frames (`events` is a flat span list, newest-first handling client-side). |
| server → | `{type:'chat'}` | Hint that chat changed; the authoritative rows arrive in the next delta. |
| server → | `{type:'ping'}` | Liveness probe every ~15s. |
| client → | `{type:'pong'}` | Required reply to `ping`; 3 missed = connection terminated. |
| client → | `{type:'resync'}` | Client saw a `seq` gap; server answers with a fresh snapshot. |
| client → | `{type:'hello', operatorId, name?}` | P13 session identity. Roster lives in `meta.operators[]`. |
| server | WS `close` | Drops that socket from `meta.operators[]` (`goodbye`). |

Client handling in `src/api.js`:

- `snapshot` → `applyServerState` (rebuild full store)
- `delta` → `seq === expected ? applyDelta(updates) : send resync`
- `approval` → `reduceEvent` channel: toggle `STATE.approval.pending`
- `events` → `reduceEvent` channel: fold spans into `STATE.trace`
- `ping` → reply `pong`
- any other `type` → `reduceEvent` (typed channel reducers; unknown types are ignored)

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
| POST | `/api/chat` | `{text, operatorId?}` | Operator goal. Detects a direct `@AGENT` mention (pins plan + reply owner), plans into steps (P8 `dependsOn` chains preserved), creates a workflow, queues agents, and replies with a synthesized answer. Returns `{ok, steps, agent}`. `operatorId` (or `X-Stellaris-Operator`) stamps the run owner. |
| POST | `/api/dispatch` | `{task, agent, operatorId?}` | Manually queue a task for an agent. |
| POST | `/api/kanban/:id/advance` | — | Move card `id` to the next column (removes if already `done`). |
| POST | `/api/items/:id/status` | — | Cycle item status `open → watch → review → closed`. `404` if missing. |
| POST | `/api/schedules/:id/pause` | — | Toggle pause on a seed job. Hermes rows return `409`. `404` if missing. |
| POST | `/api/reports/:id/status` | — | Cycle report status `draft → review → published`. `404` if missing. |
| POST | `/api/alerts/:id/ack` | — | Acknowledge alert `id`. |
| POST | `/api/alerts/ack-all` | — | Acknowledge every active alert. Returns `{ok, acked}`. |
| POST | `/api/approval/respond` | `{choice: 'approve'\|'deny', operatorId?}` | Resolve the pending Hermes approval. `400` if choice invalid; `{ok:false,error}` if none pending; `403` if not the run owner. |
| POST | `/api/email/:id/read` | — | Mark email `id` read (numeric index still accepted). |
| POST | `/api/email/:id/archive` | — | Move email `id` to `folder:'archive'` (best-effort remote). |
| POST | `/api/email/send` | `{to, subject, body, attachments?}` | Send mail via Gmail/Graph, or a local sent-copy when no provider. Optional `attachments` are `{name, mime, data}` base64 parts (capped ~200KB). `400` if `to`/`subject` missing. |
| POST | `/api/comms/inbound` | `{from, subject, body}` | Ingest an inbound message. Optional `X-Stellaris-Secret` vs `USER_COMMS_WEBHOOK_SECRET`. |
| POST | `/api/calendar/:day` | — | Select calendar day `0-6`. `400` if out of range. |
| POST | `/api/calendar/events` | `{title, day, start, end}` | Create an event (Google/Graph/CalDAV, else local). `400` if `title` missing. |
| POST | `/api/calendar/week` | `{delta?, weekStart?}` | Shift displayed week (`delta` in weeks) or jump to `weekStart` (snaps to Sunday). Refetches live events. |
| POST | `/api/calendar/events/:id/delete` | — | Delete event `id` (best-effort remote). `404` if missing. |
| POST | `/api/mission` | `{name, agents}` | Create a workflow mission and dispatch the listed agents. |
| POST | `/api/checkpoint` | `{reason?}` | Capture a full-state snapshot (P10). HUD SNAP uses `reason:'hud'`. Returns `{ok, id}`; ledger capped at 8. |
| POST | `/api/checkpoint/rollback` | — | Restore the latest checkpoint (P10). HUD REWIND. Returns `{ok, id, slices}` — `slices` lists the top-level slices actually reverted; `409` if none available. |
| POST | `/api/control/pause` | `{reason?, operatorId?}` | Single-operator hold (P11/P13): sets `meta.paused`, gates dispatch pickup. Returns `{ok, id}`. Second holder gets `409`. |
| POST | `/api/control/interrupt` | `{reason?, agent?, goal?, operatorId?}` | Interrupt with an approval card (P11) carrying `reason`/`agent`; returns `{ok, id}`. `409` if another operator holds pause. |
| POST | `/api/control/resume` | `{operatorId?}` | Clears pause/interrupt; in-flight runs continue. Returns `{ok, resumed}`. `409` if not the holder. |

## State shape

Top-level slices (`meta`, `approval`, `agents`, …) are the units of WS
snapshots and deltas.

```jsonc
{
  "meta": {
    "mission": "OP ORBITAL CANARY", "coordinates": "...", "threat": "MODERATE",
    "tokenTotal": 0, "bootedAt": 0,
    "dataSource": "seed | github | hermes",      // which source owns the board
    "comms": { "email": "seed|google|microsoft|webhook|mixed", "calendar": "seed|google|microsoft|ics|caldav|mixed", "lastSync", "error" },
    "lastSync": 0,                               // github/hermes last poll
    "hermes": { "status", "url", "model", "checkedAt" },  // when hermes bridge enabled
    "paused": false,                             // P11 interrupt state
    "operators": [ { "id", "name", "seenAt" } ], // P13 connected HUD sessions
    "operatorDefault": "operator",               // USER_OPERATOR_NAME fallback
    "bootCheckpointId": "ckpt_...",              // P10 boot-guard snapshot id
    "lastRollback": null | { "ts", "id", "slices": [] }  // most recent rollback
  },
  "approval": {
    "pending": null | { "id", "tool", "summary", "detail", "from", "owner", "choice", "at" },
    "history": [ ...resolved approvals, newest first, bounded 20 ]
  },
  "checkpoints": [
    { "id", "ts", "reason", "state": { ...full snapshot... } }  // capped at 8
  ],
  "trace": [
    { "id", "name", "type", "depth", "parent", "ms", "tokenIn", "tokenOut", "ok", "ts" }
  ],
  "agents":     [{ "id", "name", "role", "state", "task", "progress", "tokens", "summary", "capabilities": [] }],
  "workflows":  [{ "id", "name", "state", "progress", "steps", "curStep", "agents", "eta", "plan?" }],
  "kanban":     { "columns": [...], "cards": [ { "id", "title", "col", "priority", "src" } ], "done": [...] },
  "items":      [ { "id", "title", "type", "prio", "assignee", "status", "src" } ],
  "schedules":  [ { "id", "name", "cron", "agent", "next", "dur", "last", "paused", "src" } ],
  "chat":       [...], "dispatch": [...],
  "vault":      [ { "id", "title", "type", "tags", "size", "updated", "agent", "body", "file?" } ],
  "email":      [{ "id", "from", "to", "subject", "preview", "body", "time", "label", "read", "prio", "folder", "src" }],
  "calendar":   { "events": [{ "id", "day", "start", "end", "title", "type", "agents", "src" }], "day": 0, "weekStart", "weekLabel" },
  "alerts":     [ { "id", "level", "msg", "src", "ack" } ],
  "probes":     [...], "reports": [ { "id", "title", "author", "status", "tags", "updated", "abstract", "body" } ],
  "telemetry":  { "temp", "token", "lat", "ctx",
                  "jobs": { "done", "failed" },
                  "hist":  [ { "ts", "temp", "lat", "ctx", "token",
                               "tokenTotal", "jobs" } ] },
  "logs":       [{ "t", "level", "msg" }]
}
```

`src` on kanban cards, items, schedules and alerts is `seed | github | hermes`
and drives the cyan `he` accent on Hermes-sourced rows. Email/calendar `src` is
`seed | google | microsoft | ics | caldav | webhook | local`. Mixed comms
(`auto` with more than one live provider) sets `meta.comms.email` /
`meta.comms.calendar` to `mixed`.

REST mutations that stamp an owner accept `operatorId` in the JSON body and/or
the `X-Stellaris-Operator` header. The HUD stores the id in `localStorage`
(`stellaris.operatorId`).

Interrupt cards (`pending.tool === 'interrupt'`) are not resolvable via
`/api/approval/respond` — use `/api/control/resume`. Approvals route to the run
`owner`; a foreign operator gets `403`.

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
