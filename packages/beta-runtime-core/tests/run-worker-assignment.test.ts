import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  buildCodexLaunchCommand,
  buildDispatcherRuntimeLaunchCommand,
  buildGeminiLaunchCommand,
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
      argv: [
        expect.any(String),
        "-c",
        expect.stringContaining("process.versions.node"),
      ],
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
      artifactBundle: {
        schemaVersion: "artifact-bundle/v1",
        trajectory: {
          schemaVersion: "artifact-trajectory/v1",
          steps: [
            expect.objectContaining({
              sequence: 1,
              phase: "preflight",
              status: "succeeded",
              action: expect.stringContaining("prepared assignment"),
            }),
            expect.objectContaining({
              sequence: 2,
              phase: "action",
              status: "succeeded",
              command: expect.stringContaining("node -e"),
            }),
            expect.objectContaining({
              sequence: 3,
              phase: "verification",
              status: "succeeded",
              action: "node -e 'console.log(\"verify ok\")'",
              observation: "verify ok",
              exitCode: 0,
            }),
            expect.objectContaining({
              sequence: 4,
              phase: "result",
              status: "succeeded",
              action: expect.stringContaining("worker result"),
            }),
          ],
        },
        retainedContent: {
          logs: expect.stringContaining("# Context"),
          testResults: expect.stringContaining("verify ok"),
        },
        testResults: [
          expect.objectContaining({
            name: "node -e 'console.log(\"verify ok\")'",
            status: "passed",
          }),
        ],
      },
      verification: {
        allPassed: true,
      },
    });
    expect(fs.readFileSync(path.join(outputDir, "worker-output.raw.txt"), "utf8")).toContain("# Context");
  });

  it("marks the trajectory action step failed when the launch command exits non-zero", async () => {
    const { assignmentDir, worktreeDir, outputDir } = writeAssignmentPackage(makeTempDir());

    await runWorkerAssignment({
      assignmentDir,
      worktreeDir,
      outputDir,
      buildLaunchCommand(): AssignmentLaunchCommand {
        return {
          provider: "codex",
          argv: ["node", "-e", "console.error('launch failed'); process.exit(2)"],
          cwd: worktreeDir,
        };
      },
      generatedAt: () => "2026-07-05T12:00:00.000Z",
    });

    const workerResult = JSON.parse(fs.readFileSync(path.join(outputDir, "worker-result.json"), "utf8"));
    expect(workerResult.artifactBundle.trajectory.steps[1]).toMatchObject({
      phase: "action",
      status: "failed",
      exitCode: 2,
      observation: "launch failed",
    });
    expect(workerResult.artifactBundle.trajectory.steps.at(-1)).toMatchObject({
      phase: "result",
      status: "failed",
    });
  });

  it("terminates the launch process tree on timeout and skips verification", async () => {
    const { assignmentDir, worktreeDir, outputDir } = writeAssignmentPackage(makeTempDir());
    const grandchildMarker = path.join(worktreeDir, "grandchild-finished");
    const verificationMarker = path.join(worktreeDir, "verification-ran");
    fs.writeFileSync(path.join(assignmentDir, "assignment.json"), JSON.stringify({
      taskId: "dispatch-1:task-1",
      workerId: "codex-worker",
      pool: "codex",
      branchName: "ai/codex/task-1",
      repo: "owner/repo",
      defaultBranch: "main",
      commands: {
        test: `node -e "require('fs').writeFileSync(${JSON.stringify(verificationMarker)}, 'ran')"`,
      },
    }));
    const grandchildCode = `setTimeout(() => require("fs").writeFileSync(${JSON.stringify(grandchildMarker)}, "done"), 200)`;
    const parentCode = [
      'const { spawn } = require("node:child_process");',
      `spawn(process.execPath, ["-e", ${JSON.stringify(grandchildCode)}], { stdio: "ignore" });`,
      "setInterval(() => {}, 1000);",
    ].join("");

    const summary = await runWorkerAssignment({
      assignmentDir,
      worktreeDir,
      outputDir,
      execTimeoutMs: 30,
      buildLaunchCommand(): AssignmentLaunchCommand {
        return {
          provider: "codex",
          argv: ["node", "-e", parentCode],
          cwd: worktreeDir,
        };
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(summary).toMatchObject({
      status: "failed",
      timedOut: true,
      verificationPassed: false,
    });
    expect(fs.existsSync(grandchildMarker)).toBe(false);
    expect(fs.existsSync(verificationMarker)).toBe(false);
    const workerResult = JSON.parse(fs.readFileSync(path.join(outputDir, "worker-result.json"), "utf8"));
    expect(workerResult.verification).toEqual({
      allPassed: false,
      commands: [],
    });
  });

  it("builds codex and gemini launch commands through shared runtime factories", async () => {
    const root = makeTempDir();
    const { assignmentDir, worktreeDir, outputDir } = writeAssignmentPackage(root);
    const codexLaunches: unknown[] = [];
    const geminiLaunches: unknown[] = [];

    const codexSummary = await runWorkerAssignment({
      assignmentDir,
      worktreeDir,
      outputDir,
      dryRun: true,
      buildLaunchCommand: (input) => buildDispatcherRuntimeLaunchCommand(input, {
        codexModel: "gpt-5.4-codex",
        geminiModel: "gemini-2.5-pro",
        createCodexRuntime(role, options) {
          return {
            launchTask(launchInput) {
              codexLaunches.push({ role, options, launchInput });
              return { argv: ["codex", "exec", "-m", options?.model || "", launchInput.prompt] };
            },
          };
        },
        createGeminiRuntime(options) {
          return {
            launchTask(launchInput) {
              geminiLaunches.push({ options, launchInput });
              return { argv: ["gemini", "-m", options?.model || "", "-p", launchInput.prompt] };
            },
          };
        },
      }),
    });

    expect(codexSummary.status).toBe("dry_run");
    if (codexSummary.status !== "dry_run") {
      throw new Error(`expected dry_run, got ${codexSummary.status}`);
    }
    expect(codexSummary.launch).toMatchObject({
      provider: "codex",
      cwd: worktreeDir,
      argv: ["codex", "exec", "-m", "gpt-5.4-codex", "Do the work.\n\n# Context\n"],
    });
    expect(codexLaunches).toHaveLength(1);
    expect(geminiLaunches).toHaveLength(0);

    fs.writeFileSync(path.join(assignmentDir, "assignment.json"), JSON.stringify({
      taskId: "dispatch-1:task-1",
      workerId: "gemini-worker",
      pool: "gemini",
      branchName: "ai/gemini/task-1",
      repo: "owner/repo",
      defaultBranch: "main",
      commands: {},
    }));

    const geminiSummary = await runWorkerAssignment({
      assignmentDir,
      worktreeDir,
      outputDir,
      dryRun: true,
      buildLaunchCommand: (input) => buildDispatcherRuntimeLaunchCommand(input, {
        codexModel: "",
        geminiModel: "gemini-2.5-pro",
        createCodexRuntime() {
          throw new Error("codex runtime should not be used for gemini");
        },
        createGeminiRuntime(options) {
          return {
            launchTask(launchInput) {
              geminiLaunches.push({ options, launchInput });
              return { argv: ["gemini", "-m", options?.model || "", "-p", launchInput.prompt] };
            },
          };
        },
      }),
    });

    expect(geminiSummary.status).toBe("dry_run");
    if (geminiSummary.status !== "dry_run") {
      throw new Error(`expected dry_run, got ${geminiSummary.status}`);
    }
    expect(geminiSummary.launch).toMatchObject({
      provider: "gemini",
      cwd: worktreeDir,
      argv: ["gemini", "-m", "gemini-2.5-pro", "-p", "Do the work.\n\n# Context\n"],
    });
    expect(geminiLaunches).toHaveLength(1);
  });

  it("builds packaged codex and gemini launch commands from the shared core", () => {
    const codexCommand = buildCodexLaunchCommand({
      assignment: {
        taskId: "task-1",
        branchName: "ai/codex/task-1",
        defaultBranch: "main",
        pool: "codex",
        repo: "owner/repo",
      },
      prompt: "Do the work.",
      worktreeDir: "/tmp/codex-worktree",
    }, {
      env: {
        FORGEFLOW_CODEX_BIN: "node",
        FORGEFLOW_CODEX_MODEL: "gpt-5.4-codex",
        FORGEFLOW_CODEX_SANDBOX: "read-only",
        FORGEFLOW_CODEX_ARGS_JSON: "[\"--full-auto\"]",
      },
    });
    const geminiCommand = buildGeminiLaunchCommand({
      assignment: {
        taskId: "task-2",
        branchName: "ai/gemini/task-2",
        defaultBranch: "main",
        pool: "gemini",
        repo: "owner/repo",
      },
      prompt: "Do the Gemini work.",
      worktreeDir: "/tmp/gemini-worktree",
    }, {
      env: {
        FORGEFLOW_GEMINI_BIN: "node",
        FORGEFLOW_GEMINI_MODEL: "gemini-test",
        FORGEFLOW_GEMINI_ARGS: "--approval-mode auto",
      },
    });

    expect(codexCommand).toEqual({
      provider: "codex",
      argv: ["node", "exec", "-m", "gpt-5.4-codex", "--sandbox", "read-only", "--full-auto", "Do the work."],
      cwd: "/tmp/codex-worktree",
    });
    expect(geminiCommand).toEqual({
      provider: "gemini",
      argv: ["node", "-m", "gemini-test", "--approval-mode", "auto", "-p", "Do the Gemini work."],
      cwd: "/tmp/gemini-worktree",
    });
  });
});
