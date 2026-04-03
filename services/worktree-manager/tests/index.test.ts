import { describe, expect, it } from "vitest";

import { WorktreeManager } from "../src/index.js";

describe("WorktreeManager", () => {
  it("creates task worktree with generated branch name", async () => {
    const commands: string[][] = [];
    const manager = new WorktreeManager(async (args) => {
      commands.push(args);
      return { stdout: "", stderr: "", exitCode: 0 };
    });

    const result = await manager.createTaskWorktree({
      rootDir: ".worktrees",
      branchTemplate: "ai/{pool}/{task_id}-{slug}",
      pool: "codex",
      taskId: "task-1",
      slug: "auth-api",
    });

    expect(result.branchName).toBe("ai/codex/task-1-auth-api");
    expect(commands[0]).toEqual([
      "git",
      "worktree",
      "add",
      ".worktrees/task-1-auth-api",
      "-b",
      "ai/codex/task-1-auth-api",
    ]);
  });

  it("removes finished worktrees", async () => {
    const commands: string[][] = [];
    const manager = new WorktreeManager(async (args) => {
      commands.push(args);
      return { stdout: "", stderr: "", exitCode: 0 };
    });

    await manager.removeTaskWorktree(".worktrees/task-1-auth-api");

    expect(commands[0]).toEqual([
      "git",
      "worktree",
      "remove",
      ".worktrees/task-1-auth-api",
      "--force",
    ]);
  });

  it("syncs task worktree with the default branch", async () => {
    const commands: string[][] = [];
    const manager = new WorktreeManager(async (args) => {
      commands.push(args);
      return { stdout: "", stderr: "", exitCode: 0 };
    });

    await manager.syncTaskWorktree(".worktrees/task-1-auth-api", "main");

    expect(commands).toEqual([
      ["git", "-C", ".worktrees/task-1-auth-api", "fetch", "origin", "main"],
      ["git", "-C", ".worktrees/task-1-auth-api", "rebase", "origin/main"],
    ]);
  });
});
