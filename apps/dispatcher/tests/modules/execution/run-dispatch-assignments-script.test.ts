import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync, type SpawnSyncReturns } from "node:child_process";

import { afterEach, describe, expect, it } from "vitest";

const repoRoot = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "../../../../../",
);
const runDispatchAssignmentsScript = path.join(repoRoot, "scripts/run-dispatch-assignments.js");
const tempRoots: string[] = [];

function makeTempDir() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "forgeflow-run-dispatch-"));
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

describe("run-dispatch-assignments.mjs", () => {
  it("processes assigned tasks and writes an execution summary", { timeout: 30000 }, () => {
    const tempDir = makeTempDir();
    const binDir = path.join(tempDir, "bin");
    const repoDir = path.join(tempDir, "repo");
    const orchestratorDir = path.join(repoDir, ".orchestrator");
    const assignmentDir = path.join(orchestratorDir, "assignments", "task-1");

    fs.mkdirSync(binDir, { recursive: true });
    fs.mkdirSync(repoDir, { recursive: true });
    fs.writeFileSync(path.join(repoDir, "README.md"), "# repo\n");
    spawnSync("git", ["init"], { cwd: repoDir, encoding: "utf8" });
    spawnSync("git", ["config", "user.name", "ForgeFlow Test"], { cwd: repoDir, encoding: "utf8" });
    spawnSync("git", ["config", "user.email", "forgeflow@example.com"], { cwd: repoDir, encoding: "utf8" });
    spawnSync("git", ["add", "README.md"], { cwd: repoDir, encoding: "utf8" });
    spawnSync("git", ["commit", "-m", "init"], { cwd: repoDir, encoding: "utf8" });

    fs.writeFileSync(
      path.join(binDir, "codex"),
      "#!/usr/bin/env bash\necho worker completed\nprintf 'changed\\n' > src-auth.txt\n",
      { mode: 0o755 },
    );

    writeJson(path.join(orchestratorDir, "task-assignments.json"), [
      {
        taskId: "task-1",
        workerId: "codex-worker-1",
        pool: "codex",
        status: "assigned",
      },
    ]);
    writeJson(path.join(orchestratorDir, "task-ledger.json"), {
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
    writeJson(path.join(orchestratorDir, "task-events.json"), [
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
    writeJson(path.join(orchestratorDir, "worker-registry.json"), [
      {
        id: "codex-worker-1",
        pool: "codex",
        status: "busy",
        lastHeartbeatAt: "2026-03-16T00:00:00.000Z",
        currentTaskId: "task-1",
      },
    ]);
    writeJson(path.join(assignmentDir, "assignment.json"), {
      taskId: "task-1",
      workerId: "codex-worker-1",
      pool: "codex",
      status: "assigned",
      branchName: "ai/codex/task-1-auth-api",
      allowedPaths: ["src/**", "tests/**"],
      commands: {
        test: "echo test-ok",
      },
      repo: "org/repo-a",
      defaultBranch: "master",
    });
    fs.writeFileSync(path.join(assignmentDir, "worker-prompt.md"), "你是 codex-worker。\n");
    fs.writeFileSync(path.join(assignmentDir, "context.md"), "# Assignment Context\n");

    const result = spawnSync(
      "node",
      [
        runDispatchAssignmentsScript,
        "--orchestrator-dir",
        orchestratorDir,
        "--repo-dir",
        repoDir,
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

    assertSpawnSuccess(result, "run-dispatch-assignments");
    expect(result.status).toBe(0);

    const ledger = JSON.parse(fs.readFileSync(path.join(orchestratorDir, "task-ledger.json"), "utf8"));
    const workers = JSON.parse(fs.readFileSync(path.join(orchestratorDir, "worker-registry.json"), "utf8"));
    const summary = JSON.parse(fs.readFileSync(path.join(orchestratorDir, "execution-summary.json"), "utf8"));

    expect(ledger.tasks[0].status).toBe("review");
    expect(workers[0].status).toBe("idle");
    expect(summary.processedTasks).toHaveLength(1);
    expect(summary.processedTasks[0]).toMatchObject({
      taskId: "task-1",
      workerId: "codex-worker-1",
      status: "review",
    });
    expect(summary.processedTasks[0].changedFiles).toContain("src-auth.txt");
    expect(fs.existsSync(path.join(assignmentDir, "execution", "worker-result.json"))).toBe(true);
    expect(fs.existsSync(path.join(assignmentDir, "execution", "review-material.json"))).toBe(true);
  });
});
