# @tingrudeng/worker-review-orchestrator-cli

ForgeFlow control-layer CLI for dispatching tasks to workers, watching their status, and submitting review decisions.

## Install

Preferred global install after publish:

```bash
npm install -g @tingrudeng/worker-review-orchestrator-cli
forgeflow-review-orchestrator --help
```

Repository-local fallback:

```bash
pnpm --filter @tingrudeng/worker-review-orchestrator-cli build
node packages/worker-review-orchestrator-cli/dist/cli.js --help
```

This package is meant to pair with the `worker-review-orchestrator` skill, but it is installed separately from the skill itself.

## Authentication

If the dispatcher requires authentication (`DISPATCHER_AUTH_MODE=token`), set the same token:

```bash
export DISPATCHER_API_TOKEN="your-secret-token"
forgeflow-review-orchestrator dispatch ...
```

The CLI automatically includes `Authorization: Bearer <token>` in all dispatcher HTTP requests.

## Commands

- `dispatch`
  - POST a dispatch payload to `/api/dispatches`
  - Supports `--target-worker-id` to pin all tasks in the payload to one worker
  - Supports `--require-existing-worker` to verify the target worker or worker pool is already online in `/api/dashboard/snapshot` before posting
- `dispatch-task`
  - Build and POST a single-task dispatch payload from CLI flags
  - Preferred when the control layer wants to send one focused task without hand-writing `dispatch.json`
  - When `--pool trae` is used without a custom prompt, the CLI auto-renders a Trae worker prompt from the structured task fields and appends the required final-report contract
  - Supports `--worker-prompt` and `--context-markdown` for inline string inputs
  - Supports `--worker-prompt-file` and `--context-markdown-file` for file-backed prompt/context inputs
  - Custom Trae prompts must still include `任务完成` / `结果` / `任务ID`; otherwise dispatch fails before posting
  - Supports `--require-existing-worker` to reject dispatch when no matching online worker exists
- `continue-task`
  - Continue an existing task via the redrive flow instead of creating a brand new dispatch
  - Use this for blocked/rework or failed tasks that should resume from the original task state
- `watch`
  - Poll `/api/dashboard/snapshot` until a task reaches `review`, `failed`, `merged`, or `blocked`
- `decide`
  - Submit `merge` or `block` decisions through the dispatcher review flow
  - Supports dispatcher HTTP or local `state-dir` fallback
  - Optional parameters: `--actor`, `--notes`, `--at`
- `inspect`
  - Retrieve review material for a task from the dispatcher snapshot
  - Fetches task, assignment, reviews, pull request, and events to help a control-layer reviewer summarize before merge/block decision
  - Use `--summary` flag to get concise output with task status, branch, worker, result evidence, recent events, and review/PR state

## Current Boundary

- This package only orchestrates existing ForgeFlow dispatcher flows.
- It does not implement worker execution.
- It does not rewrite task state arbitrarily.

## Minimal Use

```bash
forgeflow-review-orchestrator dispatch --dispatcher-url http://127.0.0.1:8787 --input dispatch.json
forgeflow-review-orchestrator dispatch --dispatcher-url http://127.0.0.1:8787 --input dispatch.json --target-worker-id trae-remote-forgeflow
forgeflow-review-orchestrator dispatch --dispatcher-url http://127.0.0.1:8787 --input dispatch.json --target-worker-id trae-local-forgeflow --require-existing-worker
forgeflow-review-orchestrator dispatch-task --dispatcher-url http://127.0.0.1:8787 --repo TingRuDeng/ForgeFlow --default-branch main --task-id task-1 --title "Update docs" --pool trae --branch-name ai/trae/task-1 --allowed-paths docs/**,README.md --acceptance "pnpm typecheck,git diff --check" --target-worker-id trae-remote-forgeflow
forgeflow-review-orchestrator dispatch-task --dispatcher-url http://127.0.0.1:8787 --repo TingRuDeng/ForgeFlow --default-branch main --task-id task-1 --title "Refactor auth" --pool codex --branch-name ai/codex/auth --allowed-paths "packages/auth/**" --acceptance "pnpm typecheck" --worker-prompt "You are a codex worker. Refactor the auth module." --context-markdown "# Context\n\nFocus on packages/auth only."
forgeflow-review-orchestrator watch --dispatcher-url http://127.0.0.1:8787 --task-id dispatch-1:task-1
forgeflow-review-orchestrator decide --dispatcher-url http://127.0.0.1:8787 --task-id dispatch-1:task-1 --decision merge
forgeflow-review-orchestrator decide --state-dir /path/to/.forgeflow-dispatcher --task-id dispatch-1:task-1 --decision block --notes "Scope exceeded"
forgeflow-review-orchestrator inspect --dispatcher-url http://127.0.0.1:8787 --task-id dispatch-1:task-1
forgeflow-review-orchestrator inspect --dispatcher-url http://127.0.0.1:8787 --task-id dispatch-1:task-1 --summary
```

When `--target-worker-id` is set, the CLI injects that worker id into every task and assignment package before posting the dispatch. This keeps the existing `dispatch.json` shape but gives the control layer an explicit way to target `trae-local-forgeflow` or `trae-remote-forgeflow`.

When `--require-existing-worker` is set, the CLI fetches `/api/dashboard/snapshot` before dispatch and hard-fails if the pinned target worker is offline or if no online worker exists for the required task pool. Use this when the control layer must reuse an already running dispatcher + worker runtime instead of implicitly relying on a later bootstrap step.

Use `dispatch-task` for the common case of one worker task with one branch, one `allowedPaths` list, and one `acceptance` list. Keep `dispatch --input` for more complex multi-task or prebuilt payloads.

For Trae tasks, prefer structured flags (`--goal`, `--source-of-truth`, `--required-changes`, `--non-goals`, `--must-preserve`, `--acceptance`) over hand-written prompt files. The CLI now treats the final report contract as part of dispatch validation, not just a runtime convention.

Use `continue-task` when you need to resume an existing task. It preserves the original task lineage and routes through the redrive flow instead of creating a new dispatch.

For control-layer review flow, prefer this CLI over calling lower-level review-decision scripts directly. Keep the scripts as compatibility and implementation detail, but use `forgeflow-review-orchestrator decide` as the default operator entrypoint.
