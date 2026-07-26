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
import { resolveExecutionProfile } from "../src/runtime/execution-profile.js";

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

function writeFakeContainerRuntime(root: string, logPath: string): string {
  const runtimePath = path.join(root, "fake-container-runtime.mjs");
  fs.writeFileSync(runtimePath, `#!/usr/bin/env node
import fs from "node:fs";
import { spawnSync } from "node:child_process";
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(logPath)}, JSON.stringify(args) + "\\n");
if (args[0] === "version" || (args[0] === "image" && args[1] === "inspect")) {
  process.exit(0);
}
if (args[0] !== "run") {
  process.exit(2);
}
const imageIndex = args.indexOf("forgeflow-worker:test");
if (imageIndex < 0 || !args[imageIndex + 1]) {
  process.exit(3);
}
const result = spawnSync(args[imageIndex + 1], args.slice(imageIndex + 2), {
  cwd: process.cwd(),
  env: process.env,
  stdio: "inherit",
});
process.exit(result.status ?? 1);
`);
  fs.chmodSync(runtimePath, 0o755);
  return runtimePath;
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

  it("wraps provider and verification commands with one isolated execution profile", async () => {
    const { assignmentDir, worktreeDir, outputDir } = writeAssignmentPackage(makeTempDir());
    const executionEnv = {
      FORGEFLOW_EXECUTION_PROFILE: "isolated-container",
      FORGEFLOW_EXECUTION_CONTAINER_IMAGE: "forgeflow-worker:test",
      OPENAI_API_KEY: "provider-secret",
      GEMINI_API_KEY: "other-provider-secret",
    };

    const summary = await runWorkerAssignment({
      assignmentDir,
      worktreeDir,
      outputDir,
      dryRun: true,
      executionEnv,
      executionProfile: resolveExecutionProfile(executionEnv),
      buildLaunchCommand(input): AssignmentLaunchCommand {
        return {
          provider: "codex",
          argv: ["codex", "exec", input.prompt],
          cwd: input.worktreeDir,
        };
      },
    });

    expect(summary.status).toBe("dry_run");
    if (summary.status !== "dry_run") {
      throw new Error(`expected dry_run, got ${summary.status}`);
    }
    expect(summary.executionProfile).toBe("isolated-container");
    expect(summary.launch.argv.slice(0, 4)).toEqual(["docker", "run", "--rm", "--init"]);
    expect(summary.launch.argv).toContain("OPENAI_API_KEY");
    expect(summary.launch.argv).not.toContain("GEMINI_API_KEY");
    expect(summary.launch.argv).not.toContain("provider-secret");
    expect(summary.verificationCommands).toHaveLength(1);
    expect(summary.verificationCommands[0]).toMatchObject({
      command: "node -e 'console.log(\"verify ok\")'",
      executionProfile: "isolated-container",
    });
    expect(summary.verificationCommands[0].argv.slice(0, 4)).toEqual([
      "docker",
      "run",
      "--rm",
      "--init",
    ]);
    expect(summary.verificationCommands[0].argv).not.toContain("OPENAI_API_KEY");
  });

  it("rejects an explicit profile that weakens the operator environment", async () => {
    const { assignmentDir, worktreeDir, outputDir } = writeAssignmentPackage(makeTempDir());
    const executionEnv = {
      FORGEFLOW_EXECUTION_PROFILE: "isolated-container",
      FORGEFLOW_EXECUTION_CONTAINER_IMAGE: "forgeflow-worker:test",
    };

    await expect(runWorkerAssignment({
      assignmentDir,
      worktreeDir,
      outputDir,
      dryRun: true,
      executionEnv,
      executionProfile: { name: "trusted-host" },
      buildLaunchCommand(input): AssignmentLaunchCommand {
        return {
          provider: "codex",
          argv: ["codex", "exec", input.prompt],
          cwd: input.worktreeDir,
        };
      },
    })).rejects.toThrow("does not match the operator-owned worker environment");
  });

  it("keeps the other provider key and all provider keys out of trusted-host child commands", async () => {
    const root = makeTempDir();
    const { assignmentDir, worktreeDir, outputDir } = writeAssignmentPackage(root);
    fs.writeFileSync(path.join(assignmentDir, "assignment.json"), JSON.stringify({
      taskId: "dispatch-1:task-secrets",
      workerId: "codex-worker",
      pool: "codex",
      branchName: "ai/codex/task-secrets",
      repo: "owner/repo",
      defaultBranch: "main",
      commands: {
        test: `${JSON.stringify(process.execPath)} -e 'console.log(JSON.stringify({openai: process.env.OPENAI_API_KEY, gemini: process.env.GEMINI_API_KEY}))'`,
      },
    }));

    await runWorkerAssignment({
      assignmentDir,
      worktreeDir,
      outputDir,
      executionEnv: {
        ...process.env,
        OPENAI_API_KEY: "openai-secret",
        GEMINI_API_KEY: "gemini-secret",
      },
      buildLaunchCommand(input): AssignmentLaunchCommand {
        return {
          provider: "codex",
          argv: [
            process.execPath,
            "-e",
            "console.log(JSON.stringify({openai: process.env.OPENAI_API_KEY, gemini: process.env.GEMINI_API_KEY}))",
          ],
          cwd: input.worktreeDir,
        };
      },
    });

    const workerResult = JSON.parse(
      fs.readFileSync(path.join(outputDir, "worker-result.json"), "utf8"),
    );
    expect(workerResult.artifactBundle.retainedContent.logs).toContain(
      '{"openai":"openai-secret"}',
    );
    expect(workerResult.artifactBundle.retainedContent.logs).not.toContain("gemini-secret");
    expect(workerResult.artifactBundle.retainedContent.testResults).toContain("{}");
    expect(workerResult.artifactBundle.retainedContent.testResults).not.toContain(
      "openai-secret",
    );
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

  it("runs provider and verification through a ready isolated container adapter", async () => {
    const root = makeTempDir();
    const { assignmentDir, worktreeDir, outputDir } = writeAssignmentPackage(root);
    const runtimeLog = path.join(root, "container-runtime.jsonl");
    const runtime = writeFakeContainerRuntime(root, runtimeLog);
    const executionEnv = {
      ...process.env,
      FORGEFLOW_EXECUTION_PROFILE: "isolated-container",
      FORGEFLOW_EXECUTION_CONTAINER_RUNTIME: runtime,
      FORGEFLOW_EXECUTION_CONTAINER_IMAGE: "forgeflow-worker:test",
    };

    const summary = await runWorkerAssignment({
      assignmentDir,
      worktreeDir,
      outputDir,
      executionEnv,
      buildLaunchCommand(input): AssignmentLaunchCommand {
        return {
          provider: "codex",
          argv: ["node", "-e", `console.log(${JSON.stringify(input.prompt)})`],
          cwd: input.worktreeDir,
        };
      },
    });

    expect(summary).toMatchObject({
      status: "completed",
      executionProfile: "isolated-container",
      verificationPassed: true,
    });
    const runtimeCalls = fs.readFileSync(runtimeLog, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as string[]);
    expect(runtimeCalls.slice(0, 2)).toEqual([
      ["version", "--format", "{{.Server.Version}}"],
      ["image", "inspect", "forgeflow-worker:test"],
    ]);
    expect(runtimeCalls.filter((args) => args[0] === "run")).toHaveLength(2);
    const workerResult = JSON.parse(fs.readFileSync(path.join(outputDir, "worker-result.json"), "utf8"));
    expect(workerResult.artifactBundle.trajectory.steps[0].observation).toContain(
      "profile=isolated-container",
    );
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

    expect(buildCodexLaunchCommand({
      assignment: {
        taskId: "task-isolated",
        branchName: "ai/codex/task-isolated",
        defaultBranch: "main",
        pool: "codex",
        repo: "owner/repo",
      },
      prompt: "Run inside the image.",
      worktreeDir: "/tmp/isolated-worktree",
    }, {
      env: {
        FORGEFLOW_EXECUTION_PROFILE: "isolated-container",
        FORGEFLOW_CODEX_BIN: "/opt/forgeflow/bin/codex",
      },
    })).toMatchObject({
      provider: "codex",
      argv: ["/opt/forgeflow/bin/codex", "exec", "--sandbox", "workspace-write", "Run inside the image."],
    });
  });
});
