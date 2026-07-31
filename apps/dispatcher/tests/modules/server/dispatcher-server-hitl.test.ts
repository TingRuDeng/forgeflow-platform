import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { handleDispatcherHttpRequest } from "../../../src/modules/server/dispatcher-server.js";

const tempRoots: string[] = [];
const originalAuthMode = process.env.DISPATCHER_AUTH_MODE;
const originalConfigPath = process.env.FORGEFLOW_DISPATCHER_CONFIG_PATH;

function makeTempDir() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "forgeflow-dispatcher-hitl-"));
  tempRoots.push(tempDir);
  return tempDir;
}

async function registerHitlWorker(stateDir: string): Promise<void> {
  await handleDispatcherHttpRequest({
    stateDir,
    method: "POST",
    pathname: "/api/workers/register",
    body: {
      workerId: "hitl-api-worker",
      pool: "codex",
      hostname: "hitl-host",
      labels: ["test"],
      repoDir: "/test",
    },
  });
}

async function createHitlDispatch(stateDir: string): Promise<string> {
  const dispatchResponse = await handleDispatcherHttpRequest({
    stateDir,
    method: "POST",
    pathname: "/api/dispatches",
    body: {
      repo: "TingRuDeng/forgeflow-platform",
      defaultBranch: "main",
      requestedBy: "codex-control",
      tasks: [{
        id: "hitl-api-task",
        title: "Need HITL API validation",
        pool: "codex",
        branchName: "ai/codex/hitl-api-task",
        verification: { mode: "run" },
      }],
      packages: [{
        taskId: "hitl-api-task",
        assignment: {
          taskId: "hitl-api-task",
          workerId: null,
          pool: "codex",
          status: "pending",
          branchName: "ai/codex/hitl-api-task",
          repo: "TingRuDeng/forgeflow-platform",
          defaultBranch: "main",
        },
      }],
    },
  });
  const payload = dispatchResponse.json as { taskIds: string[] };
  return payload.taskIds[0];
}

async function startHitlTask(stateDir: string, taskId: string): Promise<void> {
  await handleDispatcherHttpRequest({
    stateDir,
    method: "POST",
    pathname: "/api/workers/hitl-api-worker/claim-task",
    body: { at: "2026-07-05T10:10:00.000Z" },
  });
  await handleDispatcherHttpRequest({
    stateDir,
    method: "POST",
    pathname: "/api/workers/hitl-api-worker/start-task",
    body: { taskId, at: "2026-07-05T10:10:01.000Z" },
  });
}

async function interruptHitlTask(stateDir: string, taskId: string): Promise<void> {
  await handleDispatcherHttpRequest({
    stateDir,
    method: "POST",
    pathname: `/api/tasks/${encodeURIComponent(taskId)}/interrupt`,
    body: {
      actor: "codex-control",
      requestId: "hitl-api-request-1",
      sourceSessionId: "hitl-session-1",
      reason: "need decision",
      resumePayloadSchema: {
        properties: {
          decision: { type: "string", enum: ["continue", "stop"], title: "Decision" },
        },
        required: ["decision"],
      },
      at: "2026-07-05T10:10:02.000Z",
    },
  });
}

async function readWaitingIdentity(stateDir: string, taskId: string) {
  const response = await handleDispatcherHttpRequest({
    stateDir,
    method: "GET",
    pathname: "/api/dashboard/snapshot",
  });
  const payload = response.json as {
    tasks: Array<{
      id: string;
      waitingForInput?: { requestId?: string; attemptId?: string };
    }>;
  };
  const waiting = payload.tasks.find((task) => task.id === taskId)?.waitingForInput;
  return {
    requestId: waiting?.requestId,
    attemptId: waiting?.attemptId,
  };
}

async function createInterruptedTask(stateDir: string): Promise<string> {
  await registerHitlWorker(stateDir);
  const taskId = await createHitlDispatch(stateDir);
  await startHitlTask(stateDir, taskId);
  await interruptHitlTask(stateDir, taskId);
  return taskId;
}

beforeEach(() => {
  const configRoot = makeTempDir();
  process.env.DISPATCHER_AUTH_MODE = "open";
  process.env.FORGEFLOW_DISPATCHER_CONFIG_PATH = path.join(configRoot, ".forgeflow-dispatcher.json");
});

afterEach(() => {
  for (const tempDir of tempRoots.splice(0)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
  if (originalAuthMode === undefined) {
    delete process.env.DISPATCHER_AUTH_MODE;
  } else {
    process.env.DISPATCHER_AUTH_MODE = originalAuthMode;
  }
  if (originalConfigPath === undefined) {
    delete process.env.FORGEFLOW_DISPATCHER_CONFIG_PATH;
  } else {
    process.env.FORGEFLOW_DISPATCHER_CONFIG_PATH = originalConfigPath;
  }
});

describe("dispatcher HITL resume API", () => {
  it("rejects an invalid input request expiry", async () => {
    const stateDir = makeTempDir();
    await registerHitlWorker(stateDir);
    const taskId = await createHitlDispatch(stateDir);

    const invalidResponse = await handleDispatcherHttpRequest({
      stateDir,
      method: "POST",
      pathname: `/api/tasks/${encodeURIComponent(taskId)}/interrupt`,
      body: {
        actor: "codex-control",
        expiresAt: 123,
      },
    });

    expect(invalidResponse.status).toBe(400);
    expect((invalidResponse.json as { error: string }).error).toMatch(/valid timestamp/i);

    const invalidAtResponse = await handleDispatcherHttpRequest({
      stateDir,
      method: "POST",
      pathname: `/api/tasks/${encodeURIComponent(taskId)}/interrupt`,
      body: {
        actor: "codex-control",
        expiresAt: "2026-07-05T10:20:00.000Z",
        at: "not-a-timestamp",
      },
    });
    expect(invalidAtResponse.status).toBe(400);
    expect((invalidAtResponse.json as { error: string }).error).toMatch(/at must be a valid timestamp/i);
  });

  it("returns 400 when resume payload violates the stored schema", async () => {
    const stateDir = makeTempDir();
    const taskId = await createInterruptedTask(stateDir);
    const identity = await readWaitingIdentity(stateDir, taskId);

    const invalidResponse = await handleDispatcherHttpRequest({
      stateDir,
      method: "POST",
      pathname: `/api/tasks/${encodeURIComponent(taskId)}/resume`,
      body: {
        actor: "codex-control",
        ...identity,
        resumePayload: { decision: "maybe" },
        at: "2026-07-05T10:10:03.000Z",
      },
    });

    const invalidPayload = invalidResponse.json as { error: string };
    expect(invalidResponse.status).toBe(400);
    expect(invalidPayload.error).toContain("resumePayload.decision");

    const dashboardResponse = await handleDispatcherHttpRequest({
      stateDir,
      method: "GET",
      pathname: "/api/dashboard/snapshot",
    });
    const dashboardPayload = dashboardResponse.json as { tasks: Array<{ id: string; status: string }> };
    const task = dashboardPayload.tasks.find((candidate) => candidate.id === taskId);
    expect(task).toMatchObject({ status: "waiting_for_input" });
  });

  it("returns 400 when resume time predates the input request", async () => {
    const stateDir = makeTempDir();
    const taskId = await createInterruptedTask(stateDir);
    const identity = await readWaitingIdentity(stateDir, taskId);

    const response = await handleDispatcherHttpRequest({
      stateDir,
      method: "POST",
      pathname: `/api/tasks/${encodeURIComponent(taskId)}/resume`,
      body: {
        actor: "codex-control",
        ...identity,
        resumePayload: { decision: "continue" },
        at: "2026-07-05T10:10:01.000Z",
      },
    });

    expect(response.status).toBe(400);
    expect((response.json as { error: string }).error).toMatch(/before requestedAt/i);
  });

  it("fences stale resumes and makes an identical replay idempotent", async () => {
    const stateDir = makeTempDir();
    const taskId = await createInterruptedTask(stateDir);
    const identity = await readWaitingIdentity(stateDir, taskId);
    expect(identity).toMatchObject({
      requestId: "hitl-api-request-1",
      attemptId: expect.any(String),
    });

    const stale = await handleDispatcherHttpRequest({
      stateDir,
      method: "POST",
      pathname: `/api/tasks/${encodeURIComponent(taskId)}/resume`,
      body: {
        actor: "codex-control",
        requestId: "stale-request",
        attemptId: identity.attemptId,
        resumePayload: { decision: "continue" },
        at: "2026-07-05T10:10:03.000Z",
      },
    });
    expect(stale.status).toBe(409);
    expect((stale.json as { error: string }).error).toMatch(/request mismatch/i);

    const resumeBody = {
      actor: "codex-control",
      ...identity,
      resumePayload: { decision: "continue" },
      at: "2026-07-05T10:10:03.000Z",
    };
    const resumed = await handleDispatcherHttpRequest({
      stateDir,
      method: "POST",
      pathname: `/api/tasks/${encodeURIComponent(taskId)}/resume`,
      body: resumeBody,
    });
    expect(resumed.status).toBe(200);
    expect((resumed.json as any).task).toMatchObject({
      status: "ready",
      lastResolvedInput: {
        requestId: "hitl-api-request-1",
        resumePayload: { decision: "continue" },
      },
    });

    const replay = await handleDispatcherHttpRequest({
      stateDir,
      method: "POST",
      pathname: `/api/tasks/${encodeURIComponent(taskId)}/resume`,
      body: resumeBody,
    });
    expect(replay.status).toBe(200);

    const conflictingReplay = await handleDispatcherHttpRequest({
      stateDir,
      method: "POST",
      pathname: `/api/tasks/${encodeURIComponent(taskId)}/resume`,
      body: {
        ...resumeBody,
        resumePayload: { decision: "stop" },
      },
    });
    expect(conflictingReplay.status).toBe(409);
    expect((conflictingReplay.json as { error: string }).error).toMatch(/replay payload mismatch/i);
  });
});
