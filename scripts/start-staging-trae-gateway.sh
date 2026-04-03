#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
DEFAULT_ROOT_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd)"

ROOT_DIR="${FORGEFLOW_ROOT_DIR:-$DEFAULT_ROOT_DIR}"
HOST="${FORGEFLOW_AUTOMATION_HOST:-127.0.0.1}"
PORT="${FORGEFLOW_AUTOMATION_PORT:-8790}"

if [[ ! -d "$ROOT_DIR" ]]; then
  echo "FORGEFLOW_ROOT_DIR does not exist: $ROOT_DIR" >&2
  exit 1
fi

cd "$ROOT_DIR"

exec node scripts/run-trae-automation-gateway.js \
  --host "$HOST" \
  --port "$PORT"
