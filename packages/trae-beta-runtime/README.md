# @tingrudeng/trae-beta-runtime

Minimal remote-machine runtime package for ForgeFlow's unattended Trae path.

Current scope:
- initialize local runtime config
- validate remote-machine prerequisites
- launch Trae with remote debugging enabled
- start the local automation gateway
- start the unattended Trae worker
- perform direct package self-update for the runtime package

This package is self-contained for the remote Trae runtime path:
- it does **not** require a local ForgeFlow repository checkout
- it **does** require a local checkout of the target project repository that Trae will open and the worker will execute tasks against

This package is now structured for **public beta npm publishing**, but it is still beta-oriented and is not published automatically from this repository.
It depends on `@tingrudeng/automation-gateway-core` for shared final-report parsing and task-id validation logic.

Current unattended runtime guards:
- `new_chat` sampling is narrowed to the last visible chat root instead of scanning the whole page by default
- when baseline sampling still exposes a different completed task id, the runtime fails early with a stale-session error instead of continuing to read the old chat

## Commands

Repository-local execution:

```bash
pnpm --filter @tingrudeng/trae-beta-runtime exec forgeflow-trae-beta init
pnpm --filter @tingrudeng/trae-beta-runtime exec forgeflow-trae-beta doctor
pnpm --filter @tingrudeng/trae-beta-runtime exec forgeflow-trae-beta start launch
pnpm --filter @tingrudeng/trae-beta-runtime exec forgeflow-trae-beta start gateway
pnpm --filter @tingrudeng/trae-beta-runtime exec forgeflow-trae-beta start worker
pnpm --filter @tingrudeng/trae-beta-runtime exec forgeflow-trae-beta update
```

`start gateway` and `start worker` reuse an existing managed local process by default.
Pass `--force` if you want to start a fresh process even when one is already running.

To run in the background with log output:

```bash
forgeflow-trae-beta start launch --detach --log-file /tmp/launch.log
forgeflow-trae-beta start gateway --detach --log-file /tmp/gateway.log
forgeflow-trae-beta start worker --detach --log-file /tmp/worker.log
```

When `--detach` is used, the process runs in the background and the CLI exits immediately.
The `--log-file` option redirects stdout and stderr to the specified file (append mode).

Lifecycle commands:

```bash
forgeflow-trae-beta status
forgeflow-trae-beta stop gateway
forgeflow-trae-beta stop worker
```

Version commands:

```bash
forgeflow-trae-beta version
forgeflow-trae-beta --version
```

`version` and `--version` both print the installed package version.

Help commands:

```bash
forgeflow-trae-beta --help
forgeflow-trae-beta -h
forgeflow-trae-beta help
forgeflow-trae-beta start --help
forgeflow-trae-beta stop --help
```

All help flags (`--help`, `-h`, `help`) output the same main help text, which includes:
- Usage information
- Available commands list
- Global options (like `--json`, `--config-path`)
- Examples

Use `start --help` or `stop --help` to see detailed options for start/stop subcommands.

`status` reports the local runtime config and whether the gateway/worker processes are currently running.
`stop gateway` and `stop worker` stop the local processes started by ForgeFlow's runtime entrypoints:
`packages/trae-beta-runtime/dist/runtime/run-trae-automation-gateway.js` and
`packages/trae-beta-runtime/dist/runtime/worker.js`.
The stop commands target those local script-backed processes directly, not fuzzy package names.

Recommended fresh-machine setup:

```bash
npm install -g @tingrudeng/trae-beta-runtime
forgeflow-trae-beta init \
  --project-path /abs/path/to/your-business-repo \
  --dispatcher-url http://<control-plane-host>:8787 \
  --worker-id trae-remote-01
forgeflow-trae-beta doctor
forgeflow-trae-beta start all
```

If Trae is installed at a non-default path, add `--trae-bin "/Applications/Trae.app"` to `forgeflow-trae-beta init`.

If the machine defaults to a mirrored registry such as `https://registry.npmmirror.com`, newly published shared dependencies may lag behind the npmjs registry and cause dependency 404 errors during install or upgrade. In that case, install from the official registry explicitly:

```bash
npm install -g @tingrudeng/trae-beta-runtime@0.1.0-beta.42 --registry=https://registry.npmjs.org/
```

Common lifecycle commands:

```bash
forgeflow-trae-beta update
forgeflow-trae-beta version
forgeflow-trae-beta --version
forgeflow-trae-beta status
forgeflow-trae-beta stop gateway
forgeflow-trae-beta stop worker
```

If `forgeflow-trae-beta update` fails because a mirrored registry has not synced the latest shared dependency yet, rerun the upgrade with:

```bash
npm install -g @tingrudeng/trae-beta-runtime@0.1.0-beta.42 --registry=https://registry.npmjs.org/
```

To force a fresh local instance instead of reusing an existing one:

```bash
forgeflow-trae-beta start gateway --force
forgeflow-trae-beta start worker --force
```

Current release gate:

- package build/test/typecheck
- package pack succeeds with all published dependencies resolvable
- full repository test/typecheck
- one real remote-machine smoke run using `init`, `doctor`, and `start all`

## Requirements

- Node 22+
- git
- a local checkout of the target project repository on the remote machine
- Trae desktop installed locally
- Trae remote debugging enabled via the launch command

## Git SSH Override

If the default SSH port (22) is blocked, you can override the git SSH command using environment variables:

**Environment variables (in priority order):**

1. `FORGEFLOW_GIT_SSH_COMMAND` — preferred
2. `TRAE_GIT_SSH_COMMAND` — backward-compatible fallback

**Example: GitHub over ssh.github.com:443**

```bash
export FORGEFLOW_GIT_SSH_COMMAND="ssh -o Hostname=ssh.github.com -p 443"
```

Set this before running `forgeflow-trae-beta start worker` or any other runtime commands that perform git operations.

**Important:**

- This only changes how SSH connects; if the remote baseline cannot be fetched (network unreachable, auth failed), the worker will still hard-fail.
- The override applies to git operations during task execution (e.g., fetching baseline, creating worktrees).

## Dispatcher Authentication

If the dispatcher requires authentication (`DISPATCHER_AUTH_MODE=token`), set the same token:

```bash
export DISPATCHER_API_TOKEN="your-secret-token"
```

This environment variable is automatically included in all dispatcher HTTP requests as `Authorization: Bearer <token>`.

## Config

The runtime reads and writes config at:

```text
~/.forgeflow-trae-beta/config.json
```

Default fields include:
- `projectPath`
- `dispatcherUrl`
- `automationUrl`
- `workerId`
- `traeBin`
- `remoteDebuggingPort`

`projectPath` should point to the local checkout of the project Trae will work on.
It is no longer a ForgeFlow runtime root.

## Notes

- This package is for the remote Trae runtime only; it is not a replacement for the full ForgeFlow control plane.
- Dispatcher still runs separately on the control-plane machine.
- The runtime expects Trae task prompts to preserve the final-report contract, including `任务完成` / `结果` / `任务ID`; the preferred path is to let `worker-review-orchestrator-cli` auto-render Trae prompts instead of hand-writing them.
- The repository is licensed under Apache-2.0.
- `forgeflow-trae-beta update` performs a direct self-update of the installed runtime package and reports the command it ran.
- Current beta operating guidance:
  - [docs/runbooks/trae-remote-beta.md](https://github.com/TingRuDeng/forgeflow-platform/blob/main/docs/runbooks/trae-remote-beta.md)
- Package release steps:
  - [packages/trae-beta-runtime/PUBLISHING.md](https://github.com/TingRuDeng/forgeflow-platform/blob/main/packages/trae-beta-runtime/PUBLISHING.md)
  - [packages/automation-gateway-core/PUBLISHING.md](https://github.com/TingRuDeng/forgeflow-platform/blob/main/packages/automation-gateway-core/PUBLISHING.md)
