#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="${FORGEFLOW_ROOT_DIR:-/Volumes/Data/WorkSpace/forgeflow-staging/ForgeFlow}"
REPO_DIR="${FORGEFLOW_REPO_DIR:-/Volumes/Data/code/MyCode/ForgeFlow}"
DISPATCHER_URL="${FORGEFLOW_DISPATCHER_URL:-http://127.0.0.1:8787}"
AUTOMATION_URL="${FORGEFLOW_AUTOMATION_URL:-http://127.0.0.1:8790}"
WORKER_ID="${FORGEFLOW_WORKER_ID:-trae-auto-gateway}"

cd "$ROOT_DIR"

exec node scripts/run-trae-automation-worker.js \
  --repo-dir "$REPO_DIR" \
  --dispatcher-url "$DISPATCHER_URL" \
  --automation-url "$AUTOMATION_URL" \
  --worker-id "$WORKER_ID"
