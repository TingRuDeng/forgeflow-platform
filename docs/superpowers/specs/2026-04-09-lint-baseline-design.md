# Lint Baseline Design

## Goal

Add a repository-level lint and editor baseline that improves consistency across `apps/dispatcher`, `packages/*`, and `scripts/` without introducing a large formatting churn or forcing immediate CI adoption.

## Scope

In scope:

- add a root `eslint.config.js`
- add a root `.editorconfig`
- add root `lint` and `lint:fix` scripts
- lint TypeScript and JavaScript files under `apps/dispatcher`, `packages/*`, `scripts/`, and `services/*`
- keep `apps/console` on its existing local ESLint config for now

Out of scope:

- introducing Prettier
- mass auto-formatting unrelated files
- converting existing warnings to zero in one pass
- adding lint as a blocking CI gate in this change
- restructuring package-local lint configuration into a shared config package

## Current Context

- Only `apps/console` currently has an ESLint config.
- The repository has no root `.editorconfig`.
- The old review report correctly identified missing shared lint/editor baselines, but its phase and package-state conclusions are outdated.
- The current workspace already relies on TypeScript and Vitest, so a lightweight root lint baseline can follow existing tool choices instead of introducing a new formatting system.

## Approach Options

### Option A: Minimal root baseline

- Add a root flat ESLint config with broad ignore patterns.
- Use one TypeScript/JavaScript baseline for server-side code.
- Leave `apps/console` untouched.
- Add root scripts and `.editorconfig`.

Pros:

- lowest churn
- immediate improvement for most of the monorepo
- avoids destabilizing existing console lint behavior

Cons:

- repository will temporarily have two ESLint entrypoints

### Option B: Full shared lint unification

- Create a reusable lint config package and migrate `apps/console` at the same time.

Pros:

- cleaner long-term structure

Cons:

- larger change surface
- higher chance of noisy lint fallout
- unnecessary for this baseline step

## Decision

Choose Option A.

This delivers the missing repository-wide baseline with minimal behavioral risk and preserves a clean follow-up path if we later want a shared lint package.

## Design

### Root ESLint

Create a root `eslint.config.js` that:

- ignores generated and local-state directories such as `dist`, `coverage`, `.worktrees`, `.forgeflow-dispatcher`
- applies to `apps/dispatcher/**/*.{ts,js,mjs,cjs}`, `packages/**/*.{ts,js,mjs,cjs}`, `scripts/**/*.{ts,js,mjs,cjs}`, and `services/**/*.{ts,js,mjs,cjs}`
- uses `@eslint/js` recommended rules
- uses `typescript-eslint` recommended rules for TypeScript files
- sets Node globals for server/runtime code
- disables type-aware linting for this first step to avoid requiring per-package parser project wiring

### Local Console Boundary

Do not modify `apps/console/eslint.config.js`.

The root scripts should target the server/runtime parts of the repo and leave the console app on its existing config until a later unification pass.

### Editor Baseline

Add a root `.editorconfig` that standardizes:

- UTF-8
- LF line endings
- final newline
- trim trailing whitespace
- 2-space indentation by default
- Markdown trailing whitespace exception

### Package Scripts

Add root scripts:

- `lint`
- `lint:fix`

These scripts should run against the server/runtime monorepo paths only, not the console app, so the baseline stays explicit and predictable.

## Verification

Planned validation:

- `pnpm install --frozen-lockfile` in the isolated worktree if dependencies are missing
- `pnpm lint`
- `pnpm typecheck`
- `git diff --check`

## Risks

- Existing server/runtime files may surface a moderate number of lint findings on first run.
- If lint noise is too high, the fallback is to narrow rule severity rather than widening scope or dropping the baseline.

## Expected Outcome

After this change, the repository will have a documented and runnable shared lint/editor baseline for the non-console codepaths, while preserving a low-risk follow-up path for CI enforcement and deeper lint unification.
