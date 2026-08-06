/**
 * CONFIG // Fleet, workflows, tools, agenda, telemetry
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
    tokens: 48.2
  },
  {
    id: 'coda',
    name: 'CODA',
    role: 'SOFTWARE ENGINEER',
    state: 'busy',
    task: 'Implementing vector-store ingest service',
    progress: 62,
    tokens: 31.9
  },
  {
    id: 'pilot',
    name: 'PILOT',
    role: 'DEVOPS // RELEASE ENGINEER',
    state: 'busy',
    task: 'Rolling out canary build v1.4.2',
    progress: 44,
    tokens: 12.4
  },
  {
    id: 'sage',
    name: 'SAGE',
    role: 'RESEARCH // ANALYSIS',
    state: 'active',
    task: 'Summarizing weekly telemetry digest',
    progress: 91,
    tokens: 22.7
  },
  {
    id: 'link',
    name: 'LINK',
    role: 'COMMS // INTEGRATIONS',
    state: 'idle',
    task: 'Standing by for incoming webhooks',
    progress: 0,
    tokens: 8.1
  },
  {
    id: 'nudge',
    name: 'NUDGE',
    role: 'PM // REMINDERS',
    state: 'idle',
    task: 'Awaiting agenda triggers',
    progress: 0,
    tokens: 3.5
  }
]

export const WORKFLOWS = [
  {
    id: 'wf1',
    name: 'SURFACE ANAYSIS SWEEP',
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
