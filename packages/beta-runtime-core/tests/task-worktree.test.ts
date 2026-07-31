import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { afterEach, describe, expect, it } from "vitest";

import {
  prepareTaskWorktreeLifecycle,
  removeTaskWorktree,
  removeTaskWorktreeLifecycle,
  safeTaskDirName,
} from "../src/runtime/task-worktree.js";

const tempRoots: string[] = [];

function runGit(args: string[], cwd: string): string {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if ((result.status ?? 1) !== 0) {
    throw new Error(result.stderr || result.stdout || `git ${args.join(" ")} failed`);
  }
  return (result.stdout || "").trim();
}

function setupRepoWithOrigin(): string {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "forgeflow-runtime-worktree-"));
  tempRoots.push(tempRoot);
  const originDir = path.join(tempRoot, "origin.git");
  const repoDir = path.join(tempRoot, "repo");
  fs.mkdirSync(repoDir, { recursive: true });
  runGit(["init", "--bare", originDir], tempRoot);
  runGit(["init", "-b", "main"], repoDir);
  runGit(["config", "user.name", "ForgeFlow Test"], repoDir);
  runGit(["config", "user.email", "forgeflow@example.com"], repoDir);
  fs.writeFileSync(path.join(repoDir, "README.md"), "# repo\n");
  runGit(["add", "README.md"], repoDir);
  runGit(["commit", "-m", "init"], repoDir);
  runGit(["remote", "add", "origin", originDir], repoDir);
  runGit(["push", "-u", "origin", "main"], repoDir);
  return repoDir;
}

afterEach(() => {
  for (const tempRoot of tempRoots.splice(0)) {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

describe("task worktree lifecycle", () => {
  it("creates and reports a task worktree from the fetched default branch", async () => {
    const repoDir = setupRepoWithOrigin();

    const prepared = await prepareTaskWorktreeLifecycle(repoDir, {
      taskId: "dispatch-1:task-1",
      branchName: "codex/task-1",
      defaultBranch: "main",
    });

    expect(prepared).toMatchObject({
      action: "created",
      branchName: "codex/task-1",
      baseRef: "origin/main",
    });
    expect(runGit(["branch", "--show-current"], prepared.worktreeDir)).toBe("codex/task-1");
  });

  it("refuses to reuse an expected path registered for another branch", async () => {
    const repoDir = setupRepoWithOrigin();
    const worktreeDir = path.join(repoDir, ".worktrees", "dispatch-2");
    fs.mkdirSync(path.dirname(worktreeDir), { recursive: true });
    runGit(["worktree", "add", "-b", "codex/other", worktreeDir, "origin/main"], repoDir);

    await expect(prepareTaskWorktreeLifecycle(repoDir, {
      taskId: "dispatch-2",
      branchName: "codex/expected",
      defaultBranch: "main",
    }, {
      allowReuse: true,
      resetOnReuse: true,
    })).rejects.toThrow(/registered for codex\/other, not codex\/expected/i);
  });

  it("keeps lossy task directory names collision-resistant", async () => {
    const repoDir = setupRepoWithOrigin();
    expect(safeTaskDirName("a/b")).not.toBe(safeTaskDirName("a b"));

    await prepareTaskWorktreeLifecycle(repoDir, {
      taskId: "a/b",
      branchName: "codex/shared-task",
      defaultBranch: "main",
    });

    await expect(prepareTaskWorktreeLifecycle(repoDir, {
      taskId: "a b",
      branchName: "codex/shared-task",
      defaultBranch: "main",
    }, {
      allowReuse: true,
    })).rejects.toThrow(/already checked out/i);
  });

  it("reuses and safely removes an exact legacy path registered for the same branch", async () => {
    const repoDir = setupRepoWithOrigin();
    const taskId = "dispatch-legacy:task-1";
    const branchName = "codex/legacy-task-1";
    const legacyDir = path.join(repoDir, ".worktrees", "dispatch-legacy-task-1");
    fs.mkdirSync(path.dirname(legacyDir), { recursive: true });
    runGit(["worktree", "add", "-b", branchName, legacyDir, "origin/main"], repoDir);

    const prepared = await prepareTaskWorktreeLifecycle(repoDir, {
      taskId,
      branchName,
      defaultBranch: "main",
    }, {
      allowReuse: true,
    });

    expect(prepared).toMatchObject({
      action: "reused",
      branchName,
      worktreeDir: legacyDir,
    });
    expect(prepared.worktreeDir).not.toContain(safeTaskDirName(taskId));

    await expect(removeTaskWorktreeLifecycle(repoDir, taskId))
      .rejects.toThrow(/legacy worktree cleanup requires branchName/i);
    await expect(removeTaskWorktreeLifecycle(repoDir, taskId, {
      branchName,
    })).resolves.toMatchObject({
      action: "removed",
      worktreeDir: legacyDir,
    });
  });

  it("refuses to remove a worktree through a symbolic-link alias", async () => {
    const repoDir = setupRepoWithOrigin();
    const targetDir = path.join(repoDir, ".worktrees", "registered-target");
    fs.mkdirSync(path.dirname(targetDir), { recursive: true });
    runGit(["worktree", "add", "-b", "codex/registered-target", targetDir, "origin/main"], repoDir);
    const taskId = "alias/task";
    const aliasDir = path.join(repoDir, ".worktrees", safeTaskDirName(taskId));
    fs.symlinkSync(targetDir, aliasDir, "dir");

    await expect(removeTaskWorktreeLifecycle(repoDir, taskId, {
      worktreeDir: aliasDir,
    })).rejects.toThrow(/symbolic-link worktree path/i);
    expect(fs.existsSync(targetDir)).toBe(true);
  });

  it("reports a stale Git registration whose worktree directory is missing", async () => {
    const repoDir = setupRepoWithOrigin();
    const prepared = await prepareTaskWorktreeLifecycle(repoDir, {
      taskId: "dispatch-missing",
      branchName: "codex/missing",
      defaultBranch: "main",
    });
    fs.rmSync(prepared.worktreeDir, { recursive: true, force: true });

    expect(() => removeTaskWorktree(repoDir, "dispatch-missing"))
      .toThrow(/registered worktree path is missing from disk/i);
    await expect(removeTaskWorktreeLifecycle(repoDir, "dispatch-missing"))
      .rejects.toThrow(/registered worktree path is missing from disk/i);
  });

  it("preserves a dirty worktree unless force cleanup is explicit", async () => {
    const repoDir = setupRepoWithOrigin();
    const prepared = await prepareTaskWorktreeLifecycle(repoDir, {
      taskId: "dispatch-3",
      branchName: "codex/task-3",
      defaultBranch: "main",
    });
    fs.writeFileSync(path.join(prepared.worktreeDir, "UNCOMMITTED.md"), "keep me\n");

    await expect(removeTaskWorktreeLifecycle(repoDir, "dispatch-3"))
      .rejects.toThrow(/preserve dirty worktree|retry with force/i);
    expect(fs.existsSync(path.join(prepared.worktreeDir, "UNCOMMITTED.md"))).toBe(true);

    await expect(removeTaskWorktreeLifecycle(repoDir, "dispatch-3", { force: true }))
      .resolves.toMatchObject({ action: "removed" });
    expect(fs.existsSync(prepared.worktreeDir)).toBe(false);
  });

  it("rejects default-branch worktrees and honors an already-aborted signal", async () => {
    const repoDir = setupRepoWithOrigin();
    await expect(prepareTaskWorktreeLifecycle(repoDir, {
      taskId: "dispatch-4",
      branchName: "main",
      defaultBranch: "main",
    })).rejects.toThrow(/refusing to use default branch/i);

    const controller = new AbortController();
    controller.abort();
    await expect(prepareTaskWorktreeLifecycle(repoDir, {
      taskId: "dispatch-5",
      branchName: "codex/task-5",
      defaultBranch: "main",
    }, {
      signal: controller.signal,
    })).rejects.toMatchObject({ name: "AbortError" });
  });

  it("rejects unsafe task directory names and invalid branch refs before creating a worktree", async () => {
    const repoDir = setupRepoWithOrigin();

    for (const taskId of ["///", ".", ".."]) {
      await expect(prepareTaskWorktreeLifecycle(repoDir, {
        taskId,
        branchName: "codex/task-safe",
        defaultBranch: "main",
      })).rejects.toThrow(/safe worktree directory/i);
      await expect(removeTaskWorktreeLifecycle(repoDir, taskId))
        .rejects.toThrow(/safe worktree directory/i);
    }

    await expect(prepareTaskWorktreeLifecycle(repoDir, {
      taskId: "dispatch-invalid-ref",
      branchName: "bad..branch",
      defaultBranch: "main",
    })).rejects.toThrow(/invalid task branch name/i);
    expect(fs.existsSync(path.join(repoDir, ".worktrees"))).toBe(false);
  });
});
