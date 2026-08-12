/**
 * SKILLS // Typed tool registry agents use to execute steps.
 *
 * Every skill carries structured metadata — name, label, description, an
 * explicit parameter schema, approval/usage policy — plus an executor that
 * mutates shared state and emits log lines. Skills are intentionally sandboxed
 * / simulated; extend `executors` to add real integrations (shell, file
 * system, APIs).
 */

export const SKILLS = {
  search: {
    name: 'search',
    label: 'SEARCH',
    description: 'Semantic search over internal + public sources',
    parameters: [{ name: 'query', type: 'string', required: true, desc: 'Search query text' }],
    needsApproval: false,
    maxUsageCount: Infinity,
    async execute(ctx) {
      ctx.log('INFO', 'search: query executed · 14 results ranked')
      return { results: 14 }
    }
  },
  shell: {
    name: 'shell',
    label: 'SHELL',
    description: 'Run validated command sequences',
    parameters: [{ name: 'command', type: 'string', required: true, desc: 'Command sequence to execute' }],
    needsApproval: false,
    maxUsageCount: Infinity,
    async execute(ctx) {
      ctx.log('INFO', 'shell: command ran clean · exit 0')
      return { exit: 0 }
    }
  },
  coder: {
    name: 'coder',
    label: 'CODER',
    description: 'Generate and review source changes',
    parameters: [{ name: 'files', type: 'array', required: false, desc: 'Files to generate or review' }],
    needsApproval: false,
    maxUsageCount: Infinity,
    async execute(ctx) {
      ctx.log('OK', 'coder: diff generated · review queue updated')
      return { files: 2 }
    }
  },
  memory: {
    name: 'memory',
    label: 'MEMORY',
    description: 'Read/write the persistent knowledge vault',
    parameters: [{ name: 'blob', type: 'string', required: false, desc: 'Blob key to read or write' }],
    needsApproval: false,
    maxUsageCount: Infinity,
    async execute(ctx) {
      const blob = ctx.params && ctx.params.blob ? String(ctx.params.blob).slice(0, 48) : 'core bank'
      const doc = vaultWrite(ctx, {
        title: `${ctx.agent || 'ORCH'} checkpoint — ${blob}`,
        type: 'MEMORY',
        tags: ['CORE', 'AI']
      })
      ctx.log('OK', `memory: checkpoint written to core bank (${doc.id})`)
      return { blobs: 1, id: doc.id }
    }
  },
  files: {
    name: 'files',
    label: 'FILES',
    description: 'Inspect and organize workspace blobs',
    parameters: [{ name: 'path', type: 'string', required: false, desc: 'Directory or blob path to inspect' }],
    needsApproval: false,
    maxUsageCount: Infinity,
    async execute(ctx) {
      const path = ctx.params && ctx.params.path ? String(ctx.params.path).slice(0, 48) : 'workspace'
      const doc = vaultWrite(ctx, {
        title: `${ctx.agent || 'LINK'} scan — ${path}`,
        type: 'SCHEMA',
        tags: ['FILES', 'DATA']
      })
      ctx.log('INFO', `files: directory scanned · 0 anomalies (${doc.id})`)
      return { scanned: 128, id: doc.id }
    }
  },
  terminal: {
    name: 'terminal',
    label: 'TERMINAL',
    description: 'Interactive operator console bridge',
    parameters: [{ name: 'command', type: 'string', required: false, desc: 'Terminal command to bridge' }],
    needsApproval: false,
    maxUsageCount: Infinity,
    async execute(ctx) {
      ctx.log('INFO', 'terminal: pty bridged · idle')
      return { ok: true }
    }
  },
  hermes: {
    name: 'hermes',
    label: 'HERMES',
    description: 'Delegate a task to the always-on Hermes agent via its WebUI',
    parameters: [{ name: 'prompt', type: 'string', required: true, desc: 'Prompt sent to Hermes' }],
    needsApproval: false,
    maxUsageCount: Infinity,
    async execute(ctx) {
      const prompt = (ctx.params && ctx.params.prompt) || ctx.step || ctx.task || 'Complete the assigned task and report back.'
      const client = ctx.hermes
      if (!client || !client.isEnabled()) {
        ctx.log('WARN', 'hermes: not configured — simulated fallback')
        return { delegated: false, simulated: true, result: 'Simulated (USER_HERMES_URL not set)' }
      }
      const mode = ctx.approvalMode || 'prompt'
      const handleApproval = async (data) => {
        try {
          if (mode === 'always') {
            await client.approvalRespond('always')
            return
          }
          if (mode === 'never') {
            await client.approvalRespond('never')
            return
          }
          const choice = await ctx.awaitApproval(data)
          if (choice === 'approve') await client.approvalRespond('once')
          else await client.approvalRespond('never')
        } catch (e) {
          ctx.log('WARN', `hermes: approval handling failed — ${e.message}`)
        }
      }
      try {
        let res
        try {
          res = await client.streamChat(prompt, { onApproval: handleApproval })
        } catch (streamErr) {
          ctx.log('WARN', `hermes: stream failed (${streamErr.message}) — falling back to blocking chat`)
          res = await client.syncChat(prompt)
        }
        const result = (res.final_response || '').slice(0, 160)
        ctx.log('OK', `hermes: delegated → ${result.slice(0, 80)}`)
        const doc = vaultWrite(ctx, {
          title: `Hermes delegate — ${prompt.slice(0, 36)}`,
          type: 'DELEGATE',
          tags: ['HERMES', 'AI']
        })
        return { delegated: true, result, tokens: res.tokens || 0, session_id: res.session_id, doc: doc.id }
      } catch (err) {
        ctx.log('WARN', `hermes: call failed — ${err.message}`)
        return { error: err.message }
      }
    }
  }
}

const REQUIRED_KEYS = ['name', 'label', 'description', 'parameters', 'needsApproval', 'maxUsageCount', 'execute']

const MAX_VAULT = 30

/** Append a real document to the canonical vault state (persisted via store). */
function vaultWrite(ctx, { title, type, tags }) {
  const doc = {
    id: `v${Date.now()}${Math.floor(Math.random() * 99)}`,
    title,
    type,
    tags,
    size: '12KB',
    updated: 'just now',
    agent: ctx.agent || 'ORCH'
  }
  ctx.s.vault.unshift(doc)
  if (ctx.s.vault.length > MAX_VAULT) ctx.s.vault.pop()
  return doc
}

/**
 * Validate the tool registry. Throws on duplicate names or malformed entries.
 * Call once at startup.
 */
export function validateSkills() {
  const names = new Set()
  const entries = Object.entries(SKILLS)
  if (entries.length === 0) throw new Error('skills: registry is empty')
  for (const [key, skill] of entries) {
    if (!skill || typeof skill !== 'object') {
      throw new Error(`skills: entry "${key}" must be an object`)
    }
    if (skill.name !== key) {
      throw new Error(`skills: registry key "${key}" does not match skill.name "${skill.name}"`)
    }
    if (names.has(skill.name)) {
      throw new Error(`skills: duplicate skill name "${skill.name}"`)
    }
    names.add(skill.name)
    for (const k of REQUIRED_KEYS) {
      if (!(k in skill)) {
        throw new Error(`skills: "${skill.name}" is missing required field "${k}"`)
      }
    }
    if (typeof skill.execute !== 'function') {
      throw new Error(`skills: "${skill.name}" execute must be a function`)
    }
    if (!Array.isArray(skill.parameters)) {
      throw new Error(`skills: "${skill.name}" parameters must be an array`)
    }
    for (const p of skill.parameters) {
      if (!p || !p.name || !p.type) {
        throw new Error(`skills: "${skill.name}" has a malformed parameter entry`)
      }
    }
  }
  return true
}

export function getSkill(name) {
  return SKILLS[name] || SKILLS.search
}

export function runSkill(name, ctx) {
  const skill = getSkill(name)
  return skill.execute(ctx)
}
