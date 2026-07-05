import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  runWorkerAssignment,
  type AssignmentLaunchCommand,
} from "../src/runtime/run-worker-assignment.js";

const tempRoots: string[] = [];

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "forgeflow-core-assignment-"));
  tempRoots.push(dir);
  return dir;
}

function writeAssignmentPackage(root: string): { assignmentDir: string; worktreeDir: string; outputDir: string } {
  const assignmentDir = path.join(root, "assignment");
  const worktreeDir = path.join(root, "worktree");
  const outputDir = path.join(root, "output");
  fs.mkdirSync(assignmentDir, { recursive: true });
  fs.mkdirSync(worktreeDir, { recursive: true });
  fs.writeFileSync(path.join(assignmentDir, "assignment.json"), JSON.stringify({
    taskId: "dispatch-1:task-1",
    workerId: "codex-worker",
    pool: "codex",
    branchName: "ai/codex/task-1",
    repo: "owner/repo",
    defaultBranch: "main",
    commands: { test: "node -e 'console.log(\"verify ok\")'" },
  }));
  fs.writeFileSync(path.join(assignmentDir, "worker-prompt.md"), "Do the work.");
  fs.writeFileSync(path.join(assignmentDir, "context.md"), "# Context");
  return { assignmentDir, worktreeDir, outputDir };
}

describe("shared run-worker-assignment runner", () => {
  afterEach(() => {
    for (const tempDir of tempRoots.splice(0)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("builds dry-run launch and verification commands through an injected launch builder", async () => {
    const { assignmentDir, worktreeDir, outputDir } = writeAssignmentPackage(makeTempDir());

    const summary = await runWorkerAssignment({
      assignmentDir,
      worktreeDir,
      outputDir,
      dryRun: true,
      buildLaunchCommand(input): AssignmentLaunchCommand {
        return {
          provider: input.assignment.pool,
          argv: ["fake-worker", input.prompt],
          cwd: input.worktreeDir,
        };
      },
    });

    expect(summary.status).toBe("dry_run");
    if (summary.status !== "dry_run") {
      throw new Error(`expected dry_run, got ${summary.status}`);
    }
    expect(summary.launch).toMatchObject({
      provider: "codex",
      argv: ["fake-worker", "Do the work.\n\n# Context\n"],
      cwd: worktreeDir,
    });
    expect(summary.verificationCommands).toHaveLength(1);
    expect(summary.verificationCommands[0]).toMatchObject({
      command: "node -e 'console.log(\"verify ok\")'",
      cwd: worktreeDir,
    });
  });

  it("runs launch and verification commands and writes worker result files", async () => {
    const { assignmentDir, worktreeDir, outputDir } = writeAssignmentPackage(makeTempDir());

    const summary = await runWorkerAssignment({
      assignmentDir,
      worktreeDir,
      outputDir,
      buildLaunchCommand(input): AssignmentLaunchCommand {
        return {
          provider: "codex",
          argv: ["node", "-e", `console.log(${JSON.stringify(input.prompt)})`],
          cwd: input.worktreeDir,
        };
      },
      generatedAt: () => "2026-07-05T12:00:00.000Z",
    });

    expect(summary).toMatchObject({
      status: "completed",
      provider: "codex",
      taskId: "dispatch-1:task-1",
      verificationPassed: true,
      timedOut: false,
    });
    const workerResult = JSON.parse(fs.readFileSync(path.join(outputDir, "worker-result.json"), "utf8"));
    expect(workerResult).toMatchObject({
      taskId: "dispatch-1:task-1",
      provider: "codex",
      output: "Do the work.\n\n# Context",
      generatedAt: "2026-07-05T12:00:00.000Z",
      verification: {
        allPassed: true,
      },
    });
    expect(fs.readFileSync(path.join(outputDir, "worker-output.raw.txt"), "utf8")).toContain("# Context");
  });
});
