# Dispatcher Runtime Package Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish a globally installable dispatcher runtime package so users can run ForgeFlow control-plane behavior without cloning the repo.

**Architecture:** Keep `apps/dispatcher` private as the source of truth, and add a new product/runtime package that bundles the dispatcher runtime graph into package-local CLI output. Expose a small operator-facing CLI around config, start, doctor, backup, restore, and version.

**Tech Stack:** TypeScript, Node 22, esbuild, Vitest, npm Trusted Publishing

---

### Task 1: Scaffold package and build pipeline

**Files:**
- Create: `packages/forgeflow-dispatcher/package.json`
- Create: `packages/forgeflow-dispatcher/tsconfig.json`
- Create: `packages/forgeflow-dispatcher/scripts/build.mjs`
- Create: `packages/forgeflow-dispatcher/src/*.ts`

- [ ] Create the package skeleton with a public npm identity, CLI bin, build/test/typecheck scripts, and `esbuild`-based bundling.
- [ ] Add a minimal TypeScript config for package-local sources.
- [ ] Build the runtime CLI into `dist/cli.js` with a node shebang.

### Task 2: Implement runtime CLI and config flow

**Files:**
- Create: `packages/forgeflow-dispatcher/src/cli.ts`
- Create: `packages/forgeflow-dispatcher/src/config.ts`
- Create: `packages/forgeflow-dispatcher/src/paths.ts`

- [ ] Implement command parsing for `init/start/doctor/status/backup/restore/version`.
- [ ] Store runtime config under `~/.forgeflow-dispatcher/config.json`.
- [ ] Make `start` call the dispatcher server entrypoint with config-backed defaults.

### Task 3: Implement operator helpers

**Files:**
- Create: `packages/forgeflow-dispatcher/src/backup.ts`
- Create: `packages/forgeflow-dispatcher/src/doctor.ts`
- Create: `packages/forgeflow-dispatcher/src/http.ts`

- [ ] Add `backup` and `restore` helpers for runtime state files.
- [ ] Add `doctor` and `status` checks for config, writable paths, and optional health probing.

### Task 4: Add tests and packaging verification

**Files:**
- Create: `packages/forgeflow-dispatcher/tests/*.test.ts`

- [ ] Cover config, CLI parsing, backup/restore, and doctor/status helpers.
- [ ] Verify package build output is generated and package metadata is packable.

### Task 5: Update docs and release metadata

**Files:**
- Modify: `README.md`
- Modify: `docs/README.md`
- Modify: `docs/runbooks/single-machine-deployment.md`
- Create: `packages/forgeflow-dispatcher/README.md`
- Create: `packages/forgeflow-dispatcher/PUBLISHING.md`

- [ ] Add the new install-and-run control-plane path to repo docs.
- [ ] Document package-local usage and publishing checks.
- [ ] Ensure package versioning will trigger existing auto-release workflow.
