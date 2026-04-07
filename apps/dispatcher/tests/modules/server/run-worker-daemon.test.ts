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
const originalGithubToken = process.env.GITHUB_TOKEN;
const originalFetch = globalThis.fetch;
const originalPath = process.env.PATH;
const originalSubmitResultRetryDelay = process.env.WORKER_DAEMON_SUBMIT_RESULT_RETRY_DELAY_MS;
const originalDispatcherAuthMode = process.env.DISPATCHER_AUTH_MODE;

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

function createFakeWorkerRepoRoot(rootDir: string) {
  const fakeRoot = path.join(rootDir, "fake-worker-root");
  const scriptsDir = path.join(fakeRoot, "scripts");
  fs.mkdirSync(scriptsDir, { recursive: true });
  fs.writeFileSync(
    path.join(scriptsDir, "run-worker-assignment.js"),
    [
      'const fs = require("node:fs");',
      'const path = require("node:path");',
      'function arg(name) { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : ""; }',
      'const assignmentDir = arg("--assignment-dir");',
      'const worktreeDir = arg("--worktree-dir");',
      'const outputDir = arg("--output-dir");',
      'const assignment = JSON.parse(fs.readFileSync(path.join(assignmentDir, "assignment.json"), "utf8"));',
      'fs.mkdirSync(path.join(worktreeDir, "docs"), { recursive: true });',
      'fs.writeFileSync(path.join(worktreeDir, "docs", "smoke.md"), "# smoke\\n");',
      'fs.mkdirSync(outputDir, { recursive: true });',
      'const result = {',
      '  taskId: assignment.taskId,',
      '  workerId: "",',
      '  provider: assignment.pool,',
      '  pool: assignment.pool,',
      '  branchName: assignment.branchName,',
      '  repo: assignment.repo,',
      '  defaultBranch: assignment.defaultBranch,',
      '  mode: "run",',
      '  output: "worker ok",',
      '  generatedAt: new Date().toISOString(),',
      '  verification: {',
      '    allPassed: true,',
      '    commands: [{ command: "echo ok", exitCode: 0, output: "ok" }],',
      '  },',
      '};',
      'fs.writeFileSync(path.join(outputDir, "worker-result.json"), JSON.stringify(result, null, 2));',
      'fs.writeFileSync(path.join(outputDir, "worker-verification.json"), JSON.stringify(result.verification, null, 2));',
      'fs.writeFileSync(path.join(outputDir, "worker-output.raw.txt"), "worker ok\\n");',
    ].join("\n"),
  );
  return fakeRoot;
}

function buildAssignedTaskPayload(repoDir: string, taskId: string, branchName: string) {
  return {
    assignment: {
      taskId,
      workerId: null,
      pool: "codex",
      status: "pending",
      branchName,
      allowedPaths: ["docs/**"],
      commands: {
        test: "echo ok",
      },
      repo: "TingRuDeng/openclaw-multi-agent-mvp",
      defaultBranch: "master",
    },
    task: {
      id: taskId,
      title: "worker daemon failure path",
      repo: repoDir,
    },
  };
}

function createGitPushFailureShim(rootDir: string) {
  const binDir = path.join(rootDir, "fake-bin");
  fs.mkdirSync(binDir, { recursive: true });
  const whichGit = spawnSync("which", ["git"], { encoding: "utf8" });
  const realGit = (whichGit.stdout || "").trim();
  if (!realGit) {
    throw new Error("failed to resolve git binary");
  }

  const shimPath = path.join(binDir, "git");
  fs.writeFileSync(
    shimPath,
    [
      "#!/bin/sh",
      'if [ "$1" = "push" ]; then',
      '  echo "simulated push failure" >&2',
      "  exit 1",
      "fi",
      `exec "${realGit}" "$@"`,
    ].join("\n"),
  );
  fs.chmodSync(shimPath, 0o755);
  return binDir;
}

afterEach(() => {
  for (const tempDir of tempRoots.splice(0)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
  if (originalGithubToken === undefined) {
    delete process.env.GITHUB_TOKEN;
  } else {
    process.env.GITHUB_TOKEN = originalGithubToken;
  }
  if (originalSubmitResultRetryDelay === undefined) {
    delete process.env.WORKER_DAEMON_SUBMIT_RESULT_RETRY_DELAY_MS;
  } else {
    process.env.WORKER_DAEMON_SUBMIT_RESULT_RETRY_DELAY_MS = originalSubmitResultRetryDelay;
  }
  if (originalPath === undefined) {
    delete process.env.PATH;
  } else {
    process.env.PATH = originalPath;
  }
  if (originalDispatcherAuthMode === undefined) {
    delete process.env.DISPATCHER_AUTH_MODE;
  } else {
    process.env.DISPATCHER_AUTH_MODE = originalDispatcherAuthMode;
  }
  globalThis.fetch = originalFetch;
});

describe("worker daemon cycle", () => {
  it("registers a worker, processes an assigned task, and writes execution output", async () => {
    process.env.DISPATCHER_AUTH_MODE = "open";
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
  }, 15_000);

  it("lets a late worker claim a ready task and complete it", async () => {
    process.env.DISPATCHER_AUTH_MODE = "open";
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

  it("fails the cycle instead of reporting completed when submitResult exhausts retries", async () => {
    const tempDir = makeTempDir();
    const repoDir = createRepoWithOrigin(tempDir, "master");
    const daemonMod = await import(daemonModulePath);
    process.env.WORKER_DAEMON_SUBMIT_RESULT_RETRY_DELAY_MS = "1";
    let submitAttempts = 0;
    const client = {
      registerWorker: async () => ({ ok: true }),
      heartbeat: async () => ({ ok: true }),
      getAssignedTask: async () => buildAssignedTaskPayload(repoDir, "task-submit-fail", "ai/codex/task-submit-fail"),
      startTask: async () => ({ ok: true }),
      submitResult: async () => {
        submitAttempts += 1;
        throw new Error("dispatcher unavailable");
      },
    };

    await expect(daemonMod.runWorkerDaemonCycle({
      client,
      workerId: "codex-submit-fail",
      pool: "codex",
      hostname: "host",
      repoDir,
      dryRunExecution: true,
      at: new Date().toISOString(),
    })).rejects.toThrow("submitResult failed after 3 attempts");

    expect(submitAttempts).toBe(6);
  });

  it("fails explicitly and submits a failed result when git push fails", async () => {
    const tempDir = makeTempDir();
    const repoDir = createRepoWithOrigin(tempDir, "master");
    const shimDir = createGitPushFailureShim(tempDir);
    process.env.PATH = `${shimDir}:${process.env.PATH || ""}`;

    const daemonMod = await import(daemonModulePath);
    const fakeRepoRoot = createFakeWorkerRepoRoot(tempDir);
    const submittedPayloads: Array<{ result: { output: string }; changedFiles: string[] }> = [];
    const client = {
      registerWorker: async () => ({ ok: true }),
      heartbeat: async () => ({ ok: true }),
      getAssignedTask: async () => buildAssignedTaskPayload(repoDir, "task-push-fail", "ai/codex/task-push-fail"),
      startTask: async () => ({ ok: true }),
      submitResult: async (_workerId: string, payload: { result: { output: string }; changedFiles: string[] }) => {
        submittedPayloads.push(payload);
        return { ok: true };
      },
    };

    await expect(daemonMod.runWorkerDaemonCycle({
      client,
      workerId: "codex-push-fail",
      pool: "codex",
      hostname: "host",
      repoDir,
      repoRoot: fakeRepoRoot,
      dryRunExecution: false,
      at: new Date().toISOString(),
    })).rejects.toThrow("simulated push failure");

    expect(submittedPayloads).toHaveLength(1);
    expect(submittedPayloads[0].result.output).toContain("simulated push failure");
    expect(submittedPayloads[0].changedFiles).toEqual([]);
  });

  it("fails explicitly and submits a failed result when PR creation fails", async () => {
    const tempDir = makeTempDir();
    const repoDir = createRepoWithOrigin(tempDir, "master");
    const daemonMod = await import(daemonModulePath);
    const fakeRepoRoot = createFakeWorkerRepoRoot(tempDir);
    const submittedPayloads: Array<{ result: { output: string } }> = [];

    process.env.GITHUB_TOKEN = "test-token";
    globalThis.fetch = async () => ({
      ok: false,
      text: async () => JSON.stringify({ message: "pr create failed" }),
    }) as Response;

    const client = {
      registerWorker: async () => ({ ok: true }),
      heartbeat: async () => ({ ok: true }),
      getAssignedTask: async () => buildAssignedTaskPayload(repoDir, "task-pr-fail", "ai/codex/task-pr-fail"),
      startTask: async () => ({ ok: true }),
      submitResult: async (_workerId: string, payload: { result: { output: string } }) => {
        submittedPayloads.push(payload);
        return { ok: true };
      },
    };

    await expect(daemonMod.runWorkerDaemonCycle({
      client,
      workerId: "codex-pr-fail",
      pool: "codex",
      hostname: "host",
      repoDir,
      repoRoot: fakeRepoRoot,
      dryRunExecution: false,
      at: new Date().toISOString(),
    })).rejects.toThrow("pr create failed");

    expect(submittedPayloads).toHaveLength(1);
    expect(submittedPayloads[0].result.output).toContain("pr create failed");
  });
});
