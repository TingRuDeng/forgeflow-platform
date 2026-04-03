#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
DEFAULT_ROOT_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd)"

ROOT_DIR="${FORGEFLOW_ROOT_DIR:-$DEFAULT_ROOT_DIR}"
STATE_DIR="${FORGEFLOW_STATE_DIR:-$ROOT_DIR/.forgeflow-dispatcher}"
HOST="${FORGEFLOW_DISPATCHER_HOST:-0.0.0.0}"
PORT="${FORGEFLOW_DISPATCHER_PORT:-8787}"

if [[ ! -d "$ROOT_DIR" ]]; then
  echo "FORGEFLOW_ROOT_DIR does not exist: $ROOT_DIR" >&2
  exit 1
fi

mkdir -p "$STATE_DIR"

cat <<MSG
Starting ForgeFlow control plane (Trae-first).

- Root dir: $ROOT_DIR
- Dispatcher state dir: $STATE_DIR
- Dispatcher URL: http://$HOST:$PORT

Recommended next step on the Trae runtime machine:
  forgeflow-trae-beta start all
MSG

cd "$ROOT_DIR"

exec node scripts/run-dispatcher-server.js \
  --host "$HOST" \
  --port "$PORT" \
  --state-dir "$STATE_DIR"
