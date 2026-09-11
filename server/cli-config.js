import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

export function applyStellarisConfig(obj, env = process.env) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return env
  for (const [key, val] of Object.entries(obj)) {
    if (!key || val == null || val === '') continue
    const cur = env[key]
    if (cur != null && String(cur) !== '') continue
    env[key] = String(val)
  }
  return env
}

export function loadStellarisConfig(cwd = process.cwd(), env = process.env) {
  const file = resolve(cwd, '.stellaris.json')
  if (!existsSync(file)) return { file: null, applied: false }
  let raw
  try {
    raw = JSON.parse(readFileSync(file, 'utf-8'))
  } catch {
    return { file, applied: false, error: 'invalid json' }
  }
  applyStellarisConfig(raw, env)
  return { file, applied: true }
}
