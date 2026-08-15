/**
 * CONFIG // All dashboard data, organized by view.
 * Single source of truth for everything the HUD renders.
 * Edit these arrays to customize the dashboard.
 */

export const SHIP = {
  name: 'STELLARIS-7',
  class: 'CLASS-VII AGENTIC EXPLORATION VESSEL',
  mission: 'DEEP-SPACE ORCHESTRATION',
  coordinates: ['04:35:12', '-12:04:55', '89.2']
}

export const AGENTS = [
  {
    id: 'orch',
    name: 'ORCHESTRATOR',
    role: 'MISSION CONTROL // PLANNER',
    state: 'active',
    task: 'Decomposing goal into sub-missions',
    progress: 78,
    tokens: 48.2,
    summary: 'Mission control — I decompose operator goals into orchestrated multi-agent plans.',
    capabilities: ['planning', 'dispatch', 'workflow', 'search']
  },
  {
    id: 'coda',
    name: 'CODA',
    role: 'SOFTWARE ENGINEER',
    state: 'busy',
    task: 'Implementing vector-store ingest service',
    progress: 62,
    tokens: 31.9,
    summary: 'I scaffold, implement, review and unit-test source changes across the fleet.',
    capabilities: ['shell', 'coder', 'search', 'memory']
  },
  {
    id: 'pilot',
    name: 'PILOT',
    role: 'DEVOPS // RELEASE ENGINEER',
    state: 'busy',
    task: 'Rolling out canary build v1.4.2',
    progress: 44,
    tokens: 12.4,
    summary: 'I stage, release and monitor canary rollouts and release gates.',
    capabilities: ['shell', 'terminal', 'search', 'coder']
  },
  {
    id: 'sage',
    name: 'SAGE',
    role: 'RESEARCH // ANALYSIS',
    state: 'active',
    task: 'Summarizing weekly telemetry digest',
    progress: 91,
    tokens: 22.7,
    summary: 'I research, summarize and synthesize telemetry and findings into reports.',
    capabilities: ['search', 'memory', 'coder', 'hermes']
  },
  {
    id: 'link',
    name: 'LINK',
    role: 'COMMS // INTEGRATIONS',
    state: 'idle',
    task: 'Standing by for incoming webhooks',
    progress: 0,
    tokens: 8.1,
    summary: 'I maintain integrations, webhooks and the reverse-ingest bridge to Hermes.',
    capabilities: ['hermes', 'files', 'memory', 'shell']
  },
  {
    id: 'nudge',
    name: 'NUDGE',
    role: 'PM // REMINDERS',
    state: 'idle',
    task: 'Awaiting agenda triggers',
    progress: 0,
    tokens: 3.5,
    summary: 'I track agendas, reminders and scheduling priorities.',
    capabilities: ['memory', 'files', 'search']
  }
]

export const WORKFLOWS = [
  {
    id: 'wf1',
    name: 'SURFACE ANALYSIS SWEEP',
    state: 'running',
    progress: 68,
    steps: [1, 1, 1, 1, 1, 0, 0],
    curStep: 5,
    agents: 3,
    eta: '12 min'
  },
  {
    id: 'wf2',
    name: 'DEPENDENCY GRAPH REBUILD',
    state: 'running',
    progress: 41,
    steps: [1, 1, 1, 0, 0, 0],
    curStep: 2,
    agents: 2,
    eta: '26 min'
  },
  {
    id: 'wf3',
    name: 'RELEASE PIPELINE v1.4.2',
    state: 'queued',
    progress: 0,
    steps: [0, 0, 0, 0],
    curStep: 0,
    agents: 1,
    eta: '—'
  },
  {
    id: 'wf4',
    name: 'DATA MERGE / ARCHIVE',
    state: 'queued',
    progress: 0,
    steps: [0, 0, 0, 0, 0],
    curStep: 0,
    agents: 2,
    eta: '—'
  }
]

export const TOOLS = [
  { name: 'Coder', icon: 'code', status: 'ok' },
  { name: 'Shell', icon: 'terminal', status: 'ok' },
  { name: 'Browser', icon: 'globe', status: 'ok' },
  { name: 'Search', icon: 'search', status: 'ok' },
  { name: 'Files', icon: 'files', status: 'ok' },
  { name: 'Memory', icon: 'chip', status: 'ok' },
  { name: 'SQL', icon: 'db', status: 'ok' },
  { name: 'MCP Hub', icon: 'plug', status: 'warn' },
  { name: 'Maps', icon: 'map', status: 'ok' },
  { name: 'Mail', icon: 'mail', status: 'ok' },
  { name: 'Calendar', icon: 'cal', status: 'ok' },
  { name: 'Notifier', icon: 'bell', status: 'ok' }
]

export const AGENDA = [
  { time: '08:30', text: 'Standup with fleet crew', type: 'mil' },
  { time: '09:15', text: 'Review PR #482 — ingest service', type: 'dep' },
  { time: '11:00', text: 'Deep-focus coding block', type: 'mil' },
  { time: '13:30', text: 'Agent training / config tuning', type: 'dep' },
  { time: '15:00', text: 'Sprint planning — cycle 42', type: 'mil' },
  { time: '16:30', text: 'Buffer: docs & cleanup', type: 'dep' }
]

/* ============================================================================
   KANBAN
   ============================================================================ */
export const KANBAN_COLUMNS = [
  { id: 'backlog', name: 'BACKLOG', color: 'var(--text-dim)' },
  { id: 'doing', name: 'IN PROGRESS', color: 'var(--line-cyan)' },
  { id: 'review', name: 'IN REVIEW', color: 'var(--warn)' },
  { id: 'done', name: 'DONE', color: 'var(--ok)' }
]

export const KANBAN_CARDS = [
  { id: 'k1', col: 'backlog', title: 'Design auth refresh flow', agent: 'CODA', prio: 'P1', tags: ['BACKEND', 'AUTH'] },
  { id: 'k2', col: 'backlog', title: 'Migrate legacy importers', agent: 'SAGE', prio: 'P2', tags: ['DATA'] },
  { id: 'k3', col: 'backlog', title: 'Wire telemetry to vault', agent: 'LINK', prio: 'P2', tags: ['INTEGRATION'] },
  { id: 'k4', col: 'doing', title: 'Vector-store ingest service', agent: 'CODA', prio: 'P1', tags: ['BACKEND', 'AI'] },
  { id: 'k5', col: 'doing', title: 'Canary rollout v1.4.2', agent: 'PILOT', prio: 'P1', tags: ['RELEASE'] },
  { id: 'k6', col: 'doing', title: 'Weekly telemetry digest', agent: 'SAGE', prio: 'P3', tags: ['REPORT'] },
  { id: 'k7', col: 'review', title: 'Search index scoring', agent: 'CODA', prio: 'P2', tags: ['SEARCH'] },
  { id: 'k8', col: 'review', title: 'Webhook replay mechanism', agent: 'LINK', prio: 'P1', tags: ['INTEGRATION'] },
  { id: 'k9', col: 'done', title: 'HUD mission control shell', agent: 'ORCH', prio: 'P1', tags: ['UI'] },
  { id: 'k10', col: 'done', title: 'Galaxy render pipeline', agent: 'CODA', prio: 'P2', tags: ['3D'] }
]

/* ============================================================================
   OPEN ITEMS / ISSUES
   ============================================================================ */
export const OPEN_ITEMS = [
  { id: 'OPS-1042', title: 'Ratelimit spike on ingress gateway', type: 'INCIDENT', prio: 'P1', assignee: 'PILOT', status: 'open', due: 'TODAY' },
  { id: 'BUG-313', title: 'Galaxy shader flicker on AMD GPUs', type: 'BUG', prio: 'P2', assignee: 'CODA', status: 'open', due: '+2D' },
  { id: 'PR-482', title: 'Vector-store ingest service', type: 'PR', prio: 'P1', assignee: 'CODA', status: 'review', due: 'TODAY' },
  { id: 'TASK-908', title: 'Update agent role descriptors', type: 'TASK', prio: 'P3', assignee: 'NUDGE', status: 'open', due: '+5D' },
  { id: 'OPS-1041', title: 'Certificate renewal for *.monkeycode-ai.live', type: 'INCIDENT', prio: 'P2', assignee: 'PILOT', status: 'watch', due: '+3D' },
  { id: 'BUG-311', title: 'Comms log duplicate entries on reconnect', type: 'BUG', prio: 'P2', assignee: 'LINK', status: 'open', due: '+1D' },
  { id: 'TASK-901', title: 'Research: context-window compaction strategies', type: 'RESEARCH', prio: 'P2', assignee: 'SAGE', status: 'open', due: '+4D' },
  { id: 'PR-479', title: 'Telemetry snapshot archiver', type: 'PR', prio: 'P3', assignee: 'SAGE', status: 'merged', due: '—' }
]

/* ============================================================================
   SCHEDULED TASKS
   ============================================================================ */
export const SCHEDULED_TASKS = [
  { id: 'c1', name: 'Telemetry snapshot → core bank', cron: '*/15 * * * *', agent: 'SAGE', next: '12:00', dur: '8s', last: 'OK' },
  { id: 'c2', name: 'Dependency graph rebuild', cron: '0 * * * *', agent: 'CODA', next: '13:00', dur: '2m', last: 'OK' },
  { id: 'c3', name: 'Webhook drain / replay sweep', cron: '*/5 * * * *', agent: 'LINK', next: '11:50', dur: '14s', last: 'OK' },
  { id: 'c4', name: 'Daily agenda push', cron: '0 7 * * *', agent: 'NUDGE', next: '+18h', dur: '3s', last: 'OK' },
  { id: 'c5', name: 'Weekend archive compaction', cron: '0 2 * * SAT', agent: 'PILOT', next: 'SAT', dur: '9m', last: 'OK' },
  { id: 'c6', name: 'Model finetune checkpoint', cron: '0 4 * * *', agent: 'SAGE', next: '04:00', dur: '34m', last: 'WARN' }
]

/* ============================================================================
   ORCHESTRATION / CHAT
   ============================================================================ */
export const CHAT_SEED = [
  { from: 'USER', text: 'Orchestrator — decompose the monthly hygiene sweep and surface a plan.' },
  { from: 'ORCH', text: 'Acknowledged. Decomposing into 4 sub-missions: surface analysis, dependency rebuild, release gate, archive. Dispatching to fleet.' },
  { from: 'CODA', text: 'Taking SURFACE ANALYSIS SWEEP. Pulling repo index and running static pass.' },
  { from: 'SAGE', text: 'Research thread open: compaction strategies benchmark (TASK-901).' },
  { from: 'LINK', text: 'Webhook drain normal. 0 failures in last 15m.' },
  { from: 'PILOT', text: 'Canary v1.4.2 at 44%. Health checks passing, latency flat.' }
]

/* ============================================================================
   VAULT / KNOWLEDGE
   ============================================================================ */
export const VAULT_DOCS = [
  { id: 'v1', title: 'System architecture overview', type: 'DOC', tags: ['ARCH', 'INTERNAL'], size: '1.2MB', updated: '2h ago', agent: 'ORCH' },
  { id: 'v2', title: 'Agent fleet operating manual', type: 'DOC', tags: ['OPS', 'RUNBOOK'], size: '840KB', updated: '5h ago', agent: 'NUDGE' },
  { id: 'v3', title: 'Vector store ingest schemas', type: 'SCHEMA', tags: ['DATA', 'SQL'], size: '96KB', updated: '30m ago', agent: 'CODA' },
  { id: 'v4', title: 'Release checklist v1.4.x', type: 'CHECKLIST', tags: ['RELEASE'], size: '48KB', updated: '1d ago', agent: 'PILOT' },
  { id: 'v5', title: 'Context compaction research', type: 'RESEARCH', tags: ['AI', 'PERF'], size: '2.1MB', updated: '3h ago', agent: 'SAGE' },
  { id: 'v6', title: 'Webhook contract reference', type: 'API', tags: ['INTEGRATION'], size: '64KB', updated: '12h ago', agent: 'LINK' }
]

/* ============================================================================
   EMAIL
   ============================================================================ */
export const EMAILS = [
  { from: 'coda@stellaris.internal', subject: 'PR #482 ready for review — ingest service', preview: 'Implemented chunked ingestion with retry backoff. Tests green, 92% coverage.', time: '09:14', label: 'CODE', read: false, prio: 'high' },
  { from: 'pilot@stellaris.internal', subject: 'Canary v1.4.2 — rollout status', preview: '44% of nodes upgraded. Error budget steady at 0.01%.', time: '09:02', label: 'OPS', read: false, prio: 'high' },
  { from: 'nudge@stellaris.internal', subject: 'Daily agenda — 11:00 deep-focus block', preview: 'Reminder: 90-minute deep-focus coding block starts in 15m.', time: '08:45', label: 'PM', read: true, prio: 'med' },
  { from: 'sage@stellaris.internal', subject: 'Weekly telemetry digest v9', preview: 'Summarizing token spend, latency percentiles, and context pressure.', time: '08:30', label: 'REPORT', read: true, prio: 'med' },
  { from: 'link@stellaris.internal', subject: 'Webhook signature rotation notice', preview: 'Rotating signing keys at 00:00 UTC. Overlap window provided.', time: '07:55', label: 'SEC', read: true, prio: 'high' },
  { from: 'github@external', subject: 'Security alert: dependency advisory', preview: 'Two advisories affect runtime deps. Triaged as low severity.', time: '06:12', label: 'SEC', read: true, prio: 'med' }
]

/* ============================================================================
   CALENDAR
   ============================================================================ */
export const CALENDAR_EVENTS = [
  { day: 0, start: '08:30', end: '09:00', title: 'Fleet standup', type: 'mil', agents: ['ALL'] },
  { day: 0, start: '09:15', end: '10:00', title: 'PR #482 review', type: 'dep', agents: ['CODA'] },
  { day: 0, start: '11:00', end: '12:30', title: 'Deep-focus block', type: 'mil', agents: ['USER'] },
  { day: 1, start: '10:00', end: '10:45', title: 'Agent config tuning', type: 'dep', agents: ['ORCH'] },
  { day: 1, start: '14:00', end: '15:00', title: 'Release gate review', type: 'mil', agents: ['PILOT'] },
  { day: 2, start: '09:00', end: '09:45', title: 'Research sync', type: 'dep', agents: ['SAGE'] },
  { day: 3, start: '13:30', end: '14:30', title: 'Sprint planning — cycle 42', type: 'mil', agents: ['ALL'] },
  { day: 4, start: '16:30', end: '17:00', title: 'Docs & cleanup buffer', type: 'dep', agents: ['USER'] }
]

/* ============================================================================
   ALERTS
   ============================================================================ */
export const ALERTS = [
  { id: 'a1', sev: 'warn', source: 'INGRESS', title: 'Ratelimit threshold approaching', detail: 'Edge gateway at 82% of token bucket.', time: '2m ago' },
  { id: 'a2', sev: 'info', source: 'SCHEDULER', title: 'Checkpoint job completed with warning', detail: 'Model finetune checkpoint took 34m (p95 28m).', time: '11m ago' },
  { id: 'a3', sev: 'crit', source: 'CERT', title: 'Certificate renewal due in 3 days', detail: '*.monkeycode-ai.live wildcard expires +3D.', time: '31m ago' },
  { id: 'a4', sev: 'info', source: 'VAULT', title: 'Backup dedup complete', detail: 'Compacted 1.9GB across 214 blobs.', time: '1h ago' },
  { id: 'a5', sev: 'warn', source: 'FLEET', title: 'Context load spike recorded', detail: 'CODA reached 84% context during ingest batch.', time: '2h ago' }
]

/* ============================================================================
   RESEARCH REPORTS
   ============================================================================ */
export const REPORTS = [
  { id: 'r1', title: 'Context-window compaction strategies', author: 'SAGE', status: 'draft', tags: ['AI', 'PERF'], updated: '3h ago', abstract: 'Comparative benchmark of window sliding, semantic summarization and retrieval sharding across 3 task classes.' },
  { id: 'r2', title: 'Ingress latency percentile review — cycle 41', author: 'PILOT', status: 'published', tags: ['OPS', 'SLO'], updated: '1d ago', abstract: 'p50 84ms / p95 210ms / p99 402ms. SLO 99.9% sustained over trailing 7 days.' },
  { id: 'r3', title: 'Multi-agent handoff quality analysis', author: 'ORCH', status: 'review', tags: ['ORCH', 'AI'], updated: '6h ago', abstract: 'Handoff token cost and success-rate scoring across 1,200 orchestrated tasks.' },
  { id: 'r4', title: 'Vault ingestion backpressure study', author: 'CODA', status: 'published', tags: ['DATA'], updated: '2d ago', abstract: 'Backpressure thresholds for write-behind queues to protect the core bank.' }
]

/* ============================================================================
   SYSTEM HEALTH (additional probes)
   ============================================================================ */
export const PROBES = [
  { name: 'INGRESS', value: 82, unit: '%', warnAt: 75, critAt: 92 },
  { name: 'SCHEDULER', value: 100, unit: '%', warnAt: 0, critAt: 0 },
  { name: 'VAULT', value: 64, unit: '%', warnAt: 85, critAt: 95 },
  { name: 'CORE BANK', value: 71, unit: '%', warnAt: 80, critAt: 92 },
  { name: 'MODEL API', value: 55, unit: '%', warnAt: 70, critAt: 90 },
  { name: 'RELEASE', value: 100, unit: '%', warnAt: 0, critAt: 0 }
]
