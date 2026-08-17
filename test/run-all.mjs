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
 *   chat         — mention routing + reply synthesis + knowledge grounding (self-isolating)
 *   regression   — review-fix guards: escapeHtml, assigned-job completion,
 *                  in-flight gating, mention false positives, ORCH alias
 *   views        — headless render of every HUD view body (DOM shim, no browser)
 *   integration  — REST + WS against a freshly booted orbit server (self-isolating)
 */

import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'

const ROOT = dirname(fileURLToPath(import.meta.url))
const REPO = join(ROOT, '..')
const MOCK_PORT = '8788'
const MOCK_URL = `http://127.0.0.1:${MOCK_PORT}`
const SUITES = ['hermes', 'hermes-ingest', 'phase4', 'github', 'planner', 'skills', 'chat', 'regression', 'views', 'integration']

// A fresh per-run data dir, so no suite ever touches the live demo's
// data/state.json (which a running orbit server flushes to continuously).
// Suites that also boot their own isolated server keep their own dir.
const DATA_DIR = mkdtempSync(join(tmpdir(), 'stellaris-test-'))

function runNode(script) {
  return new Promise((resolve) => {
    const p = spawn('node', [script], {
      cwd: REPO,
      stdio: ['ignore', 'inherit', 'inherit'],
      env: { ...process.env, MOCK_URL, USER_HERMES_URL: MOCK_URL, STELLARIS_DATA_DIR: DATA_DIR }
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
  rmSync(DATA_DIR, { recursive: true, force: true })
}

console.log(failed ? 'OVERALL: FAILURES' : 'OVERALL: ALL SUITES GREEN')
process.exit(failed ? 1 : 0)
