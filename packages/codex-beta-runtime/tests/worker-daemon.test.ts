import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createDispatcherClient,
  runWorkerDaemonCycle,
  type DispatcherClient,
} from "../src/runtime/worker-daemon.js";

const tempRoots: string[] = [];
const originalEnv = {
  CUSTOM_SECRET: process.env.CUSTOM_SECRET,
  DISPATCHER_API_TOKEN: process.env.DISPATCHER_API_TOKEN,
  GITHUB_TOKEN: process.env.GITHUB_TOKEN,
};

function makeTempDir(): string {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-runtime-daemon-"));
  tempRoots.push(tempDir);
  return tempDir;
}

function runGit(args: string[], cwd: string): string {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if ((result.status ?? 1) !== 0) {
    throw new Error(result.stderr || result.stdout || `git ${args.join(" ")} failed`);
  }
  return (result.stdout || "").trim();
}

function createRepoWithOrigin(rootDir: string): string {
  const repoDir = path.join(rootDir, "repo");
  const originDir = path.join(rootDir, "origin.git");
  fs.mkdirSync(repoDir, { recursive: true });
  runGit(["init", "--bare", originDir], rootDir);
  runGit(["init", "-b", "master"], repoDir);
  runGit(["config", "user.name", "ForgeFlow Test"], repoDir);
  runGit(["config", "user.email", "forgeflow@example.com"], repoDir);
  fs.writeFileSync(path.join(repoDir, "README.md"), "# repo\n");
  runGit(["add", "README.md"], repoDir);
  runGit(["commit", "-m", "init"], repoDir);
  runGit(["remote", "add", "origin", originDir], repoDir);
  runGit(["push", "-u", "origin", "master"], repoDir);
  return repoDir;
}

function createFakePackageRoot(rootDir: string, options: { breakPush?: boolean; captureEnv?: boolean } = {}): string {
  const packageRoot = path.join(rootDir, "fake-package");
  const runtimeDir = path.join(packageRoot, "dist", "runtime");
  fs.mkdirSync(runtimeDir, { recursive: true });
  fs.writeFileSync(
    path.join(runtimeDir, "run-worker-assignment.js"),
    [
      'const childProcess = require("node:child_process");',
      'const fs = require("node:fs");',
      'const path = require("node:path");',
      'function arg(name) { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : ""; }',
      'const assignmentDir = arg("--assignment-dir");',
      'const worktreeDir = arg("--worktree-dir");',
      'const outputDir = arg("--output-dir");',
      'const assignment = JSON.parse(fs.readFileSync(path.join(assignmentDir, "assignment.json"), "utf8"));',
      options.breakPush
        ? 'childProcess.spawnSync("git", ["remote", "set-url", "origin", path.join(worktreeDir, "__missing_origin__.git")], { cwd: worktreeDir });'
        : "",
      'fs.mkdirSync(path.join(worktreeDir, "docs"), { recursive: true });',
      'fs.writeFileSync(path.join(worktreeDir, "docs", "smoke.md"), "# smoke\\n");',
      'fs.mkdirSync(outputDir, { recursive: true });',
      options.captureEnv
        ? 'fs.writeFileSync(path.join(outputDir, "captured-env.json"), JSON.stringify({ GITHUB_TOKEN: process.env.GITHUB_TOKEN ?? null, DISPATCHER_API_TOKEN: process.env.DISPATCHER_API_TOKEN ?? null, CUSTOM_SECRET: process.env.CUSTOM_SECRET ?? null, PATH: process.env.PATH ?? null, HOME: process.env.HOME ?? null }, null, 2));'
        : "",
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
      '  verification: { allPassed: true, commands: [{ command: "echo ok", exitCode: 0, output: "ok" }] },',
      '};',
      'fs.writeFileSync(path.join(outputDir, "worker-result.json"), JSON.stringify(result, null, 2));',
    ].join("\n"),
  );
  return packageRoot;
}

function buildPayload(taskId: string, branchName: string) {
  return {
    assignment: {
      taskId,
      branchName,
      defaultBranch: "master",
      pool: "codex",
      repo: "TingRuDeng/forgeflow-platform",
    },
    task: {
      id: taskId,
      title: "runtime delivery check",
      repo: "TingRuDeng/forgeflow-platform",
    },
  };
}

function createClient(payload: ReturnType<typeof buildPayload>): DispatcherClient {
  return {
    registerWorker: vi.fn().mockResolvedValue({ status: "registered" }),
    heartbeat: vi.fn().mockResolvedValue({ status: "heartbeat" }),
    getAssignedTask: vi.fn().mockResolvedValue(null),
    claimTask: vi.fn().mockResolvedValue(payload),
    startTask: vi.fn().mockResolvedValue({ status: "started" }),
    submitResult: vi.fn().mockResolvedValue({ status: "stored" }),
  } as unknown as DispatcherClient;
}

describe("codex worker daemon dispatcher protocol", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    for (const tempDir of tempRoots.splice(0)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  it("claims work through the v1 claim endpoint instead of the old assigned-task read", async () => {
    const client = {
      registerWorker: vi.fn().mockResolvedValue({ status: "registered" }),
      heartbeat: vi.fn().mockResolvedValue({ status: "heartbeat" }),
      getAssignedTask: vi.fn().mockRejectedValue(new Error("旧 assigned-task 路径不应参与 claim")),
      claimTask: vi.fn().mockResolvedValue(null),
      startTask: vi.fn(),
      submitResult: vi.fn(),
    } as unknown as DispatcherClient;

    const result = await runWorkerDaemonCycle({
      client,
      workerId: "codex-worker-1",
      pool: "codex",
      repoDir: "/tmp/project",
      at: "2026-07-03T00:00:00.000Z",
    });

    expect(result).toEqual({ status: "idle", workerId: "codex-worker-1" });
    expect(client.claimTask).toHaveBeenCalledWith("codex-worker-1", {
      at: "2026-07-03T00:00:00.000Z",
    });
    expect(client.getAssignedTask).not.toHaveBeenCalled();
  });

  it("sends dispatcher bearer token when DISPATCHER_API_TOKEN is set", async () => {
    process.env.DISPATCHER_API_TOKEN = "dispatcher-token";
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const client = createDispatcherClient("http://127.0.0.1:8787");
    await client.registerWorker({
      workerId: "codex-worker-1",
      pool: "codex",
      hostname: "host",
      labels: [],
      repoDir: "/tmp/project",
      at: "2026-07-03T00:00:00.000Z",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:8787/api/workers/register",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer dispatcher-token",
        }),
      }),
    );
  });

  it("fails the task when changed files cannot be pushed", async () => {
    const tempDir = makeTempDir();
    const repoDir = createRepoWithOrigin(tempDir);
    const packageRoot = createFakePackageRoot(tempDir, { breakPush: true });
    const client = createClient(buildPayload("task-push-failure", "ai/codex/task-push-failure"));

    await expect(runWorkerDaemonCycle({
      client,
      workerId: "codex-worker-1",
      pool: "codex",
      repoDir,
      packageRoot,
      at: "2026-07-03T00:00:00.000Z",
    })).rejects.toThrow(/push|origin/i);

    expect(client.submitResult).toHaveBeenCalledWith(
      "codex-worker-1",
      expect.objectContaining({
        result: expect.objectContaining({
          verification: expect.objectContaining({ allPassed: false }),
        }),
      }),
    );
  });

  it("fails the task when pull request creation is rejected", async () => {
    process.env.GITHUB_TOKEN = "github-token";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ message: "validation failed" }),
      { status: 422 },
    )));
    const tempDir = makeTempDir();
    const repoDir = createRepoWithOrigin(tempDir);
    const packageRoot = createFakePackageRoot(tempDir);
    const client = createClient(buildPayload("task-pr-failure", "ai/codex/task-pr-failure"));

    await expect(runWorkerDaemonCycle({
      client,
      workerId: "codex-worker-1",
      pool: "codex",
      repoDir,
      packageRoot,
      at: "2026-07-03T00:00:00.000Z",
    })).rejects.toThrow("validation failed");

    expect(client.submitResult).toHaveBeenCalledWith(
      "codex-worker-1",
      expect.objectContaining({
        result: expect.objectContaining({
          verification: expect.objectContaining({ allPassed: false }),
        }),
      }),
    );
  });

  it("keeps dispatcher and GitHub tokens out of the assignment process", async () => {
    process.env.CUSTOM_SECRET = "custom-secret";
    process.env.DISPATCHER_API_TOKEN = "dispatcher-token";
    process.env.GITHUB_TOKEN = "github-token";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ number: 1, html_url: "https://example.test/pr/1" }),
      { status: 201 },
    )));
    const tempDir = makeTempDir();
    const repoDir = createRepoWithOrigin(tempDir);
    const packageRoot = createFakePackageRoot(tempDir, { captureEnv: true });
    const client = createClient(buildPayload("task-env", "ai/codex/task-env"));

    const summary = await runWorkerDaemonCycle({
      client,
      workerId: "codex-worker-1",
      pool: "codex",
      repoDir,
      packageRoot,
      at: "2026-07-03T00:00:00.000Z",
    });

    expect(summary.status).toBe("completed");
    const outputDir = "outputDir" in summary ? summary.outputDir : "";
    const capturedEnv = JSON.parse(fs.readFileSync(path.join(outputDir, "captured-env.json"), "utf8")) as {
      CUSTOM_SECRET: string | null;
      DISPATCHER_API_TOKEN: string | null;
      GITHUB_TOKEN: string | null;
      HOME: string | null;
      PATH: string | null;
    };
    expect(capturedEnv.CUSTOM_SECRET).toBeNull();
    expect(capturedEnv.DISPATCHER_API_TOKEN).toBeNull();
    expect(capturedEnv.GITHUB_TOKEN).toBeNull();
    expect(capturedEnv.HOME).toBeTruthy();
    expect(capturedEnv.PATH).toBeTruthy();
  });
});
