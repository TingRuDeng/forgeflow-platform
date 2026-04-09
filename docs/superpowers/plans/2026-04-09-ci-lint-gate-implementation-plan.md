# CI Lint Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the repository-level lint command to the existing CI workflow so lint regressions fail in pull requests.

**Architecture:** Reuse the existing root `pnpm lint` command in the current single-job CI workflow and place it immediately after dependency installation to fail early without changing the rest of the pipeline.

**Tech Stack:** GitHub Actions, pnpm, ESLint

---

### Task 1: Add lint to CI

**Files:**
- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: Insert a dedicated lint step after dependency installation**

Update `.github/workflows/ci.yml`:

```yml
      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Run lint
        run: pnpm lint

      - name: Run typecheck
        run: pnpm typecheck
```

- [ ] **Step 2: Verify the local lint command still passes**

Run:

```bash
pnpm lint
```

Expected: PASS

- [ ] **Step 3: Verify patch hygiene**

Run:

```bash
git diff --check
```

Expected: PASS

- [ ] **Step 4: Commit**

Run:

```bash
git add .github/workflows/ci.yml docs/superpowers/specs/2026-04-09-ci-lint-gate-design.md docs/superpowers/plans/2026-04-09-ci-lint-gate-implementation-plan.md
git commit -m "Add lint to CI"
```
