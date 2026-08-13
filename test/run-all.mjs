/**
 * TEST RUNNER // Consolidates every STELLARIS-7 suite behind one command:
 *
 *   npm test
 *
 * Spawns a FRESH mock hermes-webui (deterministic, port 8788) so the approval
 * parity checks are not dependent on how long a long-lived mock has been up,
 * then runs each suite as its own child process and fails the run on any red.
 *
 * Suites (each prints PASS/FAIL lines, exits 0 on green):
 *   hermes       — client + skill + approval bridge against the mock
 *   hermes-ingest— merge/dedup/hash/scheduler-guard/preservation (self-isolating)
 *   phase4       — orchestrator probe alert condition engine + skills + missions
 *   github       — issue/PR → board mapping + hermes preservation
 *   planner      — heuristic plan decomposition (no external LLM)
 *   skills       — registry validation + skill executors
 */

import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = dirname(fileURLToPath(import.meta.url))
const REPO = join(ROOT, '..')
const MOCK_PORT = '8788'
const MOCK_URL = `http://127.0.0.1:${MOCK_PORT}`
const SUITES = ['hermes', 'hermes-ingest', 'phase4', 'github', 'planner', 'skills']

function runNode(script) {
  return new Promise((resolve) => {
    const p = spawn('node', [script], {
      cwd: REPO,
      stdio: ['ignore', 'inherit', 'inherit'],
      env: { ...process.env, MOCK_URL, USER_HERMES_URL: MOCK_URL }
    })
    p.on('exit', (code) => resolve(code === 0))
  })
}

async function waitForHealth(url, ms) {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${url}/health`, { signal: AbortSignal.timeout(1500) })
      if (res.ok) {
        const body = await res.json()
        if (body && body.ok) return true
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 150))
  }
  return false
}

const mock = spawn('node', ['server/mock-hermes.js'], {
  cwd: REPO,
  env: { ...process.env, PORT: MOCK_PORT, MOCK_URL },
  stdio: 'ignore'
})

let failed = false

try {
  if (!(await waitForHealth(MOCK_URL, 8000))) {
    console.error('FATAL: test mock did not come up on ' + MOCK_URL)
    process.exit(1)
  }
  for (const suite of SUITES) {
    const ok = await runNode(join('test', `${suite}.test.mjs`))
    console.log(`\n=== ${suite}.test.mjs ${ok ? 'PASS' : 'FAIL'} ===\n`)
    if (!ok) failed = true
  }
} finally {
  mock.kill('SIGTERM')
}

console.log(failed ? 'OVERALL: FAILURES' : 'OVERALL: ALL SUITES GREEN')
process.exit(failed ? 1 : 0)
