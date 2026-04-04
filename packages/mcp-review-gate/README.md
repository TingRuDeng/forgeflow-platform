# @forgeflow/mcp-review-gate

Thin MCP wrapper exposing review gate tools.

## Status

This is a **thin wrapper** package. Review logic (merge readiness checks, PR rendering) lives in the dispatcher layer. This package only exposes the tool definitions and delegates to `dispatcher-review-gate` implementation injected via `deps`.

## Tools

- `submit_findings` — Store structured review findings
- `check_merge_readiness` — Check whether a pull request can merge
- `render_markdown_pr` — Render PR summary markdown

## Entrypoint

```
./src/server.ts
```

Exports `createReviewGateServer(deps: ReviewGateServerDeps)`.

## Behavior Limitations

- No direct review state storage — all state goes through injected deps
- Intentionally limited to tool definitions; actual review logic lives in dispatcher
