/**
 * VAULT SUITE // Filesystem knowledge core (P14).
 *
 * Guards markdown + front matter roundtrip, file-then-state writes, hydrate
 * overlay, id sanitization, and isolation under STELLARIS_DATA_DIR.
 */
import { existsSync, mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

if (!process.env.STELLARIS_DATA_DIR) {
  process.env.STELLARIS_DATA_DIR = mkdtempSync(join(tmpdir(), 'stellaris-vault-'))
}

const {
  vaultWrite,
  hydrateVault,
  serializeVaultMarkdown,
  parseVaultMarkdown,
  writeVaultFile,
  listVaultFiles,
  vaultFilePath,
  safeVaultId,
  MAX_VAULT
} = await import('../server/vault.js')

const results = []
const pass = (name, cond) => results.push(`${cond ? 'PASS' : 'FAIL'} ${name}`)

const sample = {
  id: 'v-round',
  title: 'Context compaction notes',
  type: 'RESEARCH',
  tags: ['AI', 'PERF'],
  size: '2KB',
  updated: 'just now',
  agent: 'SAGE',
  body: 'Window sliding vs semantic summarization vs retrieval sharding.'
}

const md = serializeVaultMarkdown(sample)
const parsed = parseVaultMarkdown(md, 'fallback')
pass(
  'front matter roundtrip preserves fields',
  parsed.id === sample.id &&
    parsed.title === sample.title &&
    parsed.type === sample.type &&
    parsed.tags.join(',') === 'AI,PERF' &&
    parsed.agent === 'SAGE' &&
    parsed.body.includes('Window sliding')
)

const bare = parseVaultMarkdown('plain body only', 'v-bare')
pass('markdown without front matter still hydrates', bare.id === 'v-bare' && bare.body.includes('plain body') && bare.type === 'DOC')

pass('unsafe ids are sanitized', safeVaultId('../etc/passwd') === '.._etc_passwd' && safeVaultId('v ok!') === 'v_ok_')

const ctx = { agent: 'SAGE', s: { vault: [] } }
const doc = vaultWrite(ctx, {
  title: 'P14 filesystem checkpoint',
  type: 'MEMORY',
  tags: ['CORE', 'AI'],
  body: 'Checkpoint written to data/vault as markdown.'
})
pass('vaultWrite appends state row', ctx.s.vault.length === 1 && ctx.s.vault[0].id === doc.id && ctx.s.vault[0].type === 'MEMORY')
pass('vaultWrite writes markdown file first', existsSync(vaultFilePath(doc.id)))
const disk = readFileSync(vaultFilePath(doc.id), 'utf-8')
pass('written file has front matter and body', disk.startsWith('---\n') && disk.includes('type: MEMORY') && disk.includes('Checkpoint written'))
pass('state row carries file basename', ctx.s.vault[0].file === `${doc.id}.md`)

const listed = listVaultFiles()
pass('listVaultFiles sees the written doc', listed.some((d) => d.id === doc.id && d.body.includes('Checkpoint written')))

const foreignId = 'v-disk-only'
mkdirSync(join(process.env.STELLARIS_DATA_DIR, 'vault'), { recursive: true })
writeFileSync(
  vaultFilePath(foreignId),
  serializeVaultMarkdown({
    id: foreignId,
    title: 'Disk-only overlay',
    type: 'DOC',
    tags: ['FILES'],
    size: '1KB',
    updated: 'just now',
    agent: 'LINK',
    body: 'This file existed before hydrate.'
  }),
  'utf-8'
)
const state = { vault: [{ id: doc.id, title: 'stale', type: 'DOC', tags: [], body: 'stale', agent: 'ORCH' }] }
hydrateVault(state)
const overlay = state.vault.find((d) => d.id === doc.id)
const extra = state.vault.find((d) => d.id === foreignId)
pass('hydrate overlays matching ids from files', overlay && overlay.title === 'P14 filesystem checkpoint' && overlay.body.includes('Checkpoint written'))
pass('hydrate prepends file-only docs', extra && extra.title === 'Disk-only overlay' && extra.agent === 'LINK')
pass('hydrate respects MAX_VAULT', state.vault.length <= MAX_VAULT)

const many = { vault: [] }
for (let i = 0; i < MAX_VAULT + 5; i++) {
  vaultWrite({ agent: 'ORCH', s: many }, { title: `cap-${i}`, type: 'DOC', tags: [], body: `n${i}` })
}
pass('vaultWrite caps in-memory list', many.vault.length === MAX_VAULT)

writeVaultFile({
  id: 'v-writefile',
  title: 'Direct write',
  type: 'SCHEMA',
  tags: ['DATA'],
  size: '1KB',
  updated: 'just now',
  agent: 'CODA',
  body: 'Index schema.'
})
pass('writeVaultFile creates target path', existsSync(vaultFilePath('v-writefile')))

console.log(results.join('\n'))
const fails = results.filter((r) => r.startsWith('FAIL'))
console.log(fails.length ? `\n${fails.length} FAILURES` : '\nALL PASS')
process.exit(fails.length ? 1 : 0)
