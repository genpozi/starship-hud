# STELLARIS-7 Research — Findings Digest

Condensed, actionable findings from 5 research workstreams on premium GitHub
projects. Full detail for orchestration: `docs/ORCHESTRATION-RESEARCH.md`.

## 1. Realtime dashboards (Supabase Realtime, Grafana Live, Socket.IO, Phoenix, Yjs)

- **Snapshot on connect, deltas after.** Full state only on connect/subscribe;
  then `{op:update|delete, path, value}` batches. Full push every tick is
  acceptable at small scale but jumpy — never premium.
- **Version every message** with a monotonic `seq`. Client detects gaps and
  requests `resync` → server re-sends snapshot. At-most-once is the contract;
  correctness rests on "snapshot + deltas + resync on gap."
- **Heartbeat + exponential-backoff reconnect** (500ms→30s cap), and **always
  resync on reconnect**. Detect half-open links via ping/pong.
- **Optimistic UI, server-authoritative truth.** Mutations apply locally,
  reconcile on next sync.
- **Separate channels by data class:** slow state vs high-frequency telemetry.
- Push on *change*, not on a clock; coalesce per-tick; normalized client store.

## 2. Multi-agent orchestration (LangGraph, AutoGen, CrewAI, OpenAI Agents, beeai)

- **NextStep union** — runtime returns `finalOutput | handoff | runAgain |
  interrupt` instead of `progress += rand()`.
- **AgentSpec vs AgentRuntime** — config (`instructions/tools/maxTurns`)
  separate from the loop; orchestrator becomes pure coordination.
- **Lifecycle hooks + emitter** — `onRunStart/onTurnStart/onToolCall/
  onToolResult/onRunEnd`; rewire existing `log/pushChat/broadcast` into them.
- **Tool registry schema** — `{name, description, parameters, isEnabled,
  needsApproval, maxUsageCount, resultAsAnswer, failureErrorFunction,
  execute}` + unique-name validation.
- **Tool cycle** — parse → run (ordered, parallel) → reflect (`post_tool_reasoning`) → re-loop.
- **Supervisor handoffs as tools** — replace raw `setTimeout` dispatch with
  handoff jobs that gate workflow advancement.
- **maxTurns + RetryPolicy** — `{maxAttempts:3, backoff:2, jitter:true}`;
  error state instead of infinite spin.
- **Typed event stream** alongside state — `task:start/finish`,
  `tool:start/finish`, `interrupt`, `span` with per-span token/ms deltas.

## 3. HUD visual design (eDEX-UI, augmented-ui, cybercore-css, Dynamic-SciFi-Dashboard-Kit, Weyland CRT)

- **Design tokens** — `:root` vars for colors, panel bg, border alpha, glow.
- **Clipped angular panels** — `clip-path: polygon(...)` corner cuts + inner
  1px `::before` frame + corner brackets (two pseudo-elements, L-shapes).
- **3-level depth** — scanlines (`repeating-linear-gradient` ~4% alpha) +
  top radial cyan tint + bottom vignette over the galaxy; translucent panels
  with `backdrop-filter: blur(2px)`.
- **Neon glow** — stacked box/text-shadows (tight bright → wide faint);
  `drop-shadow()` on SVG arcs; 3-layer `text-shadow` on hero numbers.
- **Type system** — Orbitron (titles only), Rajdhani (labels, uppercase +
  0.05–0.2em letter-spacing), Share Tech Mono (all numbers + `tabular-nums`).
- **Motion on data** — gauge `stroke-dashoffset` transitions
  `cubic-bezier(0.65,0,0.35,1)` ~0.4s; JS rAF number rollups; `currentColor`
  glow on bars. Glitch reserved for alerts. Respect `prefers-reduced-motion`.
- **Chrome** — diegetic header (ship name, view title, UTC clock), per-view
  footer data line, screen-edge framing bars.
- References: eDEX-UI (45k★), augmented-ui, cybercore-css, Dynamic-SciFi
  Dashboard Kit, Weyland Nostromo CRT, cybercore-charts.

## 4. Three.js galaxy (galaxy-explorer, threejs-galaxy-shader, vercel nights shader, three.js examples)

- **Bloom + ACES** — `RenderPass → UnrealBloomPass(strength .08–.12, radius
  .32, threshold .42) → OutputPass`, `ACESFilmicToneMapping` exposure 1.1.
  Biggest single cinematic jump.
- **Hot-core + halo star fragment** — replace `PointsMaterial` square points
  with a `ShaderMaterial`: `halo = (1-d)^2.2 * .65`, `core = exp(-d²*18)`.
- **Twinkle in vertex shader** — per-star `aPhase/aSpd`, `sin(uTime)` +
  rare `pow(max(0,sin),24)` flare; size/color modulated per-vertex.
- **Knot clumping** — ~80% of stars dropped as Gaussian blobs around
  ~N/200 cluster centers seeded on arms; rarity population (0.3% yellow
  giants ×2.6, 2.4% orange/blue knots ×2.3). Radial power-law `r^0.72`.
- **Baked nebula field** — fBm + Worley domain-warped along the spiral,
  baked once to a 2048² render target, drawn as a textured quad.
- **Distance fade** — `1 - smoothstep(fadeNear, fadeFar, viewDist)`.
- **Camera** — parallax as camera offset (not group rotation), frame-rate
  independent damping `k = 1-e^(-dt*5)`, idle drift, galaxy spin ~0.013 rad/s.
- **Adaptive quality watchdog** — frame-time EMA; degrade density →
  pixelRatio → bloom.

## 5. GitHub API integration (Octokit, GitHub REST docs, DevLake)

- **Polling with conditional requests is the premium self-hosted default**:
  `GET /repos/{owner}/{repo}/issues` (`state=all`, `per_page=100`) returns
  issues **and** PRs (PRs have `pull_request` key); `pulls` list separately.
- **ETag + `if-none-match`** → `304` throws in octokit (`err.status === 304`),
  free against rate limit. **`since` + `sort=updated&direction=desc`** for
  incremental sync. Serialize requests. `per_page: 100`.
- **Rate limits:** auth → 5,000/hr; watch `x-ratelimit-remaining`.
- **Kanban mapping:** closed → done; open PR (non-draft) → in_progress; open
  with status label (`in-progress`/`wip`/`status/in-progress`) → in_progress;
  else → backlog.
- **No-token fallback:** seeded demo data + `dataSource:"seed"` mode + persist
  last snapshot (stale-while-revalidate). Env-driven via user-supplied token.
