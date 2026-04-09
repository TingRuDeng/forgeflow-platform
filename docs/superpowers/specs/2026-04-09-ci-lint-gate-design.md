# CI Lint Gate Design

## Goal

Promote the newly added repository lint baseline from a local-only maintenance command into an enforced CI check.

## Scope

In scope:

- update `.github/workflows/ci.yml`
- run `pnpm lint` after dependency install and before `pnpm typecheck`

Out of scope:

- workflow matrix expansion
- action version upgrades unrelated to the lint gate
- changes to the lint baseline itself
- additional docs beyond normal completion reporting unless a contributor-facing doc is clearly impacted

## Approach

Keep the current single-job CI structure and add one explicit lint step:

1. checkout
2. setup node/pnpm/cache
3. install dependencies
4. run `pnpm lint`
5. run `pnpm typecheck`
6. build
7. test
8. diff check

## Why This Shape

- it enforces the repository-level lint command exactly as contributors run it locally
- it keeps failures early, before typecheck/build/test cost
- it avoids introducing a second lint command or package-specific workflow drift

## Verification

- `pnpm lint`
- `git diff --check`

## Expected Outcome

After this change, pull requests that regress the repository lint baseline will fail CI instead of relying on manual local discipline.
