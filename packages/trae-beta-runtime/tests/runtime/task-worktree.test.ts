import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

const spawnSyncMock = vi.fn(() => ({
  status: 0,
  stdout: "",
  stderr: "",
}));

vi.mock("node:child_process", () => ({
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

    expect(safeTaskDirName("task 123/branch")).toBe("task-123-branch");

    const worktreeDir = prepareTaskWorktree(tempRoot, {
      taskId: "task 123/branch",
      branchName: "feature/runtime",
      defaultBranch: "main",
    });

    expect(worktreeDir).toBe(path.join(tempRoot, ".worktrees", "task-123-branch"));
    expect(fs.existsSync(path.join(tempRoot, ".worktrees"))).toBe(true);
    expect(spawnSyncMock).toHaveBeenNthCalledWith(1, "git", ["fetch", "origin", "main"], {
      cwd: tempRoot,
      encoding: "utf8",
    });
    expect(spawnSyncMock).toHaveBeenNthCalledWith(2, "git", ["rev-parse", "--verify", "origin/main"], {
      cwd: tempRoot,
      encoding: "utf8",
    });
    expect(spawnSyncMock).toHaveBeenNthCalledWith(3, "git", [
      "worktree",
      "add",
      worktreeDir,
      "-B",
      "feature/runtime",
      "origin/main",
    ], {
      cwd: tempRoot,
      encoding: "utf8",
    });
  });

  it("fails fast when fetching the default branch fails", async () => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "forgeflow-task-worktree-"));
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

    expect(spawnSyncMock).toHaveBeenCalledTimes(1);
    expect(spawnSyncMock).toHaveBeenCalledWith("git", ["fetch", "origin", "main"], {
      cwd: tempRoot,
      encoding: "utf8",
    });
  });
});
