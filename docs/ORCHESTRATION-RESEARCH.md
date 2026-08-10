# Premium OSS Multi-Agent Orchestration — Internals Research Report

Research conducted for the STELLARIS-7 Node.js orchestrator (heartbeat loop, agent runtime, skills registry, heuristic+optional-LLM planner, JSON state store, WebSocket fan-out). Sources examined (README + key source files on `main`):

- **langgraph** (`langchain-ai/langgraph`) — `langgraph/graph/state.py`, `langgraph/pregel/{_algo,_runner,_loop,_executor,_tools}.py`, `langgraph/types.py`, README
- **openai-agents-python** (`openai/openai-agents-python`) — `src/agents/{agent.py,run.py,function_tool.py,tool.py}`, `src/agents/run_internal/{run_loop,run_steps,turn_resolution,tool_execution}.py`, `src/agents/tracing/traces.py`, README
- **autogen** (`microsoft/autogen`) — README (maintenance mode; successor = Microsoft Agent Framework), package layout of `autogen-core` / `autogen-agentchat`
- **crewAI** (`crewAIInc/crewAI`) — `crewai/agents/crew_agent_executor.py`, README (Crews + Flows, agents/tasks YAML)
- **beeai-framework** (`i-am-bee/beeai-framework`) — `typescript/src/agents/base.ts`, `typescript/src/workflows/workflow.ts`, README

---

## 1. Summary: key abstractions per framework

| Framework | Core abstractions | Runtime loop | Tool model | Planning | Memory / persistence | Observability |
|---|---|---|---|---|---|---|
| **langgraph** | `StateGraph`, `State` + channels/reducers, `Node`, `Command`, `Send`, `Checkpointer`, `Store` | Pregel **superstep** executor: build tasks from channel writes + edges → run in parallel → apply writes via reducers → checkpoint → recompute next tasks | `@tool` (pydantic schema), `ToolNode` dispatch by name | none built in; plan-and-execute = graph pattern (planner node → executors → conditional re-plan) | 2 layers: **checkpointer** (short-term, `BaseCheckpointSaver.get_tuple/put/list/put_writes`, keyed by `thread_id`) + **BaseStore** (long-term namespaced) | 7 `stream` modes (`values/updates/tasks/checkpoints/messages/custom/debug`) as discriminated-union `StreamPart`; LangSmith traces |
| **openai-agents-python** | `Agent`, `Runner`/`AgentRunner`, `RunConfig`, `RunState`, `RunHooks`, `Guardrail`, `Handoff`, `Session`, `Tool` (`FunctionTool`, MCP) | `while True` turn loop: input guardrails → model → process response → `NextStep{FinalOutput,Handoff,RunAgain,Interruption}` → execute tools → loop; `max_turns` cap | `FunctionTool`: name, `params_json_schema` (strict), `is_enabled`, `needs_approval`, `failure_error_function`; `tool_use_behavior` (`run_llm_again`/`stop_on_first_tool`/`StopAtTools`); name-collision policy | none built in; orchestrator pattern via **handoffs** / **agents-as-tools** | `Session` iface (in-memory/Redis/SQLAlchemy); `conversation_id`; resumable `RunState` snapshot + rewind | `Trace`/span tree (`task_span`, `agent_span`, `turn_span`, tool spans); `SpanProcessor`; usage snapshot + delta per span; `group_id` + metadata |
| **autogen** (AgentChat) | `Agent` (`AssistantAgent`, `AgentTool`, `UserProxy`), `run(task=…)`, team/group chat, `Memory`, MCP workbench | `model_client` loop with `max_tool_iterations`; Core API = **event-driven message passing**, local + distributed runtime | function tools; `McpWorkbench`; `AgentTool` wraps another agent as a tool | team orchestration patterns; no explicit planner | `Memory` component; event-driven Core runtime | `Console` streaming UI; AutoGen Studio tracing |
| **crewAI** | `Agent` (role/goal/backstory), `Task`, `Crew` (`Process.sequential`/`hierarchical`), `Flow` (`@start/@listen/@router`), `CrewAgentExecutor`, `ToolsHandler` | `_invoke_loop`: max-iter guard → LLM call → parse `AgentAction`/`AgentFinish` → execute tool → append message → inject `post_tool_reasoning` → re-loop | `CrewStructuredTool`: name/desc/args schema, `max_usage_count`, `result_as_answer`, `cache_function`; before/after tool hooks (can block); `convert_tools_to_openai_schema` | **hierarchical process** = auto manager agent plans/delegates/validates; `Flow` `@router` for branching | memory module (short/long/entity), knowledge, file store per crew/task, checkpointing, tool cache | `crewai_event_bus`: `ToolUsage{Started,Finished,Error}` events; telemetry (`OTEL_SDK_DISABLED`); AMP control plane |
| **beeai-framework** | `BaseAgent`, `Workflow` (`addStep`; `START/SELF/PREV/NEXT/END`), `RunContext`, `Emitter`, `Middleware`, `Memory`, `Tool`, `Backend` | `BaseAgent.run()` enters `RunContext` + applies middleware; `Workflow.run()` loops steps until `END`, schema-parsing state each step, emitting `start/error/success` | `Tool` base, MCP tool, `HandoffTool`, `ThinkTool`; requirements (`ConditionalRequirement(ThinkTool, force_at_step=1)`) | Workflows module (deterministic step machine); RequirementAgent rules | `createSnapshot()/loadSnapshot()`, memory strategies, cache module, RAG/vector stores | `Emitter` events, logger, `FrameworkError.explain()`, `GlobalTrajectoryMiddleware` logs all tool calls |

---

## 2. Findings per research question

### 2.1 Agent runtime loop (observe → think → act → observe)

**openai-agents-python** — the cleanest reference for a runner/agent split. `Runner.run()` delegates to `AgentRunner` which holds a `while True:` loop. Each iteration is one **turn** ("one AI invocation, including any tool calls"). The core structure (`src/agents/run.py`, `src/agents/run_internal/run_loop.py`, `run_steps.py`):

```
turn :=
  run input guardrails (first agent only)
  invoke model with [caller input + generated items + session items]
  process_model_response → NextStep:
      NextStepFinalOutput    → stop (validate output_type)
      NextStepHandoff        → swap current_agent, continue (no re-prompt)
      NextStepRunAgain       → execute tool calls → feed results → loop
      NextStepInterruption   → pause for human (approvals), resume later
  max_turns guard → MaxTurnsExceeded
```

Key decisions worth copying: the **step result is a discriminated union** (`NextStep*`) — not a status string; a **`RunState` object** (`original_input`, `generated_items`, `model_responses`, `current_turn`, `current_agent`) is threaded through so the run can be serialized and resumed; and **tool results always return to the LLM** unless `tool_use_behavior` says otherwise.

**crewAI** — two loop implementations in `crew_agent_executor.py`: a text **ReAct** loop (`_invoke_loop_react`) and a **native function-calling** loop (`_invoke_loop_native_tools`). Native loop deliberately executes **only the first tool call**, appends `{role:"tool"}` message, then appends a `post_tool_reasoning` user prompt (`I18N_DEFAULT.slice("post_tool_reasoning")`) forcing reflection before the next model call. Parallel batches run via `ThreadPoolExecutor(max_workers=min(8, len))` with results collected back in call order. Guards: `has_reached_max_iterations(iterations, max_iter)`, `enforce_rpm_limit`, context-length handler (`handle_context_length`) that trims history and `continue`s.

**langgraph** — no ReAct loop per se; the runtime is the **Pregel superstep executor** (`pregel/_algo.py`, `_runner.py`, `_loop.py`). The unit of work is a `PregelExecutableTask {name, input, proc, writes: deque[(channel,value)], config, triggers, retry_policy, cache_key, timeout}`. Each superstep: determine runnable tasks from pending channel writes + edge conditions → run tasks (possibly in parallel) → collect their `writes` → apply writes to channels (through reducers) → persist checkpoint → repeat until no tasks remain.

**autogen** — `AssistantAgent.run(task=…)` is a `model_client` loop bounded by `max_tool_iterations`; the deeper Core API is pure **event-driven message passing** (agents subscribe, runtime routes messages, works local and distributed over gRPC gateway).

**beeai-framework** — `BaseAgent.run()` wraps `_run()` in `RunContext.enter(...).middleware(...)` — i.e. the run loop itself is middleware-wrapped (e.g. `GlobalTrajectoryMiddleware` logs every `Tool` invocation). `Workflow.run()` is a step machine: `while (next && next !== END)`: parse state against the step's zod schema → call handler → handler returns next step name or a reserved token (`__prev__/__next__/__self__/__start__/__end__`) → emit `success`, else emit `error` and throw.

### 2.2 Tool registry

**openai-agents-python** (`agent.py`, `function_tool.py`, `tool.py`):
- `FunctionTool` carries: `name`, `description`, `params_json_schema` (strict mode), `is_enabled` (bool **or** callable checked per-run), `needs_approval` (bool or callable → pauses run for human approval), `failure_error_function` (turns a tool exception into a **model-visible message** instead of crashing the run), `tool_origin` (tags agent-as-tool).
- `AgentBase.get_all_tools()` is the registry read path: it gathers function tools + MCP tools, **filters by `is_enabled` per run**, prunes "orphaned tool search tools", and **validates name collisions** (duplicate Codex tool names → `UserError`).
- Handoffs are **registered as tools** with a computed `handoff.tool_name`; MCP servers can prefix tool names (`include_server_in_tool_names`) to avoid cross-server collisions.

**crewAI** (`crew_agent_executor.py`, `tool_utils.py`):
- `convert_tools_to_openai_schema(original_tools)` → `(openai_tools, available_functions, name_mapping)`; the executor only ever calls `available_functions[name](**args)`.
- Per-tool policy: `max_usage_count` (enforced in the executor: "reached its usage limit… cannot be used anymore"), `result_as_answer` (tool output **is** the final answer — no re-loop), `cache_function` + `ToolsHandler.cache` keyed `(tool_name, input_str)`.
- Hook-based permissioning: `run_before_tool_call_hooks` can **block** execution (result = "Tool execution blocked by hook"), `run_after_tool_call_hooks` can rewrite the result. `sanitize_tool_name()` normalizes provider-specific names.

**langgraph** — `pregel/_tools.py` + `ToolNode` dispatch by tool name; tools defined with `@tool` (pydantic args schema auto-generated). Human-in-the-loop before dangerous tools via `interrupt()`.

**beeai-framework** — `Tool` base; `HandoffTool(agent)` wraps a sub-agent as a tool; `ThinkTool`; **requirements** like `ConditionalRequirement(ThinkTool, force_at_step=1)` force the model to use a specific tool at a specific step — a lightweight "permissioning" mechanism.

### 2.3 Planning

- **crewAI** is the most concrete: `Process.hierarchical` **auto-creates a manager agent** that plans, delegates tasks, and *validates results*; `Flow` gives declarative control (`@start`, `@listen(step)`, `@router(step)` returning the next state key, with `or_`/`and_` conditions). Re-planning = the manager's loop; validation gates are per-task (`expected_output`).
- **langgraph**: plan-and-execute is a *graph pattern*: planner node → executor node → conditional edge back to planner when output fails validation → `Send(node, arg)` for dynamic fan-out, `Command(goto=..., update=...)` to navigate and mutate state from inside a node.
- **openai-agents-python**: no planner primitive; the documented pattern is an **orchestrator agent that hands off** to worker agents, with `output_type` enforcing structured planner output and guardrails validating it.
- **beeai-framework**: planning is either a deterministic `Workflow` or enforced via requirements (think before acting); no LLM planner built in.
- **autogen**: group-chat / selector-agent based decomposition.

Takeaway for a hybrid planner: **keep the heuristic as the fallback but give the LLM path a strict output schema and a validation step that can trigger re-planning** (that is exactly crewAI's manager-validates pattern and openai's output_type + guardrail).

### 2.4 Task queues / scheduling / concurrency

- **langgraph** is the richest: **supersteps**. Per-step the executor computes the task list from pending writes and edge conditions; fan-in is a **`NamedBarrierValue`** channel that only fires when *all* named predecessors wrote; fan-out is `Send(node, arg)` (map-reduce: one node returns `[Send("gen", {"subject": s}) for s in subjects]`, results aggregate via an `operator.add` reducer). Tasks within a superstep run concurrently (`_executor.py`); each `PregelExecutableTask` has `retry_policy` (`RetryPolicy{initial_interval, backoff_factor, max_interval, max_attempts, jitter, retry_on}`) and `timeout`. Durability is per-checkpoint: `sync` (persist before next step), `async`, or `exit`.
- **crewAI**: parallel tool calls ordered via futures index map; task dependencies; `Flow` `@listen` triggers.
- **openai-agents-python**: parallelism only for guardrails/tools via `gather_with_cancel`; no scheduler (single-run oriented).

### 2.5 Memory / persistence

- **langgraph** — the model to copy. Two layers:
  - **Checkpointer = short-term thread memory**: `BaseCheckpointSaver` (`get_tuple(thread_id, checkpoint_id)`, `put`, `list`, `put_writes`). A checkpoint is a per-superstep snapshot of all channel values + the `next` tasks + `parent_config` (link to previous checkpoint). `StateSnapshot {values, next, config, metadata, created_at, parent_config, tasks, interrupts}`. Resume = load checkpoint, replay from exactly where it stopped. `thread_id` keys a run.
  - **Store = long-term memory**: `BaseStore` with namespaced writes (e.g. per-user, per-session knowledge).
- **openai-agents-python**: `Session` interface (`InMemorySession`, `RedisSession`, SQLAlchemy) — conversation items persisted per turn, with a `session_input_callback`; `RunState.to_state()` gives a fully resumable snapshot; guardrail trips **rewind** the persisted session. Token/usage is snapshotted and delta-attached to spans.
- **crewAI**: memory module (short/long/entity), per-crew/task file store, checkpointing, and a tool result cache.
- **beeai-framework**: `createSnapshot()/loadSnapshot()` on agents and workflows (serialization module), memory strategies, cache, RAG vector stores.

### 2.6 Observability

- **openai-agents-python** — best-in-class, and directly portable:
  - `Trace` = one logical workflow (`workflow_name`, `trace_id` `trace_<32hex>`, `group_id`, `metadata`); spans nest under it: `task_span` (whole run) → `agent_span` (per current agent) → `turn_span` (per LLM turn) → function-tool / handoff / guardrail spans.
  - **Usage accounting**: `snapshot_usage()` at task start, `usage_delta()` + `attach_usage_to_span()` at finish — so every span carries its own token delta; totals roll up to the trace.
  - `SpanProcessor` plug-in point for exporters; `NoOpTrace` when disabled; `ReattachedTrace` to resume a trace from persisted `TraceState` (persists only a **hash** of the tracing API key).
- **crewAI** — event bus: `ToolUsageStartedEvent/FinishedEvent/ErrorEvent` carry `tool_name`, `tool_args`, `started_at`, `finished_at`, `agent_key`, `from_agent/from_task`. Telemetry disable via `OTEL_SDK_DISABLED`.
- **langgraph** — `stream(version="v2")` emits a **discriminated union** of typed parts: `values` (full state after each step), `updates` (node → output), `tasks` (task start/finish with `id,name,input,triggers,error,result`), `checkpoints`, `messages`, `custom` (via `StreamWriter`), `debug`.
- **beeai-framework** — `Emitter` events `start/error/success` on runs and steps; `FrameworkError.explain()`; trajectory middleware.

---

## 3. Adoptable design patterns for the Node.js orchestrator

Mapped to current files (`server/orchestrator.js`, `server/planner.js`, `server/skills.js`, `server/store.js`, WebSocket fan-out in `server/index.js`). Current gaps these close: progress is simulated not state-machine driven; dispatch uses raw `setTimeout` staggering; state is one monolithic `state.json`; broadcast is whole-state-only; no run/turn/span structure; no tool schema or permissioning.

**P1. Step result as a discriminated union (`NextStep`-style).** (openai-agents-python `run_steps.py`)
Replace the "progress += random" mutation in `tickAgents()` with a real state machine. Each agent loop iteration returns one of:
```js
// server/agent.js
export const NextStep = {
  finalOutput: (output) => ({ type: 'final', output }),
  handoff:     (agent)   => ({ type: 'handoff', agent }),
  runAgain:    (toolResults) => ({ type: 'run_again', toolResults }),
  interrupt:   (reason)  => ({ type: 'interrupt', reason }),
}
```
`tickAgents()` just consumes `step.type` — no ad-hoc branching on progress values.

**P2. Split `AgentSpec` (config) from the `AgentRuntime` (loop).** (openai `Agent` vs `Runner`; crewAI `CrewAgentExecutor` owns loop; beeai `BaseAgent.run`)
```js
// server/agent.js
class AgentRuntime {
  constructor({ agent, model, tools, maxTurns = 20, hooks }) {}
  async run(input, state) { /* P1 loop */ }
}
// server/agents/*.js — specs
export const AGENTS = {
  CODA: { instructions: '…', tools: ['coder', 'shell'], outputType: null, maxTurns: 20, hooks: {} },
}
```
Keeps `orchestrator.js` as pure coordination, not the loop.

**P3. Lifecycle hooks + an emitter (the missing observability seam).** (openai `RunHooks`; beeai `Emitter` + middleware; crewAI before/after hooks)
```js
// server/lifecycle.js
const hooks = {
  onRunStart(run), onAgentStart(agent), onTurnStart(turn),
  onToolCall({ tool, input }), onToolResult({ tool, output, ms }),
  onRunEnd(run),
}
```
Wire your existing `log()` / `pushChat()` / `broadcast()` into these hooks. This is a 20-line refactor of `orchestrator.js` that makes every later feature (traces, metrics) a hook subscriber.

**P4. `maxTurns` / `maxIterations` guards + `RetryPolicy` + timeout.** (openai `MaxTurnsExceeded`; crewAI `has_reached_max_iterations`; langgraph `RetryPolicy`)
```js
const RETRY = { maxAttempts: 3, initialInterval: 500, backoff: 2, maxInterval: 8000, jitter: true, retryOn: [/network|timeout|429/] }
```
Every tool/agent invocation goes through `withRetry(policy, fn)`; a run that exceeds `maxTurns` transitions the agent to `error` with a visible `log` instead of spinning forever.

**P5. Tool schema registry with permissioning.** (openai `FunctionTool.is_enabled/needs_approval/failure_error_function`; crewAI `max_usage_count/result_as_answer/cache_function` + hook blocking)
Upgrade `server/skills.js` from `{ label, desc, execute }` to:
```js
{
  name: 'shell', label: 'SHELL',
  description: 'Run validated command sequences',
  parameters: { type: 'object', properties: { cmd: { type: 'string' } }, required: ['cmd'] },
  isEnabled: (ctx) => ctx.agent !== 'NUDGE',            // callable per-run
  needsApproval: (ctx) => ctx.input?.cmd.includes('rm'), // → P12 interrupt
  maxUsageCount: 10,
  resultAsAnswer: false,
  failureErrorFunction: (err) => `Tool failed: ${err.message}`,
  cacheFunction: (args, out) => out.exit === 0,
  execute(ctx) { … }
}
```
Add a `sanitizeToolName()` + a build-time `validateUniqueNames(SKILLS)` check that throws on collisions (openai raises `UserError` on duplicate names) — cheap insurance for MCP-style additions later.

**P6. The tool cycle: parse → execute (ordered-parallel) → reflect → re-loop, with `result_as_answer` fast path.** (crewAI `_invoke_loop_native_tools`; openai `tool_use_behavior`)
```js
// within AgentRuntime
const calls = parseToolCalls(modelOutput)          // JSON-args → objects, skip malformed
const results = await runOrdered(calls.slice(0, MAX_TOOLS_PER_TURN), availableFns) // preserve call order
for (const r of results) {
  messages.push({ role: 'tool', tool_call_id: r.id, content: r.output })
  if (toolDef(r.name)?.resultAsAnswer) return NextStep.finalOutput(r.output)   // no re-loop
}
messages.push({ role: 'user', content: 'Reason about the tool results and continue.' }) // post_tool_reasoning
return NextStep.runAgain(results)
```
Note crewAI executes **only the first call** for reflection; the parallel variant caps workers at 8 and re-orders by original index.

**P7. Supervisor-style delegation instead of raw dispatch.** (openai `handoff`/agents-as-tools; crewAI hierarchical manager)
`handleChat()` currently staggers `setTimeout(i * 2500)`. Replace with a `supervisor` agent that plans and returns `handoff` steps; the orchestrator enqueues `{ to: agent, task }` messages to a proper queue (see P8) and the workflow only advances when the current handoff's job reaches `done`. Handoffs are **tools** (`AGENT_TOOLS = { CODA: HandoffTool(codaSpec) }`) so the LLM can name an agent — mirrors openai's `handoff.tool_name`.

**P8. Superstep task queue with fan-in barrier (map-reduce).** (langgraph `Send`, `NamedBarrierValue`, supersteps)
Model the workflow as a DAG of steps; each superstep runs all runnable steps concurrently; a step with `dependsOn: ['a','b']` only runs once both wrote. In `server/planner.js`, return steps with explicit `dependsOn`/`agent`/`tool`, and add a tiny scheduler:
```js
// server/scheduler.js
export function createSuperstepScheduler() {
  // runnable = steps whose deps are all {status:'done'}; fan-in check is the barrier
  // each completed step writes {stepId, status} to a SharedState channel keyed by workflow
  // emit 'workflow:step' events (→ P10) for every start/finish
}
```
This replaces the `curStep = floor(progress/100 * steps.length)` linear assumption with a true dependency graph.

**P9. State = typed channels with reducers (replace blind JSON mutation).** (langgraph channels: `LastValue`, `BinaryOperatorAggregate`; `Command(update=…)`; `Overwrite`)
Define reducers per state key so concurrent superstep writes merge safely:
```js
// server/state-schema.js
export const STATE_SCHEMA = {
  messages: { reducer: (prev, next) => [...prev, ...next] },   // append
  tokenTotal: { reducer: (a, b) => a + b },                    // sum
  logs: { reducer: (prev, next) => [...prev, ...next].slice(-200) },
  telemetry: { reducer: 'last' },                              // overwrite
}
```
Centralize all mutations through `applyUpdate(path, value)` instead of `this.s.telemetry.temp = …` scattered across tick functions. This is what enables P10's event stream and P11's checkpoints to stay consistent.

**P10. Checkpointing: versioned snapshots keyed by `(threadId, checkpointId)` with parent pointers + rewind.** (langgraph `BaseCheckpointSaver` / `StateSnapshot`; openai resumable `RunState`)
Upgrade `server/store.js`: keep `state.json` as the **latest live state**, but persist a ring buffer of checkpoints `{ id, parent, ts, values }` (deep-cloned at each superstep boundary / every N ticks). Adds:
- resume-from-interrupt (P12) needs the pre-interrupt snapshot;
- a "rollback last step" operator command for free (openai literally rewinds session items on guardrail trips);
- durability modes `'sync' | 'async' | 'exit'` (langgraph) — start with `async` (current debounced flush) and offer `sync` for state mutations that must not be lost.
Two-layer split to also adopt: **`store` (append-only vault, e.g. mission log / knowledge) vs `checkpoint` (rewindable working state)** — currently everything lives in one `state.json`.

**P11. Interrupts for human-in-the-loop.** (langgraph `interrupt()` + `Command(resume=…)`; openai approvals)
`needsApproval` on a tool (P5) emits a workflow-level `{ type: 'interrupt', id, tool, input }` event; the workflow's state is checkpointed (P10) and the run **pauses** (no tick progress). A `Command({ resume: { ok } })` from the HUD (a new WS message type) resumes the exact task. Cheap to add once P9/P10 exist — and it's the difference between a demo and a "production-ready" claim.

**P12. Trace/span tree with token accounting, streamed over the existing WebSocket fan-out.** (openai `Trace`/spans + `snapshot_usage`/`usage_delta`; langgraph `stream` modes; crewAI event bus)
Use `node:async_hooks` `AsyncLocalStorage` (Node's `contextvars`) to carry a `Span` chain:
```js
// server/tracing.js
const als = new AsyncLocalStorage()
export const trace = (name, meta) => als.run(new Span({ name, id: `span_${rand}`, groupId: wf.id, parent: als.getStore() }), fn)
export const usage = { snapshot(ctx), delta(start) } // attach {inTokens,outTokens,ms} per span
```
Broadcast two channels instead of one:
- `state` snapshots (existing, debounced 1500 ms — keep as-is);
- `events` — fine-grained discriminated union `{ type: 'workflow:step' | 'task:start' | 'task:finish' | 'tool:start' | 'tool:finish' | 'interrupt' | 'span' }`, mirroring langgraph's `StreamPart` (`type` field + payload). Every `tool:finish` event carries `{ tool, ms, inTokens, outTokens }` — token accounting per span, rolled up to the run.

---

## 4. Suggested implementation order (lowest risk first)

1. **P5 + P6** — schema-ify skills and implement the parse/execute/reflect cycle in a new `server/agent.js` (pure, testable, no state changes).
2. **P3 + P12** — hooks + AsyncLocalStorage spans + typed `events` on the WS fan-out. Do this early: it makes everything else debuggable.
3. **P1 + P4** — `NextStep` state machine + maxTurns/retry in the agent runtime; rewire `tickAgents()` to consume it.
4. **P9 + P10** — channel/reducer state layer + checkpoint ring in `store.js` (largest refactor; do after the agent runtime is stable).
5. **P7 + P8** — replace `setTimeout` dispatch with the supervisor-handoff + superstep scheduler driving workflows from the DAG.
6. **P11** — interrupts (requires P9/P10), wired to a new WS `command` message type.

Patterns above cite **openai-agents-python** (P1, P2, P3, P4, P5, P11, P12), **crewAI** (P3, P4, P5, P6, P7), **langgraph** (P4, P8, P9, P10, P11, P12), **beeai-framework** (P3, P12). **autogen** contributed the "event-driven runtime" mindset (P3/P8) and the "wrapping agents as tools" idea (P7).
