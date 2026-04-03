#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="${FORGEFLOW_ROOT_DIR:-/Volumes/Data/WorkSpace/forgeflow-staging/ForgeFlow}"
HOST="${FORGEFLOW_AUTOMATION_HOST:-127.0.0.1}"
PORT="${FORGEFLOW_AUTOMATION_PORT:-8790}"

cd "$ROOT_DIR"

exec node scripts/run-trae-automation-gateway.js \
  --host "$HOST" \
  --port "$PORT"
