#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="${FORGEFLOW_ROOT_DIR:-/Volumes/Data/WorkSpace/forgeflow-staging/ForgeFlow}"
REPO_DIR="${FORGEFLOW_REPO_DIR:-/Volumes/Data/code/MyCode/ForgeFlow}"
TRAE_BIN="${FORGEFLOW_TRAE_BIN:-/Applications/Trae CN.app}"
REMOTE_DEBUGGING_PORT="${FORGEFLOW_REMOTE_DEBUGGING_PORT:-9222}"

cd "$ROOT_DIR"

exec node scripts/run-trae-automation-launch.js \
  --trae-bin "$TRAE_BIN" \
  --project-path "$REPO_DIR" \
  --remote-debugging-port "$REMOTE_DEBUGGING_PORT"
