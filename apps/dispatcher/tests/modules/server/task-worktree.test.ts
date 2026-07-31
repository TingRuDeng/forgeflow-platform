import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { afterEach, describe, expect, it } from "vitest";

const taskWorktreeModulePath = new URL("../../../src/modules/server/task-worktree.ts", import.meta.url).href;
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

    expect(worktreeDir).toBe(path.join(
      repoDir,
      ".worktrees",
      mod.safeTaskDirName("dispatch-1:task-1"),
    ));
    expect(fs.existsSync(path.join(worktreeDir, "LATEST.md"))).toBe(true);
    expect(runGit(["branch", "--show-current"], worktreeDir)).toBe("ai/test-task");
  });

  it("resets a reused task worktree before returning it", async () => {
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
      resetOnReuse: true,
    });

    expect(second).toBe(first);
    expect(fs.existsSync(path.join(second, "LOCAL.txt"))).toBe(false);
    expect(runGit(["branch", "--show-current"], second)).toBe("ai/test-reuse");
  });

  it("reuses and removes an exact legacy path registered for the same branch", async () => {
    const { repoDir } = setupRepoWithOrigin();
    const mod = await import(taskWorktreeModulePath);
    const taskId = "dispatch-legacy:task-1";
    const branchName = "ai/test-legacy";
    const legacyDir = path.join(repoDir, ".worktrees", "dispatch-legacy-task-1");
    fs.mkdirSync(path.dirname(legacyDir), { recursive: true });
    runGit(["worktree", "add", "-b", branchName, legacyDir, "origin/master"], repoDir);

    const worktreeDir = mod.prepareTaskWorktree(repoDir, {
      taskId,
      branchName,
      defaultBranch: "master",
    }, {
      allowReuse: true,
    });

    expect(worktreeDir).toBe(legacyDir);
    expect(worktreeDir).not.toContain(mod.safeTaskDirName(taskId));
    expect(() => mod.removeTaskWorktree(repoDir, taskId))
      .toThrow(/legacy worktree cleanup requires branchName/i);
    mod.removeTaskWorktree(repoDir, taskId, {
      branchName,
    });
    expect(fs.existsSync(legacyDir)).toBe(false);
  });

  it("refuses to remove a worktree through a symbolic-link alias", async () => {
    const { repoDir } = setupRepoWithOrigin();
    const mod = await import(taskWorktreeModulePath);
    const targetDir = path.join(repoDir, ".worktrees", "registered-target");
    fs.mkdirSync(path.dirname(targetDir), { recursive: true });
    runGit(["worktree", "add", "-b", "ai/registered-target", targetDir, "origin/master"], repoDir);
    const taskId = "alias/task";
    const aliasDir = path.join(repoDir, ".worktrees", mod.safeTaskDirName(taskId));
    fs.symlinkSync(targetDir, aliasDir, "dir");

    expect(() => mod.removeTaskWorktree(repoDir, taskId, {
      worktreeDir: aliasDir,
    })).toThrow(/symbolic-link worktree path/i);
    expect(fs.existsSync(targetDir)).toBe(true);
  });

  it("reports a stale Git registration whose worktree directory is missing", async () => {
    const { repoDir } = setupRepoWithOrigin();
    const mod = await import(taskWorktreeModulePath);
    const worktreeDir = mod.prepareTaskWorktree(repoDir, {
      taskId: "dispatch-missing",
      branchName: "ai/missing",
      defaultBranch: "master",
    });
    fs.rmSync(worktreeDir, { recursive: true, force: true });

    expect(() => mod.removeTaskWorktree(repoDir, "dispatch-missing"))
      .toThrow(/registered worktree path is missing from disk/i);
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

    expect(fs.existsSync(path.join(
      repoDir,
      ".worktrees",
      mod.safeTaskDirName("dispatch-3:task-1"),
    ))).toBe(false);
  });

  it("rejects unsafe paths, invalid refs, and destructive cleanup without force", async () => {
    const { repoDir } = setupRepoWithOrigin();
    const mod = await import(taskWorktreeModulePath);

    for (const taskId of ["///", ".", ".."]) {
      expect(() => mod.prepareTaskWorktree(repoDir, {
        taskId,
        branchName: "ai/safe-task",
        defaultBranch: "master",
      })).toThrow(/safe worktree directory/i);
      expect(() => mod.removeTaskWorktree(repoDir, taskId)).toThrow(/safe worktree directory/i);
    }

    expect(() => mod.prepareTaskWorktree(repoDir, {
      taskId: "dispatch-invalid-ref",
      branchName: "bad..branch",
      defaultBranch: "master",
    })).toThrow(/invalid task branch name/i);

    const worktreeDir = mod.prepareTaskWorktree(repoDir, {
      taskId: "dispatch-dirty",
      branchName: "ai/dirty-task",
      defaultBranch: "master",
    });
    fs.writeFileSync(path.join(worktreeDir, "UNCOMMITTED.md"), "keep\n");
    expect(() => mod.removeTaskWorktree(repoDir, "dispatch-dirty"))
      .toThrow(/preserve dirty worktree|retry with force/i);
    expect(fs.existsSync(path.join(worktreeDir, "UNCOMMITTED.md"))).toBe(true);
    mod.removeTaskWorktree(repoDir, "dispatch-dirty", { force: true });
    expect(fs.existsSync(worktreeDir)).toBe(false);
  });
});
