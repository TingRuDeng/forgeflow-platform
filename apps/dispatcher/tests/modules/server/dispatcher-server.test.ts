import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";

import { afterEach, describe, expect, it } from "vitest";

const repoRoot = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "../../../../../",
);
const serverModulePath = path.join(repoRoot, "scripts/lib/dispatcher-server.js");
const tempRoots: string[] = [];

function makeTempDir() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "forgeflow-dispatcher-server-"));
  tempRoots.push(tempDir);
  return tempDir;
}

afterEach(() => {
  for (const tempDir of tempRoots.splice(0)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

describe("dispatcher server", () => {
  it("serves worker, dispatch, result, review, and dashboard endpoints", async () => {
    const stateDir = makeTempDir();
    const mod = await import(serverModulePath);
    const registerResponse = await mod.handleDispatcherHttpRequest({
      stateDir,
      method: "POST",
      pathname: "/api/workers/register",
      body: {
        workerId: "codex-mac-mini",
        pool: "codex",
        hostname: "mac-mini",
        labels: ["mac"],
        repoDir: "/repos/openclaw",
      },
    });
    expect(registerResponse.status).toBe(200);

    const heartbeatResponse = await mod.handleDispatcherHttpRequest({
      stateDir,
      method: "POST",
      pathname: "/api/workers/codex-mac-mini/heartbeat",
      body: {},
    });
    expect(heartbeatResponse.status).toBe(200);

    const dispatchResponse = await mod.handleDispatcherHttpRequest({
      stateDir,
      method: "POST",
      pathname: "/api/dispatches",
      body: {
        repo: "TingRuDeng/openclaw-multi-agent-mvp",
        defaultBranch: "master",
        requestedBy: "codex-control",
        tasks: [
          {
            id: "task-1",
            title: "实现后端鉴权 API",
            pool: "codex",
            allowedPaths: ["src/**", "tests/**"],
            acceptance: ["返回 token"],
            dependsOn: [],
            branchName: "ai/codex/task-1-auth-api",
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
              branchName: "ai/codex/task-1-auth-api",
              allowedPaths: ["src/**", "tests/**"],
              commands: {
                test: "pnpm test",
              },
              repo: "TingRuDeng/openclaw-multi-agent-mvp",
              defaultBranch: "master",
            },
            workerPrompt: "你是 codex-worker。",
            contextMarkdown: "# Context",
          },
        ],
      },
    });
    expect(dispatchResponse.status).toBe(200);
    const dispatchBody = dispatchResponse.json;
    expect(dispatchBody.assignments[0]).toMatchObject({
      workerId: "codex-mac-mini",
      status: "assigned",
    });

    const assignedTaskResponse = await mod.handleDispatcherHttpRequest({
      stateDir,
      method: "GET",
      pathname: "/api/workers/codex-mac-mini/assigned-task",
    });
    expect(assignedTaskResponse.status).toBe(200);
    const assignedTaskBody = assignedTaskResponse.json;
    expect(assignedTaskBody.assignment.workerId).toBe("codex-mac-mini");

    const resultResponse = await mod.handleDispatcherHttpRequest({
      stateDir,
      method: "POST",
      pathname: "/api/workers/codex-mac-mini/result",
      body: {
        result: {
          taskId: dispatchBody.taskIds[0],
          workerId: "codex-mac-mini",
          provider: "codex",
          pool: "codex",
          branchName: "ai/codex/task-1-auth-api",
          repo: "TingRuDeng/openclaw-multi-agent-mvp",
          defaultBranch: "master",
          mode: "run",
          output: "done",
          generatedAt: "2026-03-16T11:00:00.000Z",
          verification: {
            allPassed: true,
            commands: [
              {
                command: "pnpm test",
                exitCode: 0,
                output: "ok",
              },
            ],
          },
        },
        changedFiles: ["src/auth.ts"],
        pullRequest: {
          number: 15,
          url: "https://github.com/TingRuDeng/openclaw-multi-agent-mvp/pull/15",
          headBranch: "ai/codex/task-1-auth-api",
          baseBranch: "master",
        },
      },
    });
    expect(resultResponse.status).toBe(200);

    const decisionResponse = await mod.handleDispatcherHttpRequest({
      stateDir,
      method: "POST",
      pathname: `/api/reviews/${dispatchBody.taskIds[0]}/decision`,
      body: {
        actor: "codex-control",
        decision: "merge",
        notes: "looks good",
      },
    });
    expect(decisionResponse.status).toBe(200);

    const snapshotResponse = await mod.handleDispatcherHttpRequest({
      stateDir,
      method: "GET",
      pathname: "/api/dashboard/snapshot",
    });
    expect(snapshotResponse.status).toBe(200);
    const snapshot = snapshotResponse.json;
    expect(snapshot.stats.workers.total).toBe(1);
    expect(snapshot.tasks[0]).toMatchObject({
      status: "merged",
    });
    expect(snapshot.pullRequests[0]).toMatchObject({
      number: 15,
      status: "merged",
    });

    const dashboardResponse = await mod.handleDispatcherHttpRequest({
      stateDir,
      method: "GET",
      pathname: "/dashboard",
    });
    expect(dashboardResponse.status).toBe(200);
    const dashboardHtml = dashboardResponse.text;
    expect(dashboardHtml).toContain("ForgeFlow");
  });

  it("fetch_task returns no_task when no task assigned", async () => {
    const stateDir = makeTempDir();
    const mod = await import(serverModulePath);

    const response = await mod.handleDispatcherHttpRequest({
      stateDir,
      method: "POST",
      pathname: "/api/trae/fetch-task",
      body: { worker_id: "trae-01" },
    });
    expect(response.status).toBe(200);
    expect(response.json.status).toBe("no_task");
  });

  it("submit_result rejects invalid status", async () => {
    const stateDir = makeTempDir();
    const mod = await import(serverModulePath);

    const response = await mod.handleDispatcherHttpRequest({
      stateDir,
      method: "POST",
      pathname: "/api/trae/submit-result",
      body: { task_id: "dispatch-1:task-1", status: "invalid_status" },
    });
    expect(response.status).toBe(400);
  });

  it("fetch_task returns task when assigned to trae worker", async () => {
    const stateDir = makeTempDir();
    const repoDir = path.join(stateDir, "repo");
    fs.mkdirSync(repoDir, { recursive: true });
    const mod = await import(serverModulePath);

    await mod.handleDispatcherHttpRequest({
      stateDir,
      method: "POST",
      pathname: "/api/trae/heartbeat",
      body: { worker_id: "trae-01" },
    });

    await mod.handleDispatcherHttpRequest({
      stateDir,
      method: "POST",
      pathname: "/api/dispatches",
      body: {
        repo: "test/repo",
        defaultBranch: "main",
        requestedBy: "test",
        tasks: [
          {
            id: "task-1",
            title: "Test task",
            pool: "trae",
            allowedPaths: ["docs/**"],
            acceptance: ["pnpm test"],
            dependsOn: [],
            branchName: "ai/trae/task-1",
          },
        ],
        packages: [
          {
            taskId: "task-1",
            assignment: {
              taskId: "task-1",
              workerId: "trae-01",
              pool: "trae",
              status: "assigned",
              branchName: "ai/trae/task-1",
              allowedPaths: ["docs/**"],
              repo: "test/repo",
              defaultBranch: "main",
            },
            workerPrompt: "Test prompt",
          },
        ],
      },
    });

    const response = await mod.handleDispatcherHttpRequest({
      stateDir,
      method: "POST",
      pathname: "/api/trae/fetch-task",
      body: { worker_id: "trae-01", repo_dir: repoDir },
    });
    expect(response.status).toBe(200);
    expect(response.json.status).toBe("ok");
    expect(response.json.task.goal).toBe("Test task");
    expect(response.json.task.default_branch).toBe("main");
    expect(response.json.task.worktree_dir).toBe(`${repoDir}/.worktrees/dispatch-1-task-1`);
    expect(response.json.task.assignment_dir).toBe(`${repoDir}/.worktrees/dispatch-1-task-1/.orchestrator/assignments/dispatch-1-task-1`);
    expect(response.json.task.constraints).toContain("allowedPaths: docs/**");
    expect(response.json.task.constraints).toContain("must run acceptance: pnpm test");
    expect(fs.existsSync(response.json.task.assignment_dir)).toBe(false);
  });

  it("fetch_task returns the same in_progress task when the worker retries after start", async () => {
    const stateDir = makeTempDir();
    const repoDir = path.join(stateDir, "repo");
    fs.mkdirSync(repoDir, { recursive: true });
    const mod = await import(serverModulePath);

    await mod.handleDispatcherHttpRequest({
      stateDir,
      method: "POST",
      pathname: "/api/trae/heartbeat",
      body: { worker_id: "trae-retry" },
    });

    await mod.handleDispatcherHttpRequest({
      stateDir,
      method: "POST",
      pathname: "/api/dispatches",
      body: {
        repo: "test/repo",
        defaultBranch: "main",
        requestedBy: "test",
        tasks: [
          {
            id: "task-retry",
            title: "Retry task",
            pool: "trae",
            allowedPaths: ["docs/**"],
            acceptance: [],
            dependsOn: [],
            branchName: "ai/trae/task-retry",
          },
        ],
        packages: [
          {
            taskId: "task-retry",
            assignment: {
              taskId: "task-retry",
              workerId: "trae-retry",
              pool: "trae",
              status: "assigned",
              branchName: "ai/trae/task-retry",
              allowedPaths: ["docs/**"],
              repo: "test/repo",
              defaultBranch: "main",
            },
          },
        ],
      },
    });

    const firstFetch = await mod.handleDispatcherHttpRequest({
      stateDir,
      method: "POST",
      pathname: "/api/trae/fetch-task",
      body: { worker_id: "trae-retry", repo_dir: repoDir },
    });
    const taskId = firstFetch.json.task.task_id;

    await mod.handleDispatcherHttpRequest({
      stateDir,
      method: "POST",
      pathname: "/api/trae/start-task",
      body: { worker_id: "trae-retry", task_id: taskId },
    });

    const retryFetch = await mod.handleDispatcherHttpRequest({
      stateDir,
      method: "POST",
      pathname: "/api/trae/fetch-task",
      body: { worker_id: "trae-retry", repo_dir: repoDir },
    });

    expect(retryFetch.status).toBe(200);
    expect(retryFetch.json.status).toBe("ok");
    expect(retryFetch.json.task.task_id).toBe(taskId);

    const snapshot = await mod.handleDispatcherHttpRequest({
      stateDir,
      method: "GET",
      pathname: "/api/dashboard/snapshot",
    });
    const worker = snapshot.json.workers.find((item: { id: string }) => item.id === "trae-retry");
    expect(worker.currentTaskId).toBe(taskId);
    const task = snapshot.json.tasks.find((item: { id: string }) => item.id === taskId);
    expect(task.status).toBe("in_progress");
  });

  it("fetch_task returns continuation_mode and continue_from_task_id for redrive tasks", async () => {
    const stateDir = makeTempDir();
    const repoDir = path.join(stateDir, "repo");
    fs.mkdirSync(repoDir, { recursive: true });
    const mod = await import(serverModulePath);

    await mod.handleDispatcherHttpRequest({
      stateDir,
      method: "POST",
      pathname: "/api/trae/heartbeat",
      body: { worker_id: "trae-cont" },
    });

    await mod.handleDispatcherHttpRequest({
      stateDir,
      method: "POST",
      pathname: "/api/dispatches",
      body: {
        repo: "test/repo",
        defaultBranch: "main",
        requestedBy: "test",
        tasks: [
          {
            id: "task-cont",
            title: "Continuation task",
            pool: "trae",
            allowedPaths: ["src/**"],
            acceptance: ["pnpm test"],
            dependsOn: [],
            branchName: "ai/trae/task-cont",
            continuationMode: "continue",
            continueFromTaskId: "dispatch-1:task-1",
          },
        ],
        packages: [
          {
            taskId: "task-cont",
            assignment: {
              taskId: "task-cont",
              workerId: "trae-cont",
              pool: "trae",
              status: "assigned",
              branchName: "ai/trae/task-cont",
              allowedPaths: ["src/**"],
              repo: "test/repo",
              defaultBranch: "main",
              continuationMode: "continue",
              continueFromTaskId: "dispatch-1:task-1",
            },
            workerPrompt: "Continue from previous task",
          },
        ],
      },
    });

    const response = await mod.handleDispatcherHttpRequest({
      stateDir,
      method: "POST",
      pathname: "/api/trae/fetch-task",
      body: { worker_id: "trae-cont", repo_dir: repoDir },
    });

    expect(response.status).toBe(200);
    expect(response.json.status).toBe("ok");
    expect(response.json.task.continuation_mode).toBe("continue");
    expect(response.json.task.continue_from_task_id).toBe("dispatch-1:task-1");
  });

  it("report_progress writes progress event", async () => {
    const stateDir = makeTempDir();
    const mod = await import(serverModulePath);

    const response = await mod.handleDispatcherHttpRequest({
      stateDir,
      method: "POST",
      pathname: "/api/trae/report-progress",
      body: { task_id: "task-1", message: "Working on it..." },
    });
    expect(response.status).toBe(200);
    expect(response.json.ok).toBe(true);

    const snapshot = await mod.handleDispatcherHttpRequest({
      stateDir,
      method: "GET",
      pathname: "/api/dashboard/snapshot",
    });
    const progressEvent = snapshot.json.events.find(
      (e: { type: string }) => e.type === "progress_reported",
    );
    expect(progressEvent).toBeDefined();
    expect(progressEvent.payload.message).toBe("Working on it...");
  });

  it("keeps targetWorkerId on dispatch creation and only lets the target trae worker claim it", async () => {
    const stateDir = makeTempDir();
    const repoDir = path.join(stateDir, "repo");
    fs.mkdirSync(repoDir, { recursive: true });
    const mod = await import(serverModulePath);

    await mod.handleDispatcherHttpRequest({
      stateDir,
      method: "POST",
      pathname: "/api/trae/heartbeat",
      body: { worker_id: "trae-local" },
    });

    await mod.handleDispatcherHttpRequest({
      stateDir,
      method: "POST",
      pathname: "/api/trae/heartbeat",
      body: { worker_id: "trae-remote" },
    });

    const dispatchResponse = await mod.handleDispatcherHttpRequest({
      stateDir,
      method: "POST",
      pathname: "/api/dispatches",
      body: {
        repo: "test/repo",
        defaultBranch: "main",
        requestedBy: "test",
        tasks: [
          {
            id: "task-1",
            title: "Target remote worker",
            pool: "trae",
            allowedPaths: ["docs/**"],
            acceptance: ["pnpm test"],
            dependsOn: [],
            branchName: "ai/trae/task-targeted",
            target_worker_id: "trae-remote",
          },
        ],
        packages: [
          {
            taskId: "task-1",
            assignment: {
              taskId: "task-1",
              workerId: null,
              pool: "trae",
              status: "pending",
              branchName: "ai/trae/task-targeted",
              allowedPaths: ["docs/**"],
              repo: "test/repo",
              defaultBranch: "main",
              target_worker_id: "trae-remote",
            },
            workerPrompt: "Test prompt",
          },
        ],
      },
    });
    expect(dispatchResponse.status).toBe(200);
    expect(dispatchResponse.json.assignments[0]).toMatchObject({
      workerId: "trae-remote",
      status: "assigned",
    });

    const localFetch = await mod.handleDispatcherHttpRequest({
      stateDir,
      method: "POST",
      pathname: "/api/trae/fetch-task",
      body: { worker_id: "trae-local", repo_dir: repoDir },
    });
    expect(localFetch.status).toBe(200);
    expect(localFetch.json.status).toBe("no_task");

    const remoteFetch = await mod.handleDispatcherHttpRequest({
      stateDir,
      method: "POST",
      pathname: "/api/trae/fetch-task",
      body: { worker_id: "trae-remote", repo_dir: repoDir },
    });
    expect(remoteFetch.status).toBe(200);
    expect(remoteFetch.json.status).toBe("ok");
    expect(remoteFetch.json.task.branch).toBe("ai/trae/task-targeted");
  });

  it("does not let a non-target trae worker claim a ready targeted task", async () => {
    const stateDir = makeTempDir();
    const repoDir = path.join(stateDir, "repo");
    fs.mkdirSync(repoDir, { recursive: true });
    const mod = await import(serverModulePath);

    await mod.handleDispatcherHttpRequest({
      stateDir,
      method: "POST",
      pathname: "/api/trae/heartbeat",
      body: { worker_id: "trae-local" },
    });

    const dispatchResponse = await mod.handleDispatcherHttpRequest({
      stateDir,
      method: "POST",
      pathname: "/api/dispatches",
      body: {
        repo: "test/repo",
        defaultBranch: "main",
        requestedBy: "test",
        tasks: [
          {
            id: "task-1",
            title: "Target remote worker later",
            pool: "trae",
            allowedPaths: ["docs/**"],
            acceptance: ["pnpm test"],
            dependsOn: [],
            branchName: "ai/trae/task-targeted-later",
            targetWorkerId: "trae-remote",
          },
        ],
        packages: [
          {
            taskId: "task-1",
            assignment: {
              taskId: "task-1",
              workerId: null,
              pool: "trae",
              status: "pending",
              branchName: "ai/trae/task-targeted-later",
              allowedPaths: ["docs/**"],
              repo: "test/repo",
              defaultBranch: "main",
            },
            workerPrompt: "Test prompt",
          },
        ],
      },
    });
    expect(dispatchResponse.status).toBe(200);
    expect(dispatchResponse.json.assignments[0]).toMatchObject({
      workerId: null,
      status: "pending",
    });

    const localFetch = await mod.handleDispatcherHttpRequest({
      stateDir,
      method: "POST",
      pathname: "/api/trae/fetch-task",
      body: { worker_id: "trae-local", repo_dir: repoDir },
    });
    expect(localFetch.status).toBe(200);
    expect(localFetch.json.status).toBe("no_task");
  });

  it("submit_result with review_ready moves task to review", async () => {
    const stateDir = makeTempDir();
    const mod = await import(serverModulePath);

    await mod.handleDispatcherHttpRequest({
      stateDir,
      method: "POST",
      pathname: "/api/trae/heartbeat",
      body: { worker_id: "trae-01" },
    });

    await mod.handleDispatcherHttpRequest({
      stateDir,
      method: "POST",
      pathname: "/api/dispatches",
      body: {
        repo: "test/repo",
        defaultBranch: "main",
        requestedBy: "test",
        tasks: [
          {
            id: "task-2",
            title: "Test task 2",
            pool: "trae",
            allowedPaths: ["docs/**"],
            acceptance: ["pnpm test"],
            dependsOn: [],
            branchName: "ai/trae/task-2",
          },
        ],
        packages: [
          {
            taskId: "task-2",
            assignment: {
              taskId: "task-2",
              workerId: "trae-01",
              pool: "trae",
              status: "assigned",
              branchName: "ai/trae/task-2",
              allowedPaths: ["docs/**"],
              repo: "test/repo",
              defaultBranch: "main",
            },
          },
        ],
      },
    });

    const fetchResponse = await mod.handleDispatcherHttpRequest({
      stateDir,
      method: "POST",
      pathname: "/api/trae/fetch-task",
      body: { worker_id: "trae-01" },
    });
    const taskId = fetchResponse.json.task.task_id;

    const response = await mod.handleDispatcherHttpRequest({
      stateDir,
      method: "POST",
      pathname: "/api/trae/submit-result",
      body: {
        task_id: taskId,
        status: "review_ready",
        summary: "Done!",
        test_output: "PASS",
        risks: ["Low risk"],
        files_changed: ["docs/test.md"],
        branch_name: "ai/trae/task-2",
        commit_sha: "abc123def456",
        push_status: "success",
        pr_number: 42,
        pr_url: "https://github.com/test/repo/pull/42",
      },
    });
    expect(response.status).toBe(200);
    expect(response.json.ok).toBe(true);

    const snapshot = await mod.handleDispatcherHttpRequest({
      stateDir,
      method: "GET",
      pathname: "/api/dashboard/snapshot",
    });
    const task = snapshot.json.tasks.find((t: { id: string }) => t.id === taskId);
    expect(task.status).toBe("review");
    const assignment = snapshot.json.assignments.find((item: { taskId: string }) => item.taskId === taskId);
    expect(assignment.status).toBe("review");
    expect(assignment.assignment.status).toBe("review");

    const submitEvent = snapshot.json.events.find(
      (e: { type: string; taskId: string }) => e.type === "status_changed" && e.taskId === taskId,
    );
    expect(submitEvent).toBeDefined();
    expect(submitEvent.payload.summary).toBe("Done!");
    expect(submitEvent.payload.test_output).toBe("PASS");
    expect(submitEvent.payload.risks).toContain("Low risk");
    expect(submitEvent.payload.files_changed).toContain("docs/test.md");
    expect(submitEvent.payload.github).toBeDefined();
    expect(submitEvent.payload.github.branch_name).toBe("ai/trae/task-2");
    expect(submitEvent.payload.github.commit_sha).toBe("abc123def456");
    expect(submitEvent.payload.github.push_status).toBe("success");
    expect(submitEvent.payload.github.pr_number).toBe(42);
    expect(submitEvent.payload.github.pr_url).toBe("https://github.com/test/repo/pull/42");
  });

  it("submit_result with failed moves task to failed", async () => {
    const stateDir = makeTempDir();
    const mod = await import(serverModulePath);

    await mod.handleDispatcherHttpRequest({
      stateDir,
      method: "POST",
      pathname: "/api/trae/heartbeat",
      body: { worker_id: "trae-02" },
    });

    await mod.handleDispatcherHttpRequest({
      stateDir,
      method: "POST",
      pathname: "/api/dispatches",
      body: {
        repo: "test/repo",
        defaultBranch: "main",
        requestedBy: "test",
        tasks: [
          {
            id: "task-3",
            title: "Test task 3",
            pool: "trae",
            allowedPaths: ["docs/**"],
            acceptance: ["pnpm test"],
            dependsOn: [],
            branchName: "ai/trae/task-3",
          },
        ],
        packages: [
          {
            taskId: "task-3",
            assignment: {
              taskId: "task-3",
              workerId: "trae-02",
              pool: "trae",
              status: "assigned",
              branchName: "ai/trae/task-3",
              allowedPaths: ["docs/**"],
              repo: "test/repo",
              defaultBranch: "main",
            },
          },
        ],
      },
    });

    const fetchResponse = await mod.handleDispatcherHttpRequest({
      stateDir,
      method: "POST",
      pathname: "/api/trae/fetch-task",
      body: { worker_id: "trae-02" },
    });
    const taskId = fetchResponse.json.task.task_id;

    const response = await mod.handleDispatcherHttpRequest({
      stateDir,
      method: "POST",
      pathname: "/api/trae/submit-result",
      body: {
        task_id: taskId,
        status: "failed",
        summary: "Something went wrong",
        branch_name: "ai/trae/task-3",
        commit_sha: "def789ghi012",
        push_status: "failed",
        push_error: "remote: Permission denied",
      },
    });
    expect(response.status).toBe(200);
    expect(response.json.ok).toBe(true);

    const snapshot = await mod.handleDispatcherHttpRequest({
      stateDir,
      method: "GET",
      pathname: "/api/dashboard/snapshot",
    });
    const task = snapshot.json.tasks.find((t: { id: string }) => t.id === taskId);
    expect(task.status).toBe("failed");
    const assignment = snapshot.json.assignments.find((item: { taskId: string }) => item.taskId === taskId);
    expect(assignment.status).toBe("failed");
    expect(assignment.assignment.status).toBe("failed");

    const failedEvent = snapshot.json.events.find(
      (e: { type: string; taskId: string }) => e.type === "status_changed" && e.taskId === taskId,
    );
    expect(failedEvent).toBeDefined();
    expect(failedEvent.payload.github).toBeDefined();
    expect(failedEvent.payload.github.branch_name).toBe("ai/trae/task-3");
    expect(failedEvent.payload.github.commit_sha).toBe("def789ghi012");
    expect(failedEvent.payload.github.push_status).toBe("failed");
    expect(failedEvent.payload.github.push_error).toBe("remote: Permission denied");
  });

  it("heartbeat updates worker lastHeartbeatAt", async () => {
    const stateDir = makeTempDir();
    const mod = await import(serverModulePath);

    const response = await mod.handleDispatcherHttpRequest({
      stateDir,
      method: "POST",
      pathname: "/api/trae/heartbeat",
      body: { worker_id: "trae-03" },
    });
    expect(response.status).toBe(200);
    expect(response.json.ok).toBe(true);

    const snapshot = await mod.handleDispatcherHttpRequest({
      stateDir,
      method: "GET",
      pathname: "/api/dashboard/snapshot",
    });
    const worker = snapshot.json.workers.find((w: { id: string }) => w.id === "trae-03");
    expect(worker).toBeDefined();
    expect(worker.pool).toBe("trae");
    expect(worker.lastHeartbeatAt).toBeDefined();
  });

  it("rejects POST request bodies larger than 16KB", async () => {
    const mod = await import(serverModulePath);

    await expect(mod.readJsonBody(Readable.from([
      Buffer.alloc(16 * 1024 + 1),
    ]))).rejects.toMatchObject({
      code: "payload_too_large",
    });
  });

  it("dashboard html redirects to the standalone console app", async () => {
    const stateDir = makeTempDir();
    const mod = await import(serverModulePath);

    const dashboardResponse = await mod.handleDispatcherHttpRequest({
      stateDir,
      method: "GET",
      pathname: "/dashboard",
    });

    expect(dashboardResponse.status).toBe(200);
    expect(dashboardResponse.text).not.toContain(".innerHTML");
    expect(dashboardResponse.text).toContain("ForgeFlow Console Redirect");
    expect(dashboardResponse.text).toContain("window.location.href = 'http://localhost:8788';");
  });

  it("disables and enables workers via API", async () => {
    const stateDir = makeTempDir();
    const mod = await import(serverModulePath);

    const registerResponse = await mod.handleDispatcherHttpRequest({
      stateDir,
      method: "POST",
      pathname: "/api/workers/register",
      body: {
        workerId: "test-worker-1",
        pool: "test",
        hostname: "test-host",
        labels: ["test"],
        repoDir: "/test",
      },
    });
    expect(registerResponse.status).toBe(200);

    const disableResponse = await mod.handleDispatcherHttpRequest({
      stateDir,
      method: "POST",
      pathname: "/api/workers/test-worker-1/disable",
      body: { at: "2026-04-03T00:00:00.000Z" },
    });
    expect(disableResponse.status).toBe(200);
    expect(disableResponse.json.status).toBe("disabled");
    expect(disableResponse.json.workers.find((w: { id: string }) => w.id === "test-worker-1").status).toBe("disabled");

    const enableResponse = await mod.handleDispatcherHttpRequest({
      stateDir,
      method: "POST",
      pathname: "/api/workers/test-worker-1/enable",
      body: { at: "2026-04-03T00:01:00.000Z" },
    });
    expect(enableResponse.status).toBe(200);
    expect(enableResponse.json.status).toBe("enabled");
    expect(enableResponse.json.workers.find((w: { id: string }) => w.id === "test-worker-1").status).toBe("idle");
  });

  it("keeps disabled workers visible as disabled in dashboard snapshots", async () => {
    const stateDir = makeTempDir();
    const mod = await import(serverModulePath);

    await mod.handleDispatcherHttpRequest({
      stateDir,
      method: "POST",
      pathname: "/api/workers/register",
      body: {
        workerId: "test-worker-disabled-offline",
        pool: "trae",
        hostname: "test-host",
        labels: ["test"],
        repoDir: "/test",
        at: "2026-04-03T00:00:00.000Z",
      },
    });

    await mod.handleDispatcherHttpRequest({
      stateDir,
      method: "POST",
      pathname: "/api/workers/test-worker-disabled-offline/disable",
      body: { at: "2026-04-03T00:00:05.000Z" },
    });

    const snapshotResponse = await mod.handleDispatcherHttpRequest({
      stateDir,
      method: "GET",
      pathname: "/api/dashboard/snapshot",
    });

    expect(snapshotResponse.status).toBe(200);
    const worker = snapshotResponse.json.workers.find((w: { id: string }) => w.id === "test-worker-disabled-offline");
    expect(worker).toMatchObject({
      status: "disabled",
      disabledAt: "2026-04-03T00:00:05.000Z",
    });
  });

  it("dashboard includes a fallback link to the standalone console app", async () => {
    const stateDir = makeTempDir();
    const mod = await import(serverModulePath);

    await mod.handleDispatcherHttpRequest({
      stateDir,
      method: "POST",
      pathname: "/api/workers/register",
      body: {
        workerId: "test-worker-2",
        pool: "test",
        hostname: "test-host",
        labels: ["test"],
        repoDir: "/test",
      },
    });

    const dashboardResponse = await mod.handleDispatcherHttpRequest({
      stateDir,
      method: "GET",
      pathname: "/dashboard",
    });

    expect(dashboardResponse.status).toBe(200);
    expect(dashboardResponse.text).toContain('Redirecting to <a href="http://localhost:8788">ForgeFlow Console</a>...');
  });

  describe("auth middleware", () => {
    const originalEnv = { ...process.env };

    afterEach(() => {
      process.env = { ...originalEnv };
    });

    it("returns 401 when DISPATCHER_AUTH_MODE=token and no DISPATCHER_API_TOKEN is set", async () => {
      process.env.DISPATCHER_AUTH_MODE = "token";
      delete process.env.DISPATCHER_API_TOKEN;
      const stateDir = makeTempDir();
      const mod = await import(serverModulePath);

      const response = await mod.handleDispatcherHttpRequest({
        stateDir,
        method: "GET",
        pathname: "/api/workers",
      });
      expect(response.status).toBe(401);
      expect(response.json.error).toBe("auth_required_no_token");
    });

    it("allows all requests when DISPATCHER_AUTH_MODE=token and DISPATCHER_API_TOKEN is set and valid", async () => {
      process.env.DISPATCHER_AUTH_MODE = "token";
      process.env.DISPATCHER_API_TOKEN = "test-secret-token";
      const stateDir = makeTempDir();
      const mod = await import(serverModulePath);

      const response = await mod.handleDispatcherHttpRequest({
        stateDir,
        method: "GET",
        pathname: "/api/workers",
        authHeader: "Bearer test-secret-token",
      });
      expect(response.status).toBe(200);
    });

    it("returns 401 when DISPATCHER_AUTH_MODE=token and DISPATCHER_API_TOKEN is set but token is wrong", async () => {
      process.env.DISPATCHER_AUTH_MODE = "token";
      process.env.DISPATCHER_API_TOKEN = "test-secret-token";
      const stateDir = makeTempDir();
      const mod = await import(serverModulePath);

      const response = await mod.handleDispatcherHttpRequest({
        stateDir,
        method: "GET",
        pathname: "/api/workers",
        authHeader: "Bearer wrong-token",
      });
      expect(response.status).toBe(401);
      expect(response.json.error).toBe("unauthorized");
    });

    it("returns 401 when DISPATCHER_AUTH_MODE=token and DISPATCHER_API_TOKEN is set but no auth header", async () => {
      process.env.DISPATCHER_AUTH_MODE = "token";
      process.env.DISPATCHER_API_TOKEN = "test-secret-token";
      const stateDir = makeTempDir();
      const mod = await import(serverModulePath);

      const response = await mod.handleDispatcherHttpRequest({
        stateDir,
        method: "GET",
        pathname: "/api/workers",
      });
      expect(response.status).toBe(401);
      expect(response.json.error).toBe("unauthorized");
    });

    it("allows all requests when DISPATCHER_AUTH_MODE=open regardless of token", async () => {
      process.env.DISPATCHER_AUTH_MODE = "open";
      process.env.DISPATCHER_API_TOKEN = "any-token";
      const stateDir = makeTempDir();
      const mod = await import(serverModulePath);

      const response = await mod.handleDispatcherHttpRequest({
        stateDir,
        method: "GET",
        pathname: "/api/workers",
      });
      expect(response.status).toBe(200);
    });

    it("returns 401 when DISPATCHER_AUTH_MODE is not set and no DISPATCHER_API_TOKEN (secure default)", async () => {
      delete process.env.DISPATCHER_AUTH_MODE;
      delete process.env.DISPATCHER_API_TOKEN;
      const stateDir = makeTempDir();
      const mod = await import(serverModulePath);

      const response = await mod.handleDispatcherHttpRequest({
        stateDir,
        method: "GET",
        pathname: "/api/workers",
      });
      expect(response.status).toBe(401);
      expect(response.json.error).toBe("auth_required_no_token");
    });

    it("allows /health without authentication in any mode", async () => {
      process.env.DISPATCHER_AUTH_MODE = "token";
      process.env.DISPATCHER_API_TOKEN = "test-secret-token";
      const stateDir = makeTempDir();
      const mod = await import(serverModulePath);

      const response = await mod.handleDispatcherHttpRequest({
        stateDir,
        method: "GET",
        pathname: "/health",
      });
      expect(response.status).toBe(200);
      expect(response.json.status).toBe("ok");
    });

    it("rejects malformed authorization header in token mode", async () => {
      process.env.DISPATCHER_AUTH_MODE = "token";
      process.env.DISPATCHER_API_TOKEN = "test-secret-token";
      const stateDir = makeTempDir();
      const mod = await import(serverModulePath);

      const response = await mod.handleDispatcherHttpRequest({
        stateDir,
        method: "GET",
        pathname: "/api/workers",
        authHeader: "InvalidFormat token",
      });
      expect(response.status).toBe(401);
      expect(response.json.error).toBe("unauthorized");
    });
  });
});
