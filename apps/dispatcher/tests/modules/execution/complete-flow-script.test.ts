import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync, type SpawnSyncReturns } from "node:child_process";

import { afterEach, describe, expect, it } from "vitest";

const repoRoot = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "../../../../../",
);
const runWorkerAssignmentScript = path.join(repoRoot, "scripts/run-worker-assignment.js");
const processWorkerResultScript = path.join(repoRoot, "scripts/process-worker-result.js");
const tempRoots: string[] = [];

function makeTempDir() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "forgeflow-complete-flow-"));
  tempRoots.push(tempDir);
  return tempDir;
}

function writeJson(filePath: string, value: unknown) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function assertSpawnSuccess(result: SpawnSyncReturns<string>, label: string) {
  if (result.status === 0) {
    return;
  }

  const stdout = result.stdout?.trim() || "<empty>";
  const stderr = result.stderr?.trim() || "<empty>";
  throw new Error(`${label} failed with status ${result.status}\nstdout:\n${stdout}\nstderr:\n${stderr}`);
}

afterEach(() => {
  for (const tempDir of tempRoots.splice(0)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

describe("complete worker flow scripts", () => {
  it("runs assignment execution and processes the worker result into review", { timeout: 30000 }, () => {
    const tempDir = makeTempDir();
    const binDir = path.join(tempDir, "bin");
    const assignmentDir = path.join(tempDir, ".orchestrator/assignments/task-1");
    const worktreeDir = path.join(tempDir, "worktree");
    const outputDir = path.join(tempDir, "worker-output");
    const taskLedgerFile = path.join(tempDir, "task-ledger.json");
    const taskEventsFile = path.join(tempDir, "task-events.json");
    const workerRegistryFile = path.join(tempDir, "worker-registry.json");
    const reviewMaterialFile = path.join(tempDir, "review-material.json");

    fs.mkdirSync(binDir, { recursive: true });
    fs.mkdirSync(worktreeDir, { recursive: true });
    fs.writeFileSync(
      path.join(binDir, "codex"),
      "#!/usr/bin/env bash\necho worker completed\n",
      { mode: 0o755 },
    );

    writeJson(path.join(assignmentDir, "assignment.json"), {
      taskId: "task-1",
      workerId: "codex-worker-1",
      pool: "codex",
      status: "assigned",
      branchName: "ai/codex/task-1-auth-api",
      allowedPaths: ["src/**", "tests/**"],
      commands: {
        test: "echo test-ok",
        typecheck: "echo typecheck-ok",
      },
      repo: "org/repo-a",
      defaultBranch: "master",
    });
    fs.writeFileSync(path.join(assignmentDir, "worker-prompt.md"), "你是 codex-worker。\n");
    fs.writeFileSync(path.join(assignmentDir, "context.md"), "# Assignment Context\n");

    writeJson(taskLedgerFile, {
      requestSummary: "实现登录接口",
      taskType: "feature",
      repo: "org/repo-a",
      defaultBranch: "master",
      generatedAt: "2026-03-16T00:00:00.000Z",
      tasks: [
        {
          id: "task-1",
          title: "Implement auth API",
          pool: "codex",
          allowedPaths: ["src/**", "tests/**"],
          branchName: "ai/codex/task-1-auth-api",
          verification: {
            mode: "run",
          },
          status: "assigned",
          attempts: 1,
          assignedWorkerId: "codex-worker-1",
        },
      ],
    });
    writeJson(taskEventsFile, [
      {
        taskId: "task-1",
        type: "created",
        at: "2026-03-16T00:00:00.000Z",
        payload: {
          status: "planned",
        },
      },
      {
        taskId: "task-1",
        type: "status_changed",
        at: "2026-03-16T00:00:00.000Z",
        payload: {
          from: "planned",
          to: "ready",
        },
      },
      {
        taskId: "task-1",
        type: "status_changed",
        at: "2026-03-16T00:00:00.000Z",
        payload: {
          from: "ready",
          to: "assigned",
        },
      },
    ]);
    writeJson(workerRegistryFile, [
      {
        id: "codex-worker-1",
        pool: "codex",
        status: "busy",
        lastHeartbeatAt: "2026-03-16T00:00:00.000Z",
        currentTaskId: "task-1",
      },
    ]);

    const runResult = spawnSync(
      "node",
      [
        runWorkerAssignmentScript,
        "--assignment-dir",
        assignmentDir,
        "--worktree-dir",
        worktreeDir,
        "--output-dir",
        outputDir,
      ],
      {
        cwd: repoRoot,
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: `${binDir}:${process.env.PATH ?? ""}`,
        },
      },
    );

    assertSpawnSuccess(runResult, "run-worker-assignment");
    expect(runResult.status).toBe(0);
    expect(fs.existsSync(path.join(outputDir, "worker-result.json"))).toBe(true);

    const processResult = spawnSync(
      "node",
      [
        processWorkerResultScript,
        "--task-ledger-file",
        taskLedgerFile,
        "--task-events-file",
        taskEventsFile,
        "--worker-registry-file",
        workerRegistryFile,
        "--worker-result-file",
        path.join(outputDir, "worker-result.json"),
        "--review-material-file",
        reviewMaterialFile,
        "--changed-files",
        "src/auth.ts,tests/auth.test.ts",
      ],
      {
        cwd: repoRoot,
        encoding: "utf8",
      },
    );

    assertSpawnSuccess(processResult, "process-worker-result");
    expect(processResult.status).toBe(0);

    const updatedLedger = JSON.parse(fs.readFileSync(taskLedgerFile, "utf8"));
    const updatedEvents = JSON.parse(fs.readFileSync(taskEventsFile, "utf8"));
    const updatedWorkers = JSON.parse(fs.readFileSync(workerRegistryFile, "utf8"));
    const reviewMaterial = JSON.parse(fs.readFileSync(reviewMaterialFile, "utf8"));

    expect(updatedLedger.tasks[0].status).toBe("review");
    expect(updatedWorkers[0]).toEqual({
      id: "codex-worker-1",
      pool: "codex",
      status: "idle",
      lastHeartbeatAt: expect.any(String),
    });
    expect(updatedEvents.map((event: { payload: { from: string; to: string } }) => event.payload)).toContainEqual({
      from: "assigned",
      to: "in_progress",
    });
    expect(updatedEvents.map((event: { payload: { from: string; to: string } }) => event.payload)).toContainEqual({
      from: "in_progress",
      to: "review",
    });
    expect(reviewMaterial).toEqual({
      repo: "org/repo-a",
      title: "Implement auth API",
      changedFiles: ["src/auth.ts", "tests/auth.test.ts"],
      selfTestPassed: true,
      checks: ["echo test-ok", "echo typecheck-ok"],
    });
  });
});
