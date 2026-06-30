# @tingrudeng/gemini-beta-runtime

Minimal remote-machine runtime package for ForgeFlow's unattended Gemini worker path.

Current scope:

- initialize local runtime config
- validate remote-machine prerequisites
- start unmanaged/managed gemini worker daemon process
- check runtime status and stop worker process
- perform direct package self-update for the runtime package

This package is self-contained for the remote Gemini runtime path:

- it does **not** require a local ForgeFlow repository checkout
- it **does** require a local checkout of the target project repository that worker will execute tasks against

## Commands

Repository-local execution:

```bash
pnpm --filter @tingrudeng/gemini-beta-runtime exec forgeflow-gemini-beta init
pnpm --filter @tingrudeng/gemini-beta-runtime exec forgeflow-gemini-beta doctor
pnpm --filter @tingrudeng/gemini-beta-runtime exec forgeflow-gemini-beta start worker
pnpm --filter @tingrudeng/gemini-beta-runtime exec forgeflow-gemini-beta status
pnpm --filter @tingrudeng/gemini-beta-runtime exec forgeflow-gemini-beta stop worker
pnpm --filter @tingrudeng/gemini-beta-runtime exec forgeflow-gemini-beta update
pnpm --filter @tingrudeng/gemini-beta-runtime exec forgeflow-gemini-beta version
```

Run in background with log output:

```bash
forgeflow-gemini-beta start worker --detach --log-file /tmp/gemini-worker.log
```

Intended post-publish shape:

```bash
npm install -g @tingrudeng/gemini-beta-runtime
forgeflow-gemini-beta init
forgeflow-gemini-beta doctor
forgeflow-gemini-beta start worker
forgeflow-gemini-beta status
forgeflow-gemini-beta stop worker
forgeflow-gemini-beta update
forgeflow-gemini-beta version
forgeflow-gemini-beta --version
```

## Requirements

- Node 22+
- git
- gemini CLI
- local checkout of target project repository
- reachable dispatcher server

## Config

The runtime reads and writes config at:

```text
~/.forgeflow-gemini-beta/config.json
```

Default fields include:

- `repoDir`
- `dispatcherUrl`
- `workerId`
- `pollIntervalMs`
- `geminiBin`
- `pool`

## Gemini integration options

`run-worker-assignment` uses gemini CLI in run mode (`gemini -m gemini-2.5-pro -p <prompt>`) and supports these env overrides:

- `FORGEFLOW_GEMINI_BIN` (default: `gemini`)
- `FORGEFLOW_GEMINI_MODEL` (default: `gemini-2.5-pro`)
- `FORGEFLOW_GEMINI_ARGS_JSON` (JSON string array, highest priority)
- `FORGEFLOW_GEMINI_ARGS` (shell-like string fallback)

This allows passing extra gemini args without modifying code.

## Notes

- This package is for Gemini worker runtime only; it is not a replacement for the full ForgeFlow control plane.
- Gemini only supports run mode; there is no review mode.
- Dispatcher still runs separately on the control-plane machine.
- The package performs worker task execution using ForgeFlow assignment package conventions.
