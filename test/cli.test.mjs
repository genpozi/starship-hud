/**
 * CLI SUITE // P12 operator packaging.
 *   parseArgv, applyStellarisConfig (env wins), loadStellarisConfig missing file
 */
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { parseArgv, COMMANDS } from '../bin/stellaris-hud.js'
import { applyStellarisConfig, loadStellarisConfig } from '../server/cli-config.js'

const results = []
const pass = (name, cond) => results.push(`${cond ? 'PASS' : 'FAIL'} ${name}`)

pass('commands include serve/demo/probe', COMMANDS.includes('serve') && COMMANDS.includes('demo') && COMMANDS.includes('probe'))
pass('parseArgv serve', parseArgv(['node', 'stellaris-hud', 'serve']).cmd === 'serve')
pass('parseArgv probe rest', parseArgv(['node', 'stellaris-hud', 'probe', '--url', 'http://x']).rest[1] === 'http://x')
pass('parseArgv default help', parseArgv(['node', 'stellaris-hud']).cmd === 'help')
pass('parseArgv unknown is cmd', parseArgv(['node', 'stellaris-hud', 'nope']).cmd === 'nope')

{
  const env = { PORT: '3001' }
  applyStellarisConfig({ PORT: 9999, USER_OPERATOR_NAME: 'alice' }, env)
  pass('env wins over json', env.PORT === '3001')
  pass('json fills empty', env.USER_OPERATOR_NAME === 'alice')
}

{
  const env = { USER_LLM_API_KEY: '' }
  applyStellarisConfig({ USER_LLM_API_KEY: 'from-json' }, env)
  pass('empty env is filled', env.USER_LLM_API_KEY === 'from-json')
}

{
  const dir = mkdtempSync(join(tmpdir(), 'stellaris-cli-'))
  const missing = loadStellarisConfig(dir, {})
  pass('missing json is no-op', missing.applied === false && missing.file === null)
  writeFileSync(join(dir, '.stellaris.json'), '{not json')
  const bad = loadStellarisConfig(dir, {})
  pass('invalid json reported', bad.applied === false && bad.error === 'invalid json')
  writeFileSync(join(dir, '.stellaris.json'), JSON.stringify({ USER_OPERATOR_NAME: 'bob', PORT: 4123 }))
  const env = {}
  const ok = loadStellarisConfig(dir, env)
  pass('valid json applied', ok.applied === true && env.USER_OPERATOR_NAME === 'bob' && env.PORT === '4123')
  rmSync(dir, { recursive: true, force: true })
}

console.log(results.join('\n'))
const fails = results.filter((r) => r.startsWith('FAIL'))
console.log(fails.length ? `\n${fails.length} FAILURES` : '\nALL PASS')
process.exit(fails.length ? 1 : 0)
