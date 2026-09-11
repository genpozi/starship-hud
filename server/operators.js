export function defaultOperatorName(env = process.env) {
  const n = String(env.USER_OPERATOR_NAME || '').trim()
  return n || 'operator'
}

export function normalizeOperatorId(raw, env = process.env) {
  const s = String(raw || defaultOperatorName(env))
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
  return s || 'operator'
}
