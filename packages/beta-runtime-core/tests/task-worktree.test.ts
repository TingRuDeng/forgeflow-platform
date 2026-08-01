import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  prepareTaskWorktreeLifecycleWithOwnership,
  prepareTaskWorktreeLifecycle,
  prepareTaskWorktree,
  releaseTaskWorktreeOwnership,
  removeTaskWorktree,
  removeTaskWorktreeLifecycle,
  safeTaskDirName,
  TaskWorktreeLockTimeoutError,
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
  it("keeps an active task worktree owned until its worker releases it", async () => {
    const repoDir = setupRepoWithOrigin();
    const task = {
      taskId: "dispatch-owned",
      branchName: "codex/owned",
      defaultBranch: "main",
    };
    const prepared = await prepareTaskWorktreeLifecycleWithOwnership(repoDir, task);
    const uncommittedPath = path.join(prepared.worktreeDir, "UNCOMMITTED.md");
    fs.writeFileSync(uncommittedPath, "worker is still running\n");

    await expect(prepareTaskWorktreeLifecycle(repoDir, task, {
      allowReuse: true,
      resetOnReuse: true,
      lockTimeoutMs: 20,
      lockRetryMs: 5,
    })).rejects.toBeInstanceOf(TaskWorktreeLockTimeoutError);
    await expect(removeTaskWorktreeLifecycle(repoDir, task.taskId, {
      force: true,
      branchName: task.branchName,
      lockTimeoutMs: 20,
      lockRetryMs: 5,
    })).rejects.toBeInstanceOf(TaskWorktreeLockTimeoutError);
    await expect(prepareTaskWorktreeLifecycle(prepared.worktreeDir, {
      taskId: "dispatch-other-checkout",
      branchName: "codex/other-checkout",
      defaultBranch: "main",
    }, {
      lockTimeoutMs: 20,
      lockRetryMs: 5,
    })).rejects.toBeInstanceOf(TaskWorktreeLockTimeoutError);
    expect(fs.readFileSync(uncommittedPath, "utf8")).toBe("worker is still running\n");

    releaseTaskWorktreeOwnership(prepared.ownership);
    await expect(prepareTaskWorktreeLifecycle(repoDir, task, {
      allowReuse: true,
      resetOnReuse: true,
    })).resolves.toMatchObject({ action: "reused" });
    expect(fs.existsSync(uncommittedPath)).toBe(false);
  });

  it("aborts while waiting for an active task worktree owner", async () => {
    const repoDir = setupRepoWithOrigin();
    const task = {
      taskId: "dispatch-abort-lock",
      branchName: "codex/abort-lock",
      defaultBranch: "main",
    };
    const prepared = await prepareTaskWorktreeLifecycleWithOwnership(repoDir, task);
    const controller = new AbortController();

    const waiting = prepareTaskWorktreeLifecycleWithOwnership(repoDir, task, {
      allowReuse: true,
      lockTimeoutMs: 1_000,
      lockRetryMs: 5,
      signal: controller.signal,
    });
    controller.abort();

    await expect(waiting).rejects.toMatchObject({ name: "AbortError" });
    releaseTaskWorktreeOwnership(prepared.ownership);
  });

  it("fails synchronous same-process contention without blocking the event loop", async () => {
    const repoDir = setupRepoWithOrigin();
    const task = {
      taskId: "dispatch-sync-contention",
      branchName: "codex/sync-contention",
      defaultBranch: "main",
    };
    const prepared = await prepareTaskWorktreeLifecycleWithOwnership(repoDir, task);
    const waitSpy = vi.spyOn(Atomics, "wait");

    try {
      expect(() => prepareTaskWorktree(repoDir, task, {
        allowReuse: true,
        lockTimeoutMs: 20,
        lockRetryMs: 5,
      })).toThrow(TaskWorktreeLockTimeoutError);
      expect(waitSpy).not.toHaveBeenCalled();
    } finally {
      waitSpy.mockRestore();
      releaseTaskWorktreeOwnership(prepared.ownership);
    }
  });

  it("reclaims a stale task worktree owner after its process has exited", async () => {
    const repoDir = setupRepoWithOrigin();
    const task = {
      taskId: "dispatch-stale-lock",
      branchName: "codex/stale-lock",
      defaultBranch: "main",
    };
    const first = await prepareTaskWorktreeLifecycleWithOwnership(repoDir, task);
    const lockPath = first.ownership.lockPath;
    releaseTaskWorktreeOwnership(first.ownership);
    fs.writeFileSync(lockPath, JSON.stringify({
      pid: 2_147_483_647,
      ownerToken: "stale-owner",
      createdAt: "2000-01-01T00:00:00.000Z",
      taskId: task.taskId,
      branchName: task.branchName,
    }));

    await expect(prepareTaskWorktreeLifecycle(repoDir, task, {
      allowReuse: true,
      lockStaleMs: 1,
    })).resolves.toMatchObject({ action: "reused" });
    expect(fs.existsSync(lockPath)).toBe(false);
  });

  it("does not delete a replacement lock when ownership changes before release", async () => {
    const repoDir = setupRepoWithOrigin();
    const task = {
      taskId: "dispatch-replaced-lock",
      branchName: "codex/replaced-lock",
      defaultBranch: "main",
    };
    const prepared = await prepareTaskWorktreeLifecycleWithOwnership(repoDir, task);
    const lockPath = prepared.ownership.lockPath;
    fs.unlinkSync(lockPath);
    fs.writeFileSync(lockPath, JSON.stringify({
      pid: process.pid,
      ownerToken: "replacement-owner",
      createdAt: new Date().toISOString(),
      taskId: "replacement-task",
      branchName: "codex/replacement",
    }));

    expect(() => releaseTaskWorktreeOwnership(prepared.ownership))
      .toThrow(/ownership changed before release/i);
    expect(fs.existsSync(lockPath)).toBe(true);
    expect(fs.readFileSync(lockPath, "utf8")).toContain("replacement-owner");
    fs.unlinkSync(lockPath);
  });

  it("can retry ownership release after a transient unlink failure", async () => {
    const repoDir = setupRepoWithOrigin();
    const prepared = await prepareTaskWorktreeLifecycleWithOwnership(repoDir, {
      taskId: "dispatch-release-retry",
      branchName: "codex/release-retry",
      defaultBranch: "main",
    });
    const lockPath = prepared.ownership.lockPath;
    const unlinkSpy = vi.spyOn(fs, "unlinkSync");
    unlinkSpy.mockImplementationOnce(() => {
      throw new Error("simulated transient unlink failure");
    });

    try {
      expect(() => releaseTaskWorktreeOwnership(prepared.ownership))
        .toThrow(/simulated transient unlink failure/i);
      expect(fs.existsSync(lockPath)).toBe(true);
      expect(() => releaseTaskWorktreeOwnership(prepared.ownership)).not.toThrow();
      expect(fs.existsSync(lockPath)).toBe(false);
    } finally {
      unlinkSpy.mockRestore();
      if (fs.existsSync(lockPath)) {
        fs.unlinkSync(lockPath);
      }
    }
  });

  it("does not let one ownership remove another registered worktree", async () => {
    const repoDir = setupRepoWithOrigin();
    const taskId = "dispatch/owned-path";
    const branchName = "codex/owned-path";
    const legacyWorktreeDir = path.join(repoDir, ".worktrees", "dispatch-owned-path");
    fs.mkdirSync(path.dirname(legacyWorktreeDir), { recursive: true });
    runGit(["worktree", "add", "-b", branchName, legacyWorktreeDir, "origin/main"], repoDir);
    const owned = await prepareTaskWorktreeLifecycleWithOwnership(repoDir, {
      taskId,
      branchName: "codex/owned-path",
      defaultBranch: "main",
    }, {
      allowReuse: true,
    });
    expect(owned.worktreeDir).toBe(legacyWorktreeDir);
    const otherWorktreeDir = path.join(repoDir, ".worktrees", safeTaskDirName(taskId));
    runGit(["worktree", "add", "-b", "codex/other-path", otherWorktreeDir, "origin/main"], repoDir);

    try {
      await expect(removeTaskWorktreeLifecycle(repoDir, owned.taskId, {
        force: true,
        worktreeDir: otherWorktreeDir,
        ownership: owned.ownership,
      })).rejects.toThrow(/ownership does not match worktree path/i);
      expect(fs.existsSync(otherWorktreeDir)).toBe(true);
    } finally {
      releaseTaskWorktreeOwnership(owned.ownership);
    }
  });

  it("does not remove an owned path after its registered branch changes", async () => {
    const repoDir = setupRepoWithOrigin();
    const owned = await prepareTaskWorktreeLifecycleWithOwnership(repoDir, {
      taskId: "dispatch-owner-branch",
      branchName: "codex/owner-branch",
      defaultBranch: "main",
    });
    runGit(["switch", "-c", "codex/rebound-branch"], owned.worktreeDir);

    try {
      await expect(removeTaskWorktreeLifecycle(repoDir, owned.taskId, {
        force: true,
        ownership: owned.ownership,
      })).rejects.toThrow(/not registered for codex\/owner-branch/i);
      expect(fs.existsSync(owned.worktreeDir)).toBe(true);
    } finally {
      releaseTaskWorktreeOwnership(owned.ownership);
    }
  });

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
