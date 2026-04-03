#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
DEFAULT_ROOT_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd)"

ROOT_DIR="${FORGEFLOW_ROOT_DIR:-$DEFAULT_ROOT_DIR}"
REPO_DIR="${FORGEFLOW_REPO_DIR:-$ROOT_DIR}"
DISPATCHER_URL="${FORGEFLOW_DISPATCHER_URL:-http://127.0.0.1:8787}"
AUTOMATION_URL="${FORGEFLOW_AUTOMATION_URL:-http://127.0.0.1:8790}"
WORKER_ID="${FORGEFLOW_WORKER_ID:-trae-auto-gateway}"

if [[ ! -d "$ROOT_DIR" ]]; then
  echo "FORGEFLOW_ROOT_DIR does not exist: $ROOT_DIR" >&2
  exit 1
fi

if [[ ! -d "$REPO_DIR" ]]; then
  echo "FORGEFLOW_REPO_DIR does not exist: $REPO_DIR" >&2
  exit 1
fi

cd "$ROOT_DIR"

exec node scripts/run-trae-automation-worker.js \
  --repo-dir "$REPO_DIR" \
  --dispatcher-url "$DISPATCHER_URL" \
  --automation-url "$AUTOMATION_URL" \
  --worker-id "$WORKER_ID"
