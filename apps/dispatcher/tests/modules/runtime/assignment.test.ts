import { describe, expect, it } from "vitest";

import {
  buildLaunchInputFromAssignmentPackage,
  buildVerificationInputFromAssignmentPackage,
  buildWorkerExecutionResult,
} from "../../../src/modules/runtime/assignment.js";

const assignment = {
  taskId: "task-2",
  workerId: "codex-worker-1",
  pool: "codex" as const,
  status: "assigned" as const,
  branchName: "ai/codex/task-2-backend-auth-api",
  allowedPaths: ["src/**", "tests/**"],
  commands: {
    test: "pnpm test",
    build: "pnpm typecheck",
  },
  repo: "TingRuDeng/openclaw-multi-agent-mvp",
  defaultBranch: "master",
};

describe("assignment runtime helpers", () => {
  it("builds runtime launch input from an assignment package", () => {
    const launchInput = buildLaunchInputFromAssignmentPackage({
      assignment,
      workerPrompt: "你是 codex-worker。\n实现认证接口。",
      worktreeDir: ".worktrees/task-2",
    });

    expect(launchInput).toEqual({
      taskId: "task-2",
      prompt: "你是 codex-worker。\n实现认证接口。",
      mode: "run",
      worktreeDir: ".worktrees/task-2",
    });
  });

  it("builds verification input from assignment commands", () => {
    const verificationInput = buildVerificationInputFromAssignmentPackage({
      assignment,
      worktreeDir: ".worktrees/task-2",
    });

    expect(verificationInput).toEqual({
      cwd: ".worktrees/task-2",
      commands: ["pnpm test", "pnpm typecheck"],
    });
  });

  it("ignores empty commands", () => {
    const assignmentWithEmpty = {
      ...assignment,
      commands: {
        test: "pnpm test",
        empty: "",
        whitespace: "   ",
        build: "pnpm typecheck",
      },
    };

    const verificationInput = buildVerificationInputFromAssignmentPackage({
      assignment: assignmentWithEmpty,
      worktreeDir: ".worktrees/task-2",
    });

    expect(verificationInput).toEqual({
      cwd: ".worktrees/task-2",
      commands: ["pnpm test", "pnpm typecheck"],
    });
  });

  it("removes duplicate commands", () => {
    const assignmentWithDuplicates = {
      ...assignment,
      commands: {
        test1: "pnpm test",
        test2: "pnpm test",
        build1: "pnpm typecheck",
        build2: "pnpm typecheck",
      },
    };

    const verificationInput = buildVerificationInputFromAssignmentPackage({
      assignment: assignmentWithDuplicates,
      worktreeDir: ".worktrees/task-2",
    });

    expect(verificationInput).toEqual({
      cwd: ".worktrees/task-2",
      commands: ["pnpm test", "pnpm typecheck"],
    });
  });

  it("builds a normalized worker execution result", () => {
    const result = buildWorkerExecutionResult({
      assignment,
      provider: "codex",
      output: "implemented auth api",
      verification: [
        { command: "pnpm test", exitCode: 0, output: "tests passed" },
        { command: "pnpm typecheck", exitCode: 0, output: "typecheck passed" },
      ],
      generatedAt: "2026-03-16T08:00:00.000Z",
    });

    expect(result).toEqual({
      taskId: "task-2",
      workerId: "codex-worker-1",
      provider: "codex",
      pool: "codex",
      branchName: "ai/codex/task-2-backend-auth-api",
      repo: "TingRuDeng/openclaw-multi-agent-mvp",
      defaultBranch: "master",
      mode: "run",
      output: "implemented auth api",
      generatedAt: "2026-03-16T08:00:00.000Z",
      verification: {
        allPassed: true,
        commands: [
          { command: "pnpm test", exitCode: 0, output: "tests passed" },
          { command: "pnpm typecheck", exitCode: 0, output: "typecheck passed" },
        ],
      },
    });
  });
});
