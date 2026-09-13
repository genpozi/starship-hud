/**
 * VAULT // Filesystem knowledge core (`data/vault/*.md` + front matter).
 *
 * Skills write the markdown file first, then the in-memory state row.
 * Hydrate overlays files onto `state.vault` on orbit boot. Honors
 * `STELLARIS_DATA_DIR`. Never throws into the orbit.
 */

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

export const MAX_VAULT = 30

export function dataDir() {
  return process.env.STELLARIS_DATA_DIR ? join(process.env.STELLARIS_DATA_DIR) : join(__dirname, '..', 'data')
}

export function vaultDir() {
  return join(dataDir(), 'vault')
}

export function safeVaultId(id) {
  const raw = String(id || '').trim() || `v${Date.now()}`
  return raw.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 80)
}

function ensureVaultDir() {
  try {
    mkdirSync(vaultDir(), { recursive: true })
  } catch {
    // orbit never crashes on vault IO
  }
}

export function serializeVaultMarkdown(doc) {
  const tags = Array.isArray(doc.tags) ? doc.tags.join(', ') : String(doc.tags || '')
  const title = String(doc.title || doc.id || 'untitled')
  const type = String(doc.type || 'DOC')
  const agent = String(doc.agent || 'ORCH')
  const updated = String(doc.updated || 'just now')
  const size = String(doc.size || '1KB')
  const body = String(doc.body || '')
  return `---
id: ${doc.id}
title: ${title}
type: ${type}
tags: ${tags}
agent: ${agent}
updated: ${updated}
size: ${size}
---

${body}
`
}

export function parseVaultMarkdown(text, fallbackId) {
  const src = String(text || '')
  const m = src.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/)
  if (!m) {
    return {
      id: fallbackId,
      title: fallbackId,
      type: 'DOC',
      tags: [],
      size: `${Math.max(1, Math.round(src.length / 1024))}KB`,
      updated: 'just now',
      agent: 'ORCH',
      body: src,
      file: `${fallbackId}.md`
    }
  }
  const meta = {}
  for (const line of m[1].split(/\r?\n/)) {
    const i = line.indexOf(':')
    if (i < 0) continue
    const key = line.slice(0, i).trim()
    if (!key) continue
    meta[key] = line.slice(i + 1).trim()
  }
  const body = (m[2] || '').replace(/^\r?\n/, '')
  const tags = meta.tags
    ? meta.tags.split(',').map((t) => t.trim()).filter(Boolean)
    : []
  const id = meta.id || fallbackId
  return {
    id,
    title: meta.title || id,
    type: meta.type || 'DOC',
    tags,
    size: meta.size || `${Math.max(1, Math.round(body.length / 1024))}KB`,
    updated: meta.updated || 'just now',
    agent: meta.agent || 'ORCH',
    body,
    file: `${safeVaultId(id)}.md`
  }
}

export function vaultFilePath(id) {
  return join(vaultDir(), `${safeVaultId(id)}.md`)
}

export function writeVaultFile(doc) {
  if (!doc || !doc.id) return false
  ensureVaultDir()
  try {
    writeFileSync(vaultFilePath(doc.id), serializeVaultMarkdown(doc), 'utf-8')
    return true
  } catch {
    return false
  }
}

export function readVaultFile(id) {
  try {
    const text = readFileSync(vaultFilePath(id), 'utf-8')
    return parseVaultMarkdown(text, safeVaultId(id))
  } catch {
    return null
  }
}

export function listVaultFiles() {
  ensureVaultDir()
  let names = []
  try {
    names = readdirSync(vaultDir()).filter((n) => n.endsWith('.md'))
  } catch {
    return []
  }
  const docs = []
  for (const name of names) {
    try {
      const text = readFileSync(join(vaultDir(), name), 'utf-8')
      const fallback = name.replace(/\.md$/i, '')
      docs.push(parseVaultMarkdown(text, fallback))
    } catch {
      // skip unreadable files
    }
  }
  return docs
}

export function hydrateVault(state) {
  if (!state || typeof state !== 'object') return []
  if (!Array.isArray(state.vault)) state.vault = []
  const files = listVaultFiles()
  const byId = new Map()
  for (const d of state.vault) {
    if (d && d.id) byId.set(d.id, d)
  }
  const extra = []
  for (const f of files) {
    if (!f || !f.id) continue
    const existing = byId.get(f.id)
    if (existing) {
      existing.title = f.title
      existing.type = f.type
      existing.tags = f.tags
      existing.size = f.size
      existing.updated = f.updated
      existing.agent = f.agent
      existing.body = f.body
      existing.file = f.file
    } else {
      extra.push(f)
      byId.set(f.id, f)
    }
  }
  if (extra.length) state.vault = extra.concat(state.vault)
  if (state.vault.length > MAX_VAULT) state.vault.length = MAX_VAULT
  return state.vault
}

function makeDoc(ctx, { title, type, tags, body, id }) {
  const text = String(body || `${title} — logged by ${(ctx && ctx.agent) || 'ORCH'}`).slice(0, 4000)
  const docId = safeVaultId(id || `v${Date.now()}${Math.floor(Math.random() * 99)}`)
  return {
    id: docId,
    title,
    type,
    tags: Array.isArray(tags) ? tags : [],
    size: `${Math.max(1, Math.round(text.length / 1024))}KB`,
    updated: 'just now',
    agent: (ctx && ctx.agent) || 'ORCH',
    body: text,
    file: `${docId}.md`
  }
}

export function vaultWrite(ctx, fields) {
  const doc = makeDoc(ctx, fields || {})
  writeVaultFile(doc)
  if (!ctx || !ctx.s) return doc
  if (!Array.isArray(ctx.s.vault)) ctx.s.vault = []
  ctx.s.vault.unshift(doc)
  if (ctx.s.vault.length > MAX_VAULT) ctx.s.vault.pop()
  return doc
}
