#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="${FORGEFLOW_ROOT_DIR:-/Volumes/Data/WorkSpace/forgeflow-staging/ForgeFlow}"
STATE_DIR="${FORGEFLOW_STATE_DIR:-$ROOT_DIR/.forgeflow-dispatcher}"
HOST="${FORGEFLOW_DISPATCHER_HOST:-0.0.0.0}"
PORT="${FORGEFLOW_DISPATCHER_PORT:-8787}"

mkdir -p "$STATE_DIR"
cd "$ROOT_DIR"

exec node scripts/run-dispatcher-server.js \
  --host "$HOST" \
  --port "$PORT" \
  --state-dir "$STATE_DIR"
