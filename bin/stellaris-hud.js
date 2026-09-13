#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { loadStellarisConfig } from '../server/cli-config.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

export const COMMANDS = ['serve', 'demo', 'probe', 'help']

export function parseArgv(argv) {
  const args = argv.slice(2)
  const cmd = args[0] && !String(args[0]).startsWith('-') ? args[0] : 'help'
  return { cmd, rest: cmd === 'help' ? args : args.slice(1) }
}

function help() {
  console.log(`stellaris-hud — STELLARIS-7 operator CLI

Usage:
  stellaris-hud serve     Start orbit (serves dist/ + API + WS)
  stellaris-hud demo      Mock Hermes + orbit
  stellaris-hud probe     Hermes WebUI contract check
  stellaris-hud help

Config: .stellaris.json in cwd (mirrors .env.example). Env wins.
`)
}

function load() {
  const fromCwd = loadStellarisConfig(process.cwd())
  if (!fromCwd.applied) loadStellarisConfig(ROOT)
  if (fromCwd.error) console.warn('[stellaris-hud] .stellaris.json:', fromCwd.error)
}

async function serve() {
  load()
  const dist = join(ROOT, 'dist')
  if (!existsSync(join(dist, 'index.html'))) {
    console.warn('[stellaris-hud] dist/ missing — run npm run build for the HUD bundle')
  }
  await import(pathToFileURL(join(ROOT, 'server/index.js')).href)
}

function spawnNode(script, args, extraEnv) {
  const child = spawn(process.execPath, [script, ...args], {
    cwd: ROOT,
    env: { ...process.env, ...extraEnv },
    stdio: 'inherit'
  })
  return child
}

async function demo() {
  load()
  const mockPort = process.env.MOCK_PORT || '8787'
  if (!process.env.USER_HERMES_URL) {
    process.env.USER_HERMES_URL = `http://127.0.0.1:${mockPort}`
    console.log('USER_HERMES_URL unset — pointing orbit at the mock for the demo.')
  }
  const mock = spawnNode(join(ROOT, 'server/mock-hermes.js'), [], { PORT: mockPort })
  const stop = () => {
    try { mock.kill('SIGTERM') } catch {}
  }
  process.on('SIGINT', () => { stop(); process.exit(0) })
  process.on('SIGTERM', () => { stop(); process.exit(0) })
  console.log(`mock hermes-webui  : http://127.0.0.1:${mockPort}`)
  await serve()
}

async function probe(rest) {
  load()
  const child = spawnNode(join(ROOT, 'server/hermes-contract.js'), rest, {})
  child.on('exit', (code) => process.exit(code || 0))
}

export async function main(argv = process.argv) {
  const { cmd, rest } = parseArgv(argv)
  if (cmd === 'serve') return serve()
  if (cmd === 'demo') return demo()
  if (cmd === 'probe') return probe(rest)
  help()
  if (cmd !== 'help') process.exitCode = 1
}

const entry = process.argv[1] ? resolve(process.argv[1]) : ''
if (entry && import.meta.url === pathToFileURL(entry).href) {
  main().catch((err) => {
    console.error('[stellaris-hud]', err.message || err)
    process.exit(1)
  })
}
