import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

const spawnSyncMock = vi.fn(() => ({
  status: 0,
  stdout: "",
  stderr: "",
}));
const execFileMock = vi.fn();

vi.mock("node:child_process", () => ({
  execFile: execFileMock,
  spawnSync: spawnSyncMock,
}));

describe("runtime/task-worktree", () => {
  let tempRoot = "";

  afterEach(() => {
    if (tempRoot) {
      fs.rmSync(tempRoot, { recursive: true, force: true });
      tempRoot = "";
    }
    spawnSyncMock.mockClear();
  });

  it("creates a task worktree with a sanitized directory name", async () => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "forgeflow-task-worktree-"));
    const { prepareTaskWorktree, safeTaskDirName } = await import("../../src/runtime/task-worktree.js");
    const safeName = safeTaskDirName("task 123/branch");

    expect(safeName).toMatch(/^task-123-branch-[0-9a-f]{12}$/);
    expect(safeTaskDirName("a/b")).not.toBe(safeTaskDirName("a b"));

    const worktreeDir = prepareTaskWorktree(tempRoot, {
      taskId: "task 123/branch",
      branchName: "feature/runtime",
      defaultBranch: "main",
    });

    expect(worktreeDir).toBe(path.join(tempRoot, ".worktrees", safeName));
    expect(fs.existsSync(path.join(tempRoot, ".worktrees"))).toBe(true);
    expect(spawnSyncMock).toHaveBeenNthCalledWith(1, "git", ["check-ref-format", "--branch", "feature/runtime"], {
      cwd: tempRoot,
      encoding: "utf8",
      timeout: 60_000,
    });
    expect(spawnSyncMock).toHaveBeenNthCalledWith(2, "git", ["worktree", "list", "--porcelain"], {
      cwd: tempRoot,
      encoding: "utf8",
      timeout: 60_000,
    });
    expect(spawnSyncMock).toHaveBeenNthCalledWith(3, "git", ["fetch", "origin", "main"], {
      cwd: tempRoot,
      encoding: "utf8",
      timeout: 60_000,
    });
    expect(spawnSyncMock).toHaveBeenNthCalledWith(4, "git", ["rev-parse", "--verify", "origin/main"], {
      cwd: tempRoot,
      encoding: "utf8",
      timeout: 60_000,
    });
    expect(spawnSyncMock).toHaveBeenNthCalledWith(5, "git", [
      "worktree",
      "add",
      worktreeDir,
      "-B",
      "feature/runtime",
      "origin/main",
    ], {
      cwd: tempRoot,
      encoding: "utf8",
      timeout: 60_000,
    });
  });

  it("fails fast when fetching the default branch fails", async () => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "forgeflow-task-worktree-"));
    spawnSyncMock.mockImplementationOnce(() => ({
      status: 0,
      stdout: "",
      stderr: "",
    }));
    spawnSyncMock.mockImplementationOnce(() => ({
      status: 0,
      stdout: "",
      stderr: "",
    }));
    spawnSyncMock.mockImplementationOnce(() => ({
      status: 1,
      stdout: "",
      stderr: "fatal: unable to fetch origin/main",
    }));
    const { prepareTaskWorktree } = await import("../../src/runtime/task-worktree.js");

    expect(() => prepareTaskWorktree(tempRoot, {
      taskId: "task-fetch-fail",
      branchName: "feature/runtime",
      defaultBranch: "main",
    })).toThrow(/unable to fetch origin\/main|failed to fetch origin\/main/i);

    expect(spawnSyncMock).toHaveBeenCalledTimes(3);
    expect(spawnSyncMock).toHaveBeenNthCalledWith(1, "git", ["check-ref-format", "--branch", "feature/runtime"], {
      cwd: tempRoot,
      encoding: "utf8",
      timeout: 60_000,
    });
    expect(spawnSyncMock).toHaveBeenNthCalledWith(2, "git", ["worktree", "list", "--porcelain"], {
      cwd: tempRoot,
      encoding: "utf8",
      timeout: 60_000,
    });
    expect(spawnSyncMock).toHaveBeenNthCalledWith(3, "git", ["fetch", "origin", "main"], {
      cwd: tempRoot,
      encoding: "utf8",
      timeout: 60_000,
    });
  });

  it("refuses to reuse a branch registered at another task worktree path", async () => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "forgeflow-task-worktree-"));
    const occupiedPath = path.join(tempRoot, ".worktrees", "dispatch-178");
    spawnSyncMock.mockImplementationOnce(() => ({
      status: 0,
      stdout: "",
      stderr: "",
    }));
    spawnSyncMock.mockImplementationOnce(() => ({
      status: 0,
      stdout: `worktree ${occupiedPath}\nHEAD abc123\nbranch refs/heads/feature/runtime\n\n`,
      stderr: "",
    }));

    const { prepareTaskWorktree } = await import("../../src/runtime/task-worktree.js");
    expect(() => prepareTaskWorktree(tempRoot, {
      taskId: "dispatch-180",
      branchName: "feature/runtime",
      defaultBranch: "main",
    }, {
      allowReuse: true,
    })).toThrow(/branch feature\/runtime is already checked out at .*dispatch-178/i);
    expect(spawnSyncMock).toHaveBeenCalledTimes(2);
    expect(spawnSyncMock).toHaveBeenNthCalledWith(2, "git", ["worktree", "list", "--porcelain"], {
      cwd: tempRoot,
      encoding: "utf8",
      timeout: 60_000,
    });
  });

  it("reuses an exact legacy path registered for the same branch", async () => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "forgeflow-task-worktree-"));
    const taskId = "dispatch-legacy:task-1";
    const branchName = "feature/legacy-runtime";
    const legacyDir = path.join(tempRoot, ".worktrees", "dispatch-legacy-task-1");
    fs.mkdirSync(legacyDir, { recursive: true });
    spawnSyncMock.mockImplementationOnce(() => ({
      status: 0,
      stdout: "",
      stderr: "",
    }));
    spawnSyncMock.mockImplementationOnce(() => ({
      status: 0,
      stdout: `worktree ${legacyDir}\nHEAD abc123\nbranch refs/heads/${branchName}\n\n`,
      stderr: "",
    }));

    const { prepareTaskWorktree, safeTaskDirName } = await import("../../src/runtime/task-worktree.js");
    const worktreeDir = prepareTaskWorktree(tempRoot, {
      taskId,
      branchName,
      defaultBranch: "main",
    }, {
      allowReuse: true,
    });

    expect(worktreeDir).toBe(legacyDir);
    expect(worktreeDir).not.toContain(safeTaskDirName(taskId));
    expect(spawnSyncMock).toHaveBeenCalledTimes(2);
  });

  it("fails fast with occupied path when the branch is already checked out and reuse is disabled", async () => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "forgeflow-task-worktree-"));
    const occupiedPath = path.join(tempRoot, ".worktrees", "dispatch-178");
    spawnSyncMock.mockImplementationOnce(() => ({
      status: 0,
      stdout: "",
      stderr: "",
    }));
    spawnSyncMock.mockImplementationOnce(() => ({
      status: 0,
      stdout: `worktree ${occupiedPath}\nHEAD abc123\nbranch refs/heads/feature/runtime\n\n`,
      stderr: "",
    }));

    const { prepareTaskWorktree } = await import("../../src/runtime/task-worktree.js");

    expect(() => prepareTaskWorktree(tempRoot, {
      taskId: "dispatch-180",
      branchName: "feature/runtime",
      defaultBranch: "main",
    })).toThrow(new RegExp(`branch feature/runtime is already checked out at .*dispatch-178`));
    expect(spawnSyncMock).toHaveBeenCalledTimes(2);
  });

  it("refuses to use the default branch as a task branch", async () => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "forgeflow-task-worktree-"));
    const { prepareTaskWorktree } = await import("../../src/runtime/task-worktree.js");

    expect(() => prepareTaskWorktree(tempRoot, {
      taskId: "dispatch-main",
      branchName: "main",
      defaultBranch: "main",
    })).toThrow(/default branch as task worktree branch/i);
    expect(spawnSyncMock).not.toHaveBeenCalled();
  });

  it("rejects unsafe task directory names and invalid branch refs", async () => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "forgeflow-task-worktree-"));
    const { prepareTaskWorktree } = await import("../../src/runtime/task-worktree.js");

    for (const taskId of ["///", ".", ".."]) {
      expect(() => prepareTaskWorktree(tempRoot, {
        taskId,
        branchName: "feature/runtime",
        defaultBranch: "main",
      })).toThrow(/safe worktree directory/i);
    }
    expect(spawnSyncMock).not.toHaveBeenCalled();

    spawnSyncMock.mockImplementationOnce(() => ({
      status: 1,
      stdout: "",
      stderr: "fatal: 'bad..branch' is not a valid branch name",
    }));
    expect(() => prepareTaskWorktree(tempRoot, {
      taskId: "dispatch-invalid-branch",
      branchName: "bad..branch",
      defaultBranch: "main",
    })).toThrow(/invalid task branch name/i);
  });
});
