# @tingrudeng/codex-beta-runtime

Minimal remote-machine runtime package for ForgeFlow's unattended Codex worker path.

Current scope:

- initialize local runtime config
- validate remote-machine prerequisites
- start unmanaged/managed codex worker daemon process
- check runtime status and stop worker process
- perform direct package self-update for the runtime package

This package is self-contained for the remote Codex runtime path:

- it does **not** require a local ForgeFlow repository checkout
- it **does** require a local checkout of the target project repository that worker will execute tasks against

## Commands

Repository-local execution:

```bash
pnpm --filter @tingrudeng/codex-beta-runtime exec forgeflow-codex-beta init
pnpm --filter @tingrudeng/codex-beta-runtime exec forgeflow-codex-beta doctor
pnpm --filter @tingrudeng/codex-beta-runtime exec forgeflow-codex-beta start worker
pnpm --filter @tingrudeng/codex-beta-runtime exec forgeflow-codex-beta status
pnpm --filter @tingrudeng/codex-beta-runtime exec forgeflow-codex-beta stop worker
pnpm --filter @tingrudeng/codex-beta-runtime exec forgeflow-codex-beta update
pnpm --filter @tingrudeng/codex-beta-runtime exec forgeflow-codex-beta version
```

Run in background with log output:

```bash
forgeflow-codex-beta start worker --detach --log-file /tmp/codex-worker.log
```

Intended post-publish shape:

```bash
npm install -g @tingrudeng/codex-beta-runtime
forgeflow-codex-beta init
forgeflow-codex-beta doctor
forgeflow-codex-beta start worker
forgeflow-codex-beta status
forgeflow-codex-beta stop worker
forgeflow-codex-beta update
forgeflow-codex-beta version
forgeflow-codex-beta --version
```

## Requirements

- Node 22+
- git
- codex CLI
- local checkout of target project repository
- reachable dispatcher server

## Config

The runtime reads and writes config at:

```text
~/.forgeflow-codex-beta/config.json
```

Default fields include:

- `repoDir`
- `dispatcherUrl`
- `workerId`
- `pollIntervalMs`
- `codexBin`
- `pool`

## Codex integration options

`run-worker-assignment` uses codex CLI with `exec` mode and supports these env overrides:

- `FORGEFLOW_CODEX_BIN` (default: `codex`)
- `FORGEFLOW_CODEX_MODEL`
- `FORGEFLOW_CODEX_SANDBOX` (default: `workspace-write`)
- `FORGEFLOW_CODEX_ARGS_JSON` (JSON string array, highest priority)
- `FORGEFLOW_CODEX_ARGS` (shell-like string fallback)

This matches weclaw's codex interaction pattern by allowing extra codex args without modifying code.

## Notes

- This package is for Codex worker runtime only; it is not a replacement for the full ForgeFlow control plane.
- Dispatcher still runs separately on the control-plane machine.
- The package performs worker task execution using ForgeFlow assignment package conventions.
