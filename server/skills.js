/**
 * SKILLS // Tool registry agents use to execute steps.
 * Each skill has an executor that mutates shared state and emits log lines.
 * Skills are intentionally sandboxed / simulated; extend `executors` to add
 * real integrations (shell, file system, APIs).
 */

export const SKILLS = {
  search: {
    label: 'SEARCH',
    desc: 'Semantic search over internal + public sources',
    async execute(ctx) {
      ctx.log('INFO', 'search: query executed · 14 results ranked')
      return { results: 14 }
    }
  },
  shell: {
    label: 'SHELL',
    desc: 'Run validated command sequences',
    async execute(ctx) {
      ctx.log('INFO', 'shell: command ran clean · exit 0')
      return { exit: 0 }
    }
  },
  coder: {
    label: 'CODER',
    desc: 'Generate and review source changes',
    async execute(ctx) {
      ctx.log('OK', 'coder: diff generated · review queue updated')
      return { files: 2 }
    }
  },
  memory: {
    label: 'MEMORY',
    desc: 'Read/write the persistent knowledge vault',
    async execute(ctx) {
      ctx.log('OK', 'memory: checkpoint written to core bank')
      return { blobs: 1 }
    }
  },
  files: {
    label: 'FILES',
    desc: 'Inspect and organize workspace blobs',
    async execute(ctx) {
      ctx.log('INFO', 'files: directory scanned · 0 anomalies')
      return { scanned: 128 }
    }
  },
  terminal: {
    label: 'TERMINAL',
    desc: 'Interactive operator console bridge',
    async execute(ctx) {
      ctx.log('INFO', 'terminal: pty bridged · idle')
      return { ok: true }
    }
  }
}

export function runSkill(name, ctx) {
  const skill = SKILLS[name] || SKILLS.search
  return skill.execute(ctx)
}
