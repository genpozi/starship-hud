#!/usr/bin/env bash
# STELLARIS-7 demo — run the full stack locally with the bundled hermes mock.
#   ./scripts/demo.sh           # mock (:8787) + orbit (:3001) + vite dev (:5173)
#   ./scripts/demo.sh --prod    # mock + orbit only; serve the built bundle from :3001
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if ! command -v node >/dev/null 2>&1; then
  echo "error: node is required" >&2
  exit 1
fi

# Build once if --prod and dist is stale
if [[ "${1:-}" == "--prod" ]]; then
  npm run build
fi

# Start the mock on a fixed port so USER_HERMES_URL can point at it.
MOCK_PORT="${MOCK_PORT:-8787}"
PORT="$MOCK_PORT" node server/mock-hermes.js > /tmp/stellaris-mock.log 2>&1 &
MOCK_PID=$!
echo "mock hermes-webui  : http://127.0.0.1:$MOCK_PORT (pid $MOCK_PID)"

# Make orbit talk to the mock unless the operator configured a real instance.
if [[ -z "${USER_HERMES_URL:-}" ]]; then
  export USER_HERMES_URL="http://127.0.0.1:$MOCK_PORT"
  echo "USER_HERMES_URL unset — pointing orbit at the mock for the demo."
fi

node server/index.js > /tmp/stellaris-orbit.log 2>&1 &
ORBIT_PID=$!
echo "orbit server       : http://127.0.0.1:3001 (pid $ORBIT_PID)"

if [[ "${1:-}" == "--prod" ]]; then
  echo "logs               : /tmp/stellaris-mock.log /tmp/stellaris-orbit.log"
  echo "press Ctrl-C to stop"
  trap 'kill $ORBIT_PID $MOCK_PID 2>/dev/null || true' INT TERM
  wait
  exit 0
fi

npm run dev > /tmp/stellaris-dev.log 2>&1 &
DEV_PID=$!
echo "vite dev server    : http://localhost:5173 (pid $DEV_PID)"
echo "logs               : /tmp/stellaris-mock.log /tmp/stellaris-orbit.log /tmp/stellaris-dev.log"
echo "press Ctrl-C to stop"
trap 'kill $DEV_PID $ORBIT_PID $MOCK_PID 2>/dev/null || true' INT TERM
wait
