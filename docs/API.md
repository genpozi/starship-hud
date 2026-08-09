# STELLARIS-7 API Reference

Base URL: `http://localhost:3001` (or the proxied origin in dev/preview).

## WebSocket

| Path | Frames |
|------|--------|
| `/ws` | On connect: full `{type:'state', state}` snapshot. Then ~every 1.5s `{type:'state'}` plus `{type:'chat'}` when the fleet chat grows. |

## REST

### State & health

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/state` | Full canonical state snapshot |
| GET | `/api/health` | `{ok, agents, uptime}` liveness probe |

### Mutations

All mutations return JSON; success mutations broadcast the new state.

| Method | Path | Body | Description |
|--------|------|------|-------------|
| POST | `/api/chat` | `{text}` | Operator goal. Plans into steps, creates a workflow, queues agents. |
| POST | `/api/dispatch` | `{task, agent}` | Manually queue a task for an agent. |
| POST | `/api/kanban/:id/advance` | — | Move card `id` to the next column (removes if already `done`). |
| POST | `/api/alerts/:id/ack` | — | Acknowledge alert `id`. |
| POST | `/api/email/:idx/read` | — | Mark email at index `idx` read. |
| POST | `/api/calendar/:day` | — | Select calendar day `0-4`. |
| POST | `/api/mission` | `{name, agents}` | Create a workflow mission and dispatch the listed agents. |

## State shape

```jsonc
{
  "meta":       { "mission", "coordinates", "threat", "tokenTotal", "bootedAt" },
  "agents":     [{ "id", "name", "role", "state", "task", "progress", "tokens" }],
  "workflows":  [{ "id", "name", "state", "progress", "steps", "curStep", "agents", "eta" }],
  "kanban":     { "columns": [...], "cards": [...], "done": [...] },
  "items":      [...], "schedules": [...], "chat": [...], "dispatch": [...],
  "vault":      [...], "email": [...],
  "calendar":   { "events": [...], "day": 0, "weekLabel": "CYCLE 42 / W-2" },
  "alerts":     [...], "probes": [...], "reports": [...],
  "telemetry":  { "temp", "token", "lat", "ctx" },
  "logs":       [{ "t", "level", "msg" }]
}
```

## Example: dispatch an operator goal

```bash
# Planner (heuristic or LLM) decomposes the goal into orchestrated steps
curl -X POST http://localhost:3001/api/chat \
  -H 'Content-Type: application/json' \
  -d '{"text":"build and deploy a canary for the surface module"}'
# {"ok":true,"steps":4}
```

```bash
# Manual agent dispatch
curl -X POST http://localhost:3001/api/dispatch \
  -H 'Content-Type: application/json' \
  -d '{"task":"sweep stale vault blobs","agent":"LINK"}'
# {"ok":true}
```
