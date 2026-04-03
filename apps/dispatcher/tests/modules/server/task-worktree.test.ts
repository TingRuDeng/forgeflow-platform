import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { afterEach, describe, expect, it } from "vitest";

const repoRoot = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "../../../../../",
);
const taskWorktreeModulePath = path.join(repoRoot, "scripts/lib/task-worktree.js");
const tempRoots: string[] = [];

function makeTempDir() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "forgeflow-task-worktree-"));
  tempRoots.push(tempDir);
  return tempDir;
}

function runGit(args: string[], cwd: string) {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
  });
  if ((result.status ?? 1) !== 0) {
    throw new Error(result.stderr || result.stdout || `git ${args.join(" ")} failed`);
  }
  return (result.stdout || "").trim();
}

function setupRepoWithOrigin() {
  const tempDir = makeTempDir();
  const originDir = path.join(tempDir, "origin.git");
  const seedDir = path.join(tempDir, "seed");
  const repoDir = path.join(tempDir, "repo");

  fs.mkdirSync(seedDir, { recursive: true });
  runGit(["init", "--bare", originDir], tempDir);
  runGit(["init", "-b", "master"], seedDir);
  runGit(["config", "user.name", "ForgeFlow Test"], seedDir);
  runGit(["config", "user.email", "forgeflow@example.com"], seedDir);
  fs.writeFileSync(path.join(seedDir, "README.md"), "# repo\n");
  runGit(["add", "README.md"], seedDir);
  runGit(["commit", "-m", "init"], seedDir);
  runGit(["remote", "add", "origin", originDir], seedDir);
  runGit(["push", "-u", "origin", "master"], seedDir);

  runGit(["clone", originDir, repoDir], tempDir);
  runGit(["config", "user.name", "ForgeFlow Test"], repoDir);
  runGit(["config", "user.email", "forgeflow@example.com"], repoDir);

  return { seedDir, repoDir };
}

afterEach(() => {
  for (const tempDir of tempRoots.splice(0)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

describe("task worktree preparation", () => {
  it("creates a task worktree from the latest origin default branch", async () => {
    const { seedDir, repoDir } = setupRepoWithOrigin();
    const mod = await import(taskWorktreeModulePath);

    fs.writeFileSync(path.join(seedDir, "LATEST.md"), "latest\n");
    runGit(["add", "LATEST.md"], seedDir);
    runGit(["commit", "-m", "latest"], seedDir);
    runGit(["push", "origin", "master"], seedDir);

    const worktreeDir = mod.prepareTaskWorktree(repoDir, {
      taskId: "dispatch-1:task-1",
      branchName: "ai/test-task",
      defaultBranch: "master",
    });

    expect(worktreeDir).toBe(path.join(repoDir, ".worktrees", "dispatch-1-task-1"));
    expect(fs.existsSync(path.join(worktreeDir, "LATEST.md"))).toBe(true);
    expect(runGit(["branch", "--show-current"], worktreeDir)).toBe("ai/test-task");
  });

  it("reuses the same task worktree only when reuse is explicitly allowed", async () => {
    const { repoDir } = setupRepoWithOrigin();
    const mod = await import(taskWorktreeModulePath);

    const first = mod.prepareTaskWorktree(repoDir, {
      taskId: "dispatch-2:task-1",
      branchName: "ai/test-reuse",
      defaultBranch: "master",
    });
    fs.writeFileSync(path.join(first, "LOCAL.txt"), "local\n");

    expect(() => mod.prepareTaskWorktree(repoDir, {
      taskId: "dispatch-2:task-1",
      branchName: "ai/test-reuse",
      defaultBranch: "master",
    })).toThrow(/existing worktree/i);

    const second = mod.prepareTaskWorktree(repoDir, {
      taskId: "dispatch-2:task-1",
      branchName: "ai/test-reuse",
      defaultBranch: "master",
    }, {
      allowReuse: true,
    });

    expect(second).toBe(first);
    expect(fs.existsSync(path.join(second, "LOCAL.txt"))).toBe(true);
  });

  it("fails instead of falling back to a stale local branch when fetch fails", async () => {
    const { seedDir, repoDir } = setupRepoWithOrigin();
    const mod = await import(taskWorktreeModulePath);

    fs.writeFileSync(path.join(repoDir, "LOCAL_ONLY.md"), "stale local\n");
    runGit(["add", "LOCAL_ONLY.md"], repoDir);
    runGit(["commit", "-m", "local only"], repoDir);
    runGit(["remote", "remove", "origin"], repoDir);

    fs.writeFileSync(path.join(seedDir, "UPSTREAM.md"), "upstream\n");
    runGit(["add", "UPSTREAM.md"], seedDir);
    runGit(["commit", "-m", "upstream"], seedDir);

    expect(() => mod.prepareTaskWorktree(repoDir, {
      taskId: "dispatch-3:task-1",
      branchName: "ai/test-fetch-fail",
      defaultBranch: "master",
    })).toThrow(/failed to fetch origin\/master/i);

    expect(fs.existsSync(path.join(repoDir, ".worktrees", "dispatch-3-task-1"))).toBe(false);
  });
});
