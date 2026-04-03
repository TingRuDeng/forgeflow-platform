import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { afterEach, describe, expect, it } from "vitest";

const repoRoot = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "../../../../../",
);
const stateModulePath = path.join(repoRoot, "scripts/lib/dispatcher-state.js");
const daemonModulePath = path.join(repoRoot, "scripts/lib/worker-daemon.js");
const tempRoots: string[] = [];

function makeTempDir() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "forgeflow-worker-daemon-"));
  tempRoots.push(tempDir);
  return tempDir;
}

function runGit(args: string[], cwd: string) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if ((result.status ?? 1) !== 0) {
    throw new Error(result.stderr || result.stdout || `git ${args.join(" ")} failed`);
  }
  return (result.stdout || "").trim();
}

function createRepoWithOrigin(rootDir: string, defaultBranch = "master") {
  const repoDir = path.join(rootDir, "repo");
  const originDir = path.join(rootDir, "origin.git");

  fs.mkdirSync(repoDir, { recursive: true });
  runGit(["init", "--bare", originDir], rootDir);
  runGit(["init", "-b", defaultBranch], repoDir);
  runGit(["config", "user.name", "ForgeFlow Test"], repoDir);
  runGit(["config", "user.email", "forgeflow@example.com"], repoDir);
  fs.writeFileSync(path.join(repoDir, "README.md"), "# repo\n");
  runGit(["add", "README.md"], repoDir);
  runGit(["commit", "-m", "init"], repoDir);
  runGit(["remote", "add", "origin", originDir], repoDir);
  runGit(["push", "-u", "origin", defaultBranch], repoDir);

  return repoDir;
}

afterEach(() => {
  for (const tempDir of tempRoots.splice(0)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

describe("worker daemon cycle", () => {
  it("registers a worker, processes an assigned task, and writes execution output", async () => {
    const tempDir = makeTempDir();
    const repoDir = createRepoWithOrigin(tempDir, "master");
    const stateDir = path.join(tempDir, "state");

    const stateMod = await import(stateModulePath);
    const daemonMod = await import(daemonModulePath);
    const baseTime = Date.now();
    const iso = (offsetMs: number) => new Date(baseTime + offsetMs).toISOString();
    let state = stateMod.createEmptyRuntimeState();
    state = stateMod.registerWorker(state, {
      workerId: "codex-mac-mini",
      pool: "codex",
      hostname: "mac-mini",
      labels: ["mac"],
      repoDir,
      at: iso(0),
    });
    const dispatch = stateMod.createDispatch(state, {
      repo: "TingRuDeng/openclaw-multi-agent-mvp",
      defaultBranch: "master",
      requestedBy: "codex-control",
      tasks: [
        {
          id: "task-1",
          title: "在 docs 下新增 smoke 文档",
          pool: "codex",
          allowedPaths: ["docs/**"],
          acceptance: ["新增 smoke 文档"],
          dependsOn: [],
          branchName: "ai/codex/task-1-smoke-doc",
          verification: { mode: "run" },
        },
      ],
      packages: [
        {
          taskId: "task-1",
          assignment: {
            taskId: "task-1",
            workerId: "placeholder",
            pool: "codex",
            status: "assigned",
            branchName: "ai/codex/task-1-smoke-doc",
            allowedPaths: ["docs/**"],
            commands: {
              test: "echo ok",
            },
            repo: "TingRuDeng/openclaw-multi-agent-mvp",
            defaultBranch: "master",
          },
          workerPrompt: "你是 codex-worker。",
          contextMarkdown: "# Context",
        },
      ],
      createdAt: iso(10_000),
    });
    stateMod.saveRuntimeState(stateDir, dispatch.state);

    const client = daemonMod.createStateDirDispatcherClient(stateDir);
    const summary = await daemonMod.runWorkerDaemonCycle({
      client,
      workerId: "codex-mac-mini",
      pool: "codex",
      hostname: "mac-mini",
      repoDir,
      dryRunExecution: true,
      at: iso(15_000),
    });

    expect(summary.status).toBe("completed");
    expect(summary.taskId).toBe(dispatch.taskIds[0]);
    expect(summary.outputDir).toContain(".orchestrator/assignments");

    const reloaded = stateMod.loadRuntimeState(stateDir);
    const snapshot = stateMod.buildDashboardSnapshot(reloaded, {
      now: iso(20_000),
    });
    expect(snapshot.tasks[0]).toMatchObject({
      status: "review",
    });
    expect(snapshot.workers[0]).toMatchObject({
      status: "idle",
    });

    const materializedAssignmentDir = path.join(
      summary.worktreeDir,
      ".orchestrator",
      "assignments",
      "dispatch-1-task-1",
    );
    expect(fs.existsSync(path.join(materializedAssignmentDir, "assignment.json"))).toBe(true);
    expect(fs.existsSync(path.join(materializedAssignmentDir, "execution", "worker-result.json"))).toBe(true);
  });

  it("lets a late worker claim a ready task and complete it", async () => {
    const tempDir = makeTempDir();
    const repoDir = createRepoWithOrigin(tempDir, "master");
    const stateDir = path.join(tempDir, "state");

    const stateMod = await import(stateModulePath);
    const daemonMod = await import(daemonModulePath);
    const baseTime = Date.now();
    const iso = (offsetMs: number) => new Date(baseTime + offsetMs).toISOString();
    const dispatch = stateMod.createDispatch(stateMod.createEmptyRuntimeState(), {
      repo: "TingRuDeng/openclaw-multi-agent-mvp",
      defaultBranch: "master",
      requestedBy: "codex-control",
      tasks: [
        {
          id: "task-1",
          title: "补充多机 smoke 文档",
          pool: "codex",
          allowedPaths: ["docs/**"],
          acceptance: ["新增多机 smoke 文档"],
          dependsOn: [],
          branchName: "ai/codex/task-1-multi-machine-smoke",
          verification: { mode: "run" },
        },
      ],
      packages: [
        {
          taskId: "task-1",
          assignment: {
            taskId: "task-1",
            workerId: null,
            pool: "codex",
            status: "pending",
            branchName: "ai/codex/task-1-multi-machine-smoke",
            allowedPaths: ["docs/**"],
            commands: {
              test: "echo ok",
            },
            repo: "TingRuDeng/openclaw-multi-agent-mvp",
            defaultBranch: "master",
          },
          workerPrompt: "你是 codex-worker。",
          contextMarkdown: "# Context",
        },
      ],
      createdAt: iso(0),
    });
    stateMod.saveRuntimeState(stateDir, dispatch.state);

    const client = daemonMod.createStateDirDispatcherClient(stateDir);
    const summary = await daemonMod.runWorkerDaemonCycle({
      client,
      workerId: "codex-remote-worker",
      pool: "codex",
      hostname: "remote-host",
      repoDir,
      dryRunExecution: true,
      at: iso(5_000),
    });

    expect(summary.status).toBe("completed");
    expect(summary.taskId).toBe(dispatch.taskIds[0]);

    const snapshot = stateMod.buildDashboardSnapshot(stateMod.loadRuntimeState(stateDir), {
      now: iso(10_000),
    });
    expect(snapshot.tasks[0]).toMatchObject({
      status: "review",
      assignedWorkerId: "codex-remote-worker",
    });
    expect(snapshot.workers[0]).toMatchObject({
      id: "codex-remote-worker",
      status: "idle",
    });
  });
});
