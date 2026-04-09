# Lint Baseline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a repository-level lint and editor baseline for non-console codepaths without introducing broad formatting churn or immediate CI enforcement.

**Architecture:** Add a root flat ESLint config and root editor configuration, keep `apps/console` on its existing local config, and scope root lint scripts to `apps/dispatcher`, `packages/*`, `scripts/`, and `services/*`. Keep the first pass lightweight by using non-type-aware TypeScript linting and by avoiding Prettier or mass autofixes.

**Tech Stack:** ESLint flat config, TypeScript ESLint, Node.js, pnpm workspace

---

### Task 1: Add verification-first lint baseline

**Files:**
- Create: `eslint.config.js`
- Create: `.editorconfig`
- Modify: `package.json`
- Modify: `scripts/package.json`

- [ ] **Step 1: Add the root lint/editor baseline files and scripts**

Create `eslint.config.js` with a server/runtime-focused flat config:

```js
import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import { defineConfig, globalIgnores } from "eslint/config";

export default defineConfig([
  globalIgnores([
    "**/dist/**",
    "**/coverage/**",
    ".worktrees/**",
    ".forgeflow-dispatcher/**",
    ".orchestrator/**",
    "apps/console/**",
  ]),
  {
    files: [
      "apps/dispatcher/**/*.{ts,js,mjs,cjs}",
      "packages/**/*.{ts,js,mjs,cjs}",
      "scripts/**/*.{ts,js,mjs,cjs}",
      "services/**/*.{ts,js,mjs,cjs}",
    ],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        ...globals.node,
      },
    },
    rules: {
      "no-console": "off",
    },
  },
]);
```

Create `.editorconfig`:

```ini
root = true

[*]
charset = utf-8
end_of_line = lf
insert_final_newline = true
indent_style = space
indent_size = 2
trim_trailing_whitespace = true

[*.md]
trim_trailing_whitespace = false
```

Update root `package.json` to add dev dependencies and scripts:

```json
{
  "scripts": {
    "lint": "eslint apps/dispatcher packages scripts services --ext .ts,.js,.mjs,.cjs",
    "lint:fix": "pnpm lint --fix"
  },
  "devDependencies": {
    "@eslint/js": "^9.39.4",
    "eslint": "^9.39.4",
    "globals": "^17.4.0",
    "typescript-eslint": "^8.57.0"
  }
}
```

Update `scripts/package.json` to add minimal metadata:

```json
{
  "name": "@forgeflow/scripts",
  "private": true,
  "type": "module"
}
```

- [ ] **Step 2: Install dependencies**

Run:

```bash
pnpm install --frozen-lockfile
```

Expected: install completes and root workspace has ESLint runtime available in this worktree.

- [ ] **Step 3: Run lint and capture the first failure set**

Run:

```bash
pnpm lint
```

Expected: FAIL on real repository lint findings, proving the new baseline is active.

### Task 2: Reduce first-pass lint noise to a stable runnable baseline

**Files:**
- Modify: `eslint.config.js`
- Modify: `package.json`
- Modify: any directly affected source files only if a small targeted fix is lower-risk than rule suppression

- [ ] **Step 1: Adjust the root lint config to reflect current repo reality**

If the initial run fails on rules that are too noisy for a first baseline, keep the baseline narrow rather than fixing unrelated code in bulk. Prefer targeted rule relaxations such as:

```js
rules: {
  "no-console": "off",
  "@typescript-eslint/no-explicit-any": "off",
}
```

Do not add broad disables that would make lint meaningless.

- [ ] **Step 2: Re-run lint until the baseline passes**

Run:

```bash
pnpm lint
```

Expected: PASS

- [ ] **Step 3: Verify repository safety checks**

Run:

```bash
pnpm typecheck
git diff --check
```

Expected: PASS

### Task 3: Document the new baseline

**Files:**
- Modify: `README.md`
- Modify: `docs/README.md`

- [ ] **Step 1: Update docs to mention the root lint/editor baseline**

Add short references:

- `README.md`: mention `pnpm lint` as an available repo maintenance command
- `docs/README.md`: mention the repository-level lint/editor baseline and that `apps/console` still keeps its local ESLint config

- [ ] **Step 2: Re-run the final verification set**

Run:

```bash
pnpm lint
pnpm typecheck
git diff --check
```

Expected: PASS

- [ ] **Step 3: Commit**

Run:

```bash
git add eslint.config.js .editorconfig package.json pnpm-lock.yaml scripts/package.json README.md docs/README.md
git commit -m "Add repository lint baseline"
```
