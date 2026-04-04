# @forgeflow/mcp-trae-worker

Thin MCP wrapper for Trae worker registration and task lifecycle.

## Status

**DEPRECATED / FALLBACK**. This is a thin wrapper package.

The **recommended unattended path** is Trae automation gateway + Trae automation worker. This MCP package is retained for interactive Trae Agent sessions or compatibility fallback only.

## Tools

- `register` — Register this Trae worker with the dispatcher
- `fetch_task` — Fetch an assigned task for the Trae worker
- `start_task` — Mark a task as started (auto-starts heartbeat)
- `report_progress` — Report progress message for a running task
- `submit_result` — Submit task result (review_ready or failed)
- `heartbeat` — Send heartbeat to keep worker alive

## Entrypoint

```
./src/server.ts
```

Exports `createTraeWorkerServer(deps: TraeWorkerDeps)`.

## Behavior Limitations

- No direct dispatcher communication — delegates to dispatcher Trae integration via deps
- Single task serial runtime (no multi-task concurrency)
- Deprecated in favor of Trae automation gateway + automation worker path
