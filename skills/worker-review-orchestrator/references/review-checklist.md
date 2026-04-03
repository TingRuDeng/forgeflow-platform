# Worker Review Checklist

Use this checklist when a task reaches `review`.

## Inspect First

Before making any decision, run `inspect` to gather evidence.

### Quick Triage

For routine review triage, prefer `inspect --summary`:

```bash
forgeflow-review-orchestrator inspect --dispatcher-url http://127.0.0.1:8787 --task-id dispatch-1:task-1 --summary
```

Verify from the `--summary` output:

- `status` is `review`
- `branch` and `latestResultEvidence.commit` are present
- `latestResultEvidence.testOutput` shows acceptance results
- `recentEvents` show consistent state transitions
- `reviewState` and `pullRequestState` if applicable

### Deep Debugging

For detailed audit, use full `inspect`:

```bash
forgeflow-review-orchestrator inspect --dispatcher-url http://127.0.0.1:8787 --task-id dispatch-1:task-1
```

Verify from the full `inspect` output:

- `task` state is `review`
- `assignment` shows which worker executed and when
- `pullRequest` exists if a PR was opened
- `events` show consistent state transitions
- `snapshot` provides full context for cross-referencing

Do not skip `inspect` before `decide`.

## Scope

- Does the diff stay inside `allowedPaths`?
- Did the worker modify only the files needed for this task?
- Is there any unrelated cleanup or refactor mixed in?

## Branch Hygiene

- Does the review branch contain commits from earlier tasks?
- Is the branch based on the expected baseline?
- Should the result be merged as a full branch, or only via cherry-pick?

## Acceptance

- Do reported commands match the task's `acceptance` contract?
- Are test results present and plausible?
- If something failed, is that failure documented accurately?

## Evidence

- Is branch evidence present?
- Is commit evidence present?
- Is push status present when required?
- Are file-change claims consistent with the actual diff?
- If approving, is there a PR to `main` (or equivalent target branch), and is the merge path clear?
- If PR is intentionally skipped, is there a documented cherry-pick-only integration reason and commit trail?

## Parallel Task Review

When reviewing results from parallel task execution:

### Independent Task Review

- Is this task being reviewed independently of other parallel tasks?
- Does the review decision account only for this task's scope and output?
- Are there any file conflicts with other in-flight or recently completed tasks?

### Conflict Detection

- Check if files modified in this task overlap with other parallel tasks
- If conflicts exist, document them before making a merge decision
- Do not merge if the same file was modified by another unmerged task

### Merge Order

- When multiple parallel tasks pass review, determine merge order by:
  - Priority of the original request
  - Dependencies between tasks (if any)
  - Risk of conflicts (merge lower-risk first)
- After merging one task, rebase remaining tasks if needed

### Cross-Task Consistency

- Do not assume consistency across parallel tasks
- Each task must stand on its own evidence
- Do not infer success from related tasks

### CLI Commands for Parallel Review

Use separate `inspect` and `decide` commands for each parallel task:

```bash
# Quick triage for each task
forgeflow-review-orchestrator inspect --dispatcher-url http://127.0.0.1:8787 --task-id dispatch-1:task-1 --summary
forgeflow-review-orchestrator inspect --dispatcher-url http://127.0.0.1:8787 --task-id dispatch-1:task-2 --summary

# Then decide on each independently
forgeflow-review-orchestrator decide --dispatcher-url http://127.0.0.1:8787 --task-id dispatch-1:task-1 --decision merge
forgeflow-review-orchestrator decide --dispatcher-url http://127.0.0.1:8787 --task-id dispatch-1:task-2 --decision merge
```

When reviewing parallel tasks with potential conflicts:

1. Inspect all parallel tasks before making any decisions
2. Check for file overlap in the diff before making any decision
3. If conflicts exist, block both tasks and document the conflict
4. If no conflicts, merge tasks in priority order
5. After merging the first task, re-inspect the second task's branch for conflicts

Do not merge parallel branches together. Merge each task branch to `main` separately, or cherry-pick specific commits.

## Decision

Approve only if:

- scope is clean
- branch hygiene is clean
- acceptance is satisfied or acceptably explained
- evidence is complete enough to trust the result
- no conflicts with other parallel tasks (or conflicts are documented and handled)
- PR-first integration is ready (or an explicitly justified cherry-pick-only path is documented)

Block if:

- the diff exceeds scope
- the branch is contaminated
- evidence is missing or inconsistent
- the task only partially solves the request
- file conflicts exist with other parallel tasks and are not resolved
