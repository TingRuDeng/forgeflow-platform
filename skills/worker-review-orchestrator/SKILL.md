---
name: worker-review-orchestrator
description: Use when dispatching ForgeFlow tasks to a worker or worker pool, tracking execution to review or failure, reviewing the resulting branch or diff, and deciding whether to merge or block through the dispatcher review flow.
---

# Worker Review Orchestrator

Use this skill from the control layer when the job is not "write code yourself" but rather:

- create a ForgeFlow task for another worker
- wait for that worker to finish
- review the produced branch, commit, diff, tests, and evidence
- decide whether the task should become `merged` or `blocked`

Do not use this skill for direct feature implementation. The worker executes the task; the control layer reviews and closes it.

## CLI Pairing

This skill is paired with the published CLI package:

```bash
npm install -g @tingrudeng/worker-review-orchestrator-cli
```

Use the global command as the default operator entrypoint:

```bash
forgeflow-review-orchestrator --help
```

Typical control-layer flow:

```bash
forgeflow-review-orchestrator dispatch-task \
  --dispatcher-url http://127.0.0.1:8787 \
  --repo TingRuDeng/ForgeFlow \
  --default-branch main \
  --task-id task-1 \
  --title "Update docs" \
  --pool trae \
  --branch-name ai/trae/task-1 \
  --target-worker-id trae-local-forgeflow \
  --require-existing-worker

forgeflow-review-orchestrator watch --dispatcher-url http://127.0.0.1:8787 --task-id dispatch-1:task-1
forgeflow-review-orchestrator inspect --dispatcher-url http://127.0.0.1:8787 --task-id dispatch-1:task-1 --summary
forgeflow-review-orchestrator decide --dispatcher-url http://127.0.0.1:8787 --task-id dispatch-1:task-1 --decision merge
```

Use `--require-existing-worker` when the skill must reuse an already running dispatcher plus online worker instead of allowing an implicit runtime bootstrap path.

## Worker Workspace Semantics

Dispatch payloads describe the task workspace contract; the worker runtime materializes that workspace itself.

- `defaultBranch` is the baseline branch the worker fetches from origin before task execution
- `branchName` is the task branch the worker creates or enters for that assignment
- the worker runs inside a per-task worktree rather than editing the control-layer checkout directly
- the control layer should assume the worker starts from the latest fetched default branch, not from whatever branch the controller is currently on

What this means for dispatch:

- do provide an explicit `defaultBranch`
- do provide the target `branchName`
- do assume the worker will prepare a fresh task worktree from the latest fetched `origin/<defaultBranch>`
- do not instruct the worker to manually "pull main first", "create a branch", or "create a worktree" as part of the task prompt unless the task is specifically about debugging workspace preparation itself
- do not treat the worker as if it will edit the controller's current checkout in place

## Preconditions

Before dispatching:

- confirm the target repo, pool or worker, `allowedPaths`, and `acceptance`
- confirm which dispatcher truth source is active:
  - HTTP dispatcher, or
  - local dispatcher state dir
- if an HTTP dispatcher is expected, inspect the live dispatcher snapshot first and treat it as the source of truth for currently online workers
- prefer the latest `origin/main` as review baseline
- when a task must land on one exact worker, prefer `forgeflow-review-orchestrator dispatch --target-worker-id <workerId>` over relying on pool ordering
- prefer the skill's normal control-layer entrypoints over ad-hoc project-local CLI artifacts

If the request is ambiguous about scope, tighten it before dispatching. Do not create a task whose review boundary is unclear.

## Runtime Reuse Gate

Default behavior: reuse the already running control-plane processes and the already online workers.

Before starting any dispatch:

1. if `--dispatcher-url` is available, call the live snapshot endpoint first:

```bash
curl -s http://127.0.0.1:8787/api/dashboard/snapshot
```

2. pick from the workers that are already `idle` or `busy` in that snapshot and match the target repo / pool
3. if runtime reuse is mandatory, add `--require-existing-worker` so the CLI hard-fails when no matching online worker exists
4. if the task must go to one exact worker, dispatch with `--target-worker-id <workerId> --require-existing-worker`
5. if no suitable worker is online, stop and report that the existing runtime is unavailable; do not silently start a new dispatcher, gateway, or worker

Do **not** start a second control plane or a duplicate worker just to make the task dispatch succeed.

Specifically, unless the user explicitly asked to bootstrap runtime infrastructure, do **not** run startup commands such as:

- `node scripts/run-dispatcher-server.mjs`
- `node scripts/run-worker-daemon.mjs`
- `node scripts/run-trae-automation-worker.mjs`
- `node scripts/run-trae-automation-gateway.mjs`
- `forgeflow-trae-beta start gateway`
- `forgeflow-trae-beta start worker`

Treat runtime bootstrap as a separate task from review orchestration.

If an existing dispatcher is live and workers are online, reuse them. If an existing dispatcher is live but no suitable worker is online, report blocked or ask whether runtime bootstrap is intended. Do not improvise a parallel runtime.

## CLI Hygiene

Prefer the standard ForgeFlow control-layer entrypoints that this skill is written around.

- use `forgeflow-review-orchestrator` as the primary operator CLI
- use `forgeflow-review-orchestrator decide` as the default review-decision path
- keep low-level repository scripts as compatibility or fallback paths, not the default operator workflow

Do **not** treat a repository-local built file such as:

- `packages/worker-review-orchestrator-cli/dist/cli.js`

as the default source of truth for orchestration behavior.

Why:

- project-local `dist` can be stale even when source has already changed
- this can silently reintroduce already-fixed bugs during dispatch / redrive / inspect flows

If you must invoke the project-local CLI directly:

1. first verify that the built artifact is fresh relative to source
2. prefer rebuilding it before use
3. call out explicitly that you are using a local built artifact rather than the normal skill path

When dispatching tasks, do not pass a generic prompt template file as if it were already a materialized worker prompt. Fill in the task-specific goal, scope, constraints, and acceptance first.

## Standard Flow

1. Create a dispatch task for the target worker path.
2. Track the task until it reaches `review` or `failed`.
3. If the task ends in `failed`, summarize the failure and stop. Do not merge.
4. If the task reaches `review`, review the produced branch or commit before making any decision.
5. If the result is acceptable, open a PR from the worker branch to `main` (or the configured default branch), then merge that PR (or apply an equivalent cherry-pick integration).
6. After integration is complete, mark the task `merged`.
7. If the result is not acceptable, mark the task `blocked` with concrete rework notes.

## Rework Flow

When a task is `blocked` and should continue, do not stop at the review decision.

- Use `redrive` to send the same task back to the existing worker when the scope and acceptance are still valid.
- Re-dispatch only when the scope, acceptance, or target worker need to change materially.
- If only one commit is safe to keep, prefer cherry-picking that commit instead of merging the full branch.
- Keep the rework notes concrete so the worker knows exactly what must change before the next review.

## Parallel Worker Guidance

When multiple workers are available or multiple tasks need dispatching:

### Handling Multiple Idle Workers

- Check worker pool status before dispatch to identify available workers
- When HTTP dispatcher is available, use the live dashboard snapshot as the worker inventory instead of assuming no worker exists
- Match task requirements to worker capabilities (Trae, Codex, Gemini)
- Distribute independent tasks across idle workers to maximize throughput
- When dispatching 2 or more independent tasks in parallel, explicitly reserve different online workers for them instead of sending multiple pool-only dispatches and hoping the dispatcher spreads them
- Prefer one `--target-worker-id` per concurrent task, plus `--require-existing-worker`, when multiple idle workers already exist
- If only one suitable worker is idle, do not pretend the tasks are parallel; queue or stage them deliberately
- Avoid assigning the same task to multiple workers simultaneously
- Track which worker is assigned to which task in the dispatcher state

Example when two Trae workers are idle:

```bash
curl -s http://127.0.0.1:8787/api/dashboard/snapshot | jq '{workers: [.workers[] | select(.pool=="trae" and (.status=="idle" or .status=="busy")) | {id, status}]}'

forgeflow-review-orchestrator dispatch-task ... --target-worker-id trae-local-forgeflow --require-existing-worker
forgeflow-review-orchestrator dispatch-task ... --target-worker-id trae-remote-forgeflow --require-existing-worker
```

### Dispatching Follow-on Tasks

When workers free up after completing tasks:

1. Check for pending tasks in the queue
2. Verify the freed worker's capability matches pending task requirements
3. Dispatch the next suitable task without waiting for all parallel tasks to complete
4. Track follow-on dispatches in the dispatcher state for audit trail
5. Do not dispatch follow-on tasks that depend on incomplete parallel tasks

### Reviewing Parallel Task Results

When multiple tasks complete in parallel:

- Review each task independently against its own `allowedPaths` and `acceptance`
- Do not merge results from unrelated parallel tasks together
- Check for file conflicts between parallel task outputs before merging any
- If two parallel tasks modified the same file:
  - Block both and require coordination
  - Or merge the higher-priority task first, then rebase the other
- Maintain separate review decisions per task
- Do not assume one task's success implies another's

### Parallel Dispatch Anti-Patterns

Avoid:

- Starting a new dispatcher or worker when a suitable one is already online
- Dispatching multiple concurrent tasks to the same pool without pinning different idle workers when the intent is parallel execution
- Dispatching tasks with overlapping `allowedPaths` to different workers
- Merging multiple parallel branches without checking for conflicts
- Assuming parallel tasks will complete in any particular order
- Skipping review for any task because "related tasks passed"

## Dispatch Rules

When creating a task:

- keep the task single-purpose
- define `allowedPaths`
- define `acceptance`
- prefer one worker or one worker pool
- avoid bundling unrelated refactors into the same task

Preferred dispatch path:

- for one focused task, prefer `forgeflow-review-orchestrator dispatch-task ...`
- use `forgeflow-review-orchestrator dispatch --dispatcher-url ... --input dispatch.json` when you already have a prepared payload or need multi-task dispatch
- if the task must run on a specific worker, add `--target-worker-id trae-local-forgeflow` or `--target-worker-id trae-remote-forgeflow`
- when runtime reuse is mandatory, add `--require-existing-worker` so the CLI rejects the dispatch if the target worker or pool is not already online
- remember that `defaultBranch` and `branchName` are workspace instructions for the worker runtime: it will fetch the latest default branch and materialize the task worktree itself
- keep the JSON payload focused on task scope; let the CLI inject the target worker when possible
- when an existing dispatcher is available, prefer reusing its live `--dispatcher-url` and the worker ids discovered from `/api/dashboard/snapshot`

### dispatch-task Prompt and Context Inputs

The `dispatch-task` command supports both inline and file-backed worker guidance inputs:

- `--worker-prompt`: a literal string passed directly as the worker prompt
- `--context-markdown`: a literal string passed directly as the context markdown
- `--worker-prompt-file`: read worker prompt content from a file
- `--context-markdown-file`: read context markdown content from a file

Priority:

- file input wins over inline input when both are provided
- missing files fall back to the inline value, then to the command's default prompt/context

Use file-backed inputs when the task prompt is long or needs to be versioned in the repo, but make sure the file already contains a materialized task prompt rather than a raw generic template with placeholders.

For Trae beta execution, prefer:

- documentation updates
- scripts or configuration changes
- single-feature, small-scope business code changes with clear acceptance

## Review Checklist

Always check:

- scope: does the diff stay within `allowedPaths`
- branch hygiene: does the branch contain unrelated or previously unmerged commits
- acceptance: do reported test or typecheck results match the task contract
- evidence: is branch, commit, and push evidence present when expected
- intent: does the output actually solve the assigned task
- execution context preflight: for Trae beta workers, verify the worker produced preflight proof evidence:
  - current repo path (`pwd` or equivalent)
  - current branch (`git branch --show-current` or `git symbolic-ref --short HEAD`)
  - git status (`git status --short`) confirming clean or expected state
  - expected worktree (`git worktree list`) confirming correct worktree for this task

If preflight proof evidence is missing from Trae beta task logs, flag as "missing execution context preflight proof" in the review notes and request the evidence before merging.

Use the detailed checklist in [references/review-checklist.md](references/review-checklist.md) when needed.

## Inspect Before Decision

Before making any `merge` or `block` decision, use the `inspect` command to gather task evidence.

### Routine Review Triage

For routine review triage, prefer `inspect --summary` for a concise overview:

```bash
forgeflow-review-orchestrator inspect --dispatcher-url http://127.0.0.1:8787 --task-id dispatch-1:task-1 --summary
```

The `--summary` flag returns a focused view including:

- `taskId`, `status`, `branch`, `repo`
- `workerId` from the assignment
- `latestResultEvidence`: commit, pushStatus, testOutput
- `recentEvents`: last 5 events (reversed, most recent first)
- `reviewState`: latest review decision, actor, and timestamp
- `pullRequestState`: PR url, status, and number

Use `--summary` when you need a quick status check to determine if the task is ready for decision.

### Deep Debugging

For deep debugging or detailed audit, use full `inspect` without `--summary`:

```bash
forgeflow-review-orchestrator inspect --dispatcher-url http://127.0.0.1:8787 --task-id dispatch-1:task-1
```

The full `inspect` command returns the complete task snapshot including:

- `task`: current task state and metadata
- `assignment`: worker assignment details and timing
- `reviews`: all review records for this task
- `pullRequest`: PR information if a PR was created
- `events`: all events related to this task
- `snapshot`: the complete dispatcher snapshot for cross-referencing

Use full `inspect` when:

- investigating state transition anomalies
- cross-referencing multiple tasks in the same snapshot
- auditing the full event history
- debugging worker assignment timing issues

Run `inspect` (with or without `--summary`) before `decide`. Do not skip inspection when the task is in `review` state.

## Decision Rules

Approve only when all of these are true:

- the result matches the task scope
- there are no blocking review findings
- integration path is clean
- status and evidence are internally consistent
- a PR-based integration path is prepared (unless explicitly using cherry-pick-only integration for a scoped reason)

Block when any of these happen:

- diff exceeds `allowedPaths`
- branch carries unrelated commits
- acceptance evidence is missing or contradicted
- task output only partially solves the request

When a branch is mostly correct but not safe to merge wholesale, prefer cherry-picking the exact good commit instead of merging the full worker branch.

## Status Updates

Do not use an arbitrary "set status" shortcut.

Use the normal ForgeFlow state machine:

- worker execution moves tasks into `review` or `failed`
- review decisions move `review -> merged` or `review -> blocked`
  - `blocked` is a review outcome, not an automatic re-assignment
  - if the task should continue after being blocked, explicitly `redrive` or re-dispatch it

For `--decision merge`, treat it as the closeout step after integration is done:

- default: merge via PR to `main` first, then submit `--decision merge`
- exception: if PR is intentionally skipped, record why and use an explicit cherry-pick integration trail before `--decision merge`

Preferred decision path:

- default:
  - use `forgeflow-review-orchestrator decide`
- dispatcher HTTP available:
  - `forgeflow-review-orchestrator decide --dispatcher-url ... --task-id ... --decision merge|block`
- dispatcher HTTP unavailable:
  - `forgeflow-review-orchestrator decide --state-dir /path/to/.forgeflow-dispatcher --task-id ... --decision merge|block`
- keep `scripts/submit-review-decision.mjs` and `scripts/lib/review-decision.mjs` as compatibility paths or low-level fallbacks, not the primary operator workflow

## CLI Usage

Use `forgeflow-review-orchestrator` CLI from `@tingrudeng/worker-review-orchestrator-cli` package:

### Install

Install the skill and CLI as two separate steps. The skill install should be explicit global user-level installation:

```bash
npx skills add https://github.com/TingRuDeng/forgeflow-platform/skills --skill worker-review-orchestrator -g -y
npm install -g @tingrudeng/worker-review-orchestrator-cli
```

If the npm package is not installed yet, use the repository-local fallback only when working inside a forgeflow-platform checkout and after confirming the built artifact is fresh:

```bash
pnpm --filter @tingrudeng/worker-review-orchestrator-cli build
node packages/worker-review-orchestrator-cli/dist/cli.js --help
```

### Reuse Existing Runtime First

Before dispatching, prefer a live dispatcher-backed workflow like:

```bash
curl -s http://127.0.0.1:8787/api/dashboard/snapshot | jq '{workers: [.workers[] | {id, pool, status, repoDir}]}'
forgeflow-review-orchestrator dispatch-task --dispatcher-url http://127.0.0.1:8787 ... --target-worker-id trae-local-forgeflow --require-existing-worker
```

If that snapshot already shows a suitable online worker, reuse it and keep `--require-existing-worker` on. Do not start another control plane or worker process as part of ordinary task dispatch.

### dispatch

Create a new dispatch task:

```bash
forgeflow-review-orchestrator dispatch --dispatcher-url http://127.0.0.1:8787 --input dispatch.json
```

The `dispatch.json` should match the CLI's real dispatch payload shape:

- top-level `repo`
- top-level `defaultBranch`
- a `tasks` array
- a `packages` array

Put branch names, `allowedPaths`, and `acceptance` inside the task and package payloads, not as ad hoc top-level fields.

### watch

Poll the dispatcher until a task reaches a terminal state:

```bash
forgeflow-review-orchestrator watch --dispatcher-url http://127.0.0.1:8787 --task-id dispatch-1:task-1
```

Optional parameters:
- `--interval-ms`: polling interval (default: 2000)
- `--timeout-ms`: maximum wait time (default: 600000)

### decide

Submit a review decision after reviewing the task output:

```bash
forgeflow-review-orchestrator decide --dispatcher-url http://127.0.0.1:8787 --task-id dispatch-1:task-1 --decision merge
forgeflow-review-orchestrator decide --dispatcher-url http://127.0.0.1:8787 --task-id dispatch-1:task-1 --decision block --notes "Rework required: scope exceeded"
```

Optional parameters:
- `--actor`: reviewer identity
- `--notes`: explanation for the decision
- `--at`: timestamp for the decision

### state-dir Fallback

When the HTTP dispatcher is unavailable, use `--state-dir` instead of `--dispatcher-url`:

```bash
forgeflow-review-orchestrator decide --state-dir /path/to/.forgeflow-dispatcher --task-id dispatch-1:task-1 --decision merge
```

Use state-dir fallback when:
- Running in environments without HTTP dispatcher access
- Reviewing local-only task execution
- Testing or debugging dispatcher state transitions

Do not mix `--dispatcher-url` and `--state-dir` in the same command.

## Response Pattern

When using this skill, report in this order:

1. task identity: `dispatchId`, `taskId`, worker
2. current or final status
3. review findings, if any
4. decision:
   - `merged`
   - `blocked`
   - `failed`
5. merge or cherry-pick commit, when applicable

Keep findings concrete. If blocking, say exactly what must be redone.
