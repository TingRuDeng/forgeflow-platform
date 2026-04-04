# Dispatch Quality Checklist

Use this checklist before creating a new task, follow-up task, or rework task.

The goal is to reject weak task specs before they reach a worker.

## Minimum Quality Bar

Do not dispatch if any item below is missing or vague.

- Is the `Goal` a result, not a topic?
- Is the task small enough that review can answer "accept or block" quickly?
- Are `Allowed Paths` precise enough to prevent broad refactors?
- Are `Non-Goals` explicit?
- Does `Acceptance` contain runnable commands?
- Does the task state what old behavior must be preserved?
- Does the receipt requirement ask for branch / commit / push / test evidence?

## Source Of Truth

Before dispatching, confirm:

- Which file, contract doc, PR, or merged behavior is the source of truth?
- Does the task explicitly say the worker must align with that source?
- If there is already an upstream branch or commit, is it named in the task?
- Is the task preventing "parallel schema" or "parallel state semantics" drift?

If the answer is no, stop and tighten the task.

## Write-Set Discipline

Prefer:

- exact file paths
- one subsystem per task
- one reviewer decision boundary per task

Avoid:

- large directory globs when only 1-3 files are actually needed
- mixing runtime, CLI, docs, and review-memory in one task unless the change must be atomic
- "clean up related code while there" scope creep

## Acceptance Design

Good acceptance:

- `pnpm --filter ... test ...`
- `pnpm --filter ... typecheck`
- `git diff --check`
- explicit test scenarios to cover

Bad acceptance:

- "功能正常"
- "review 通过"
- "没有明显问题"

If the worker cannot tell what proof is required, the task is underspecified.

## Rework Tasks

For rework, do not dispatch with only:

- "按 review 修改"
- "fix review comments"
- "resolve findings"

Instead, every review finding must become:

- the concrete problem
- the required fix
- the proof that the fix is done

Recommended rework structure:

- Finding 1
  Problem: <what is wrong now>
  Required fix: <what must be true after the change>
  Proof: <test, diff property, or inspectable result>

- Finding 2
  Problem: <...>
  Required fix: <...>
  Proof: <...>

## Follow-Up And Dependency Tasks

If the task depends on another task:

- name the source task / branch / commit
- state what behavior is already fixed upstream
- state what this task must not redefine
- do not dispatch the consumer task early unless the upstream contract is stable

If the task is a follow-up or same-chain repair:

- default to the same worker unless there is a documented reason to switch
- state the reason when switching workers
- treat local vs remote execution environments as explicit constraints

## Final Gate

Before dispatching, ask:

1. Can the worker finish this without inventing missing requirements?
2. Can the reviewer decide accept/block without reinterpreting the task?
3. If the worker returns a "creative" solution, would the task text clearly mark it out of scope?

If any answer is no, rewrite the task first.
