#!/usr/bin/env bash
# STELLARIS-7 — validate a live Hermes WebUI against the bridge contract.
#   ./scripts/probe.sh [--url http://host:8787] [--password ...]
# Exits non-zero if any critical surface FAILs.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

exec node server/hermes-contract.js "$@"
