# @forgeflow/mcp-github

Thin MCP wrapper exposing GitHub tools.

## Status

This is a **thin wrapper** package. GitHub API interactions (branch creation, PR opening, status checks) live in the dispatcher layer. This package only exposes the tool definitions and delegates to `dispatcher-github` implementation injected via `deps`.

## Tools

- `create_branch` — Create a branch in the target repository
- `open_pull_request` — Open a pull request in the target repository
- `get_pull_request_status` — Read pull request merge and check status

## Entrypoint

```
./src/server.ts
```

Exports `createGitHubServer(deps: GitHubServerDeps)`.

## Behavior Limitations

- No direct GitHub API access — all API calls go through injected deps
- Intentionally limited to tool definitions; actual GitHub integration lives in dispatcher
