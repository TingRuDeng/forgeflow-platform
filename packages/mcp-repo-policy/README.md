# @forgeflow/mcp-repo-policy

Thin MCP wrapper exposing repo policy tools.

## Status

This is a **thin wrapper** package. Policy validation and repo command resolution live in the dispatcher layer. This package only exposes the tool definitions and delegates to `dispatcher-repo-policy` implementation injected via `deps`.

## Tools

- `validate_paths` — Validate changed paths against repo policy
- `get_repo_commands` — Get repo-specific lint, test, and build commands

## Entrypoint

```
./src/server.ts
```

Exports `createRepoPolicyServer(deps: RepoPolicyServerDeps)`.

## Behavior Limitations

- No direct policy storage or evaluation — all logic goes through injected deps
- Intentionally limited to tool definitions; actual policy logic lives in dispatcher
