# @forgeflow/mcp-scheduler

Thin MCP wrapper exposing scheduler task management tools.

## Status

This is a **thin wrapper** package. All scheduling logic lives in the dispatcher layer. This package only exposes the tool definitions and delegates to `dispatcher-scheduler` implementation injected via `deps`.

## Tools

- `create_tasks` — Create structured tasks in the scheduler
- `list_ready_tasks` — List ready tasks that can be assigned
- `assign_task` — Assign a ready task to an available worker
- `heartbeat` — Record a worker heartbeat
- `start_task` — Mark an assigned task as in progress
- `complete_task` — Mark a task as completed
- `fail_task` — Mark a task as failed
- `get_assigned_task` — Get the task currently assigned to a worker

## Entrypoint

```
./src/server.ts
```

Exports `createSchedulerServer(deps: SchedulerServerDeps)`.

## Behavior Limitations

- No scheduling policy enforcement in this layer
- No direct database access — all state mutations go through injected deps
- Intentionally limited to tool definitions; actual scheduling logic lives in dispatcher
