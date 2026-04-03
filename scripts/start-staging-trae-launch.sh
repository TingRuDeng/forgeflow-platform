#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
DEFAULT_ROOT_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd)"

ROOT_DIR="${FORGEFLOW_ROOT_DIR:-$DEFAULT_ROOT_DIR}"
REPO_DIR="${FORGEFLOW_REPO_DIR:-$ROOT_DIR}"
TRAE_BIN="${FORGEFLOW_TRAE_BIN:-/Applications/Trae CN.app}"
REMOTE_DEBUGGING_PORT="${FORGEFLOW_REMOTE_DEBUGGING_PORT:-9222}"

if [[ ! -d "$ROOT_DIR" ]]; then
  echo "FORGEFLOW_ROOT_DIR does not exist: $ROOT_DIR" >&2
  exit 1
fi

if [[ ! -d "$REPO_DIR" ]]; then
  echo "FORGEFLOW_REPO_DIR does not exist: $REPO_DIR" >&2
  exit 1
fi

cd "$ROOT_DIR"

exec node scripts/run-trae-automation-launch.js \
  --trae-bin "$TRAE_BIN" \
  --project-path "$REPO_DIR" \
  --remote-debugging-port "$REMOTE_DEBUGGING_PORT"
