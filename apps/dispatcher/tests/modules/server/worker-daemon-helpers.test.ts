import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { afterEach, describe, expect, it } from "vitest";

const repoRoot = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "../../../../../",
);
const helperModulePath = path.join(repoRoot, "scripts/lib/worker-daemon-helpers.js");
const tempRoots: string[] = [];

function makeTempDir() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "forgeflow-worker-daemon-helpers-"));
  tempRoots.push(tempDir);
  return tempDir;
}

function runGit(args: string[], cwd: string) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if ((result.status ?? 1) !== 0) {
    throw new Error(result.stderr || result.stdout || `git ${args.join(" ")} failed`);
  }
  return (result.stdout || "").trim();
}

function createRepo(rootDir: string, defaultBranch = "main") {
  const repoDir = path.join(rootDir, "repo");
  fs.mkdirSync(repoDir, { recursive: true });
  runGit(["init", "-b", defaultBranch], repoDir);
  runGit(["config", "user.name", "ForgeFlow Test"], repoDir);
  runGit(["config", "user.email", "forgeflow@example.com"], repoDir);
  fs.writeFileSync(path.join(repoDir, "README.md"), "# repo\n");
  runGit(["add", "README.md"], repoDir);
  runGit(["commit", "-m", "init"], repoDir);
  return repoDir;
}

afterEach(() => {
  for (const tempDir of tempRoots.splice(0)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

describe("worker-daemon helpers", () => {
  it("builds an allowlisted worker env from a provided source", async () => {
    const mod = await import(helperModulePath);
    const env = mod.buildWorkerEnv({
      PATH: "/usr/bin",
      HOME: "/tmp/home",
      CUSTOM_SECRET: "secret",
      FORGEFLOW_WORKER_ENV_ALLOWLIST: "PATH,HOME,CUSTOM_SECRET",
    });

    expect(env).toEqual({
      PATH: "/usr/bin",
      HOME: "/tmp/home",
      CUSTOM_SECRET: "secret",
    });
  });

  it("accepts a valid feature branch and rejects default or disallowed branches", async () => {
    const mod = await import(helperModulePath);
    const repoDir = createRepo(makeTempDir(), "main");

    expect(() => mod.assertSafeBranchName(repoDir, "codex/feature-1", "main", {
      FORGEFLOW_ALLOWED_PUSH_PREFIXES: "codex/,ai/",
    })).not.toThrow();

    expect(() => mod.assertSafeBranchName(repoDir, "main", "main")).toThrow(/refusing to push to default branch/i);
    expect(() => mod.assertSafeBranchName(repoDir, "feature-1", "main", {
      FORGEFLOW_ALLOWED_PUSH_PREFIXES: "codex/,ai/",
    })).toThrow(/not allowed/i);
  });

  it("reads PR and worktree cleanup toggles from env-like input", async () => {
    const mod = await import(helperModulePath);

    expect(mod.shouldCreatePullRequest({ FORGEFLOW_WORKER_CREATE_PR: "1" })).toBe(true);
    expect(mod.shouldCreatePullRequest({ FORGEFLOW_WORKER_CREATE_PR: "0" })).toBe(false);
    expect(mod.shouldRemoveWorktreeOnExit({ FORGEFLOW_WORKER_REMOVE_WORKTREE_ON_EXIT: "1" })).toBe(true);
    expect(mod.shouldRemoveWorktreeOnExit({ FORGEFLOW_WORKER_REMOVE_WORKTREE_ON_EXIT: "0" })).toBe(false);
  });
});
