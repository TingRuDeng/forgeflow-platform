// @ts-nocheck
import crypto from "node:crypto";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { URL } from "node:url";

import { buildDashboardHtml } from "./dashboard.js";
import {
  beginTaskForWorker,
  buildDashboardSnapshot,
  cancelTask,
  claimAssignedTaskForWorker,
  createDispatch,
  disableWorker,
  enableWorker,
  getAssignedTaskForWorker,
  heartbeatWorker,
  loadRuntimeState,
  reconcileRuntimeState,
  recordReviewDecision,
  recordWorkerEvent,
  recordWorkerResult,
  registerWorker,
  saveRuntimeState,
} from "./runtime-state.js";
import { handleTraeRoute } from "./runtime-dispatcher-server.js";
import {
  filterLessonsForInjection,
  injectLessonsIntoContext,
  loadMemoryStore,
} from "../../../../../scripts/lib/review-memory.js";
import { safeTaskDirName } from "../../../../../scripts/lib/task-worktree.js";
import { formatLocalTimestamp } from "../time.js";
import { getDispatcherAuthMode, getDispatcherApiToken } from "./dispatcher-config.js";

const MAX_REQUEST_BODY_BYTES = 16 * 1024;
const STATE_LOCK_FILENAME = ".runtime-state.lock";
const DEFAULT_STATE_LOCK_TIMEOUT_MS = 2000;
const DEFAULT_STATE_LOCK_RETRY_MS = 25;
const DEFAULT_STATE_LOCK_STALE_MS = 30000;
const STATE_LOCK_SLEEP_BUFFER = new Int32Array(new SharedArrayBuffer(4));
let stateLockTimeoutCount = 0;

const AUTH_WHITELIST_PATHS = ["/health"];

type AuthMode = "legacy" | "token" | "open";

function isLoopbackAddress(clientAddress?: string): boolean {
  if (!clientAddress) {
    return false;
  }
  const normalized = clientAddress.toLowerCase();
  return (
    normalized === "127.0.0.1"
    || normalized === "::1"
    || normalized === "::ffff:127.0.0.1"
    || normalized === "localhost"
  );
}

function safeTokenCompare(a: string, b: string): boolean {
  try {
    const aBuf = Buffer.from(a, "utf8");
    const bBuf = Buffer.from(b, "utf8");
    if (aBuf.length !== bBuf.length) {
      return false;
    }
    return crypto.timingSafeEqual(aBuf, bBuf);
  } catch {
    return false;
  }
}

function checkAuthToken(authHeader: string | undefined, apiToken: string): boolean {
  if (!authHeader) {
    return false;
  }
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    return false;
  }
  const token = match[1];
  return safeTokenCompare(token, apiToken);
}

function createAuthMiddleware(input: { method: string; pathname: string; authHeader?: string; clientAddress?: string; internalCall?: boolean }): null | { status: number; error: string } {
  if (input.internalCall) {
    return null;
  }

  const authMode = getDispatcherAuthMode();

  if (authMode === "open") {
    return null;
  }

  if (authMode === "token") {
    const apiToken = getDispatcherApiToken();
    if (!apiToken) {
      return {
        status: 500,
        error: "DISPATCHER_API_TOKEN is required when auth mode is 'token'",
      };
    }

    if (AUTH_WHITELIST_PATHS.includes(input.pathname)) {
      return null;
    }

    if (!checkAuthToken(input.authHeader, apiToken)) {
      return {
        status: 401,
        error: "unauthorized",
      };
    }
    return null;
  }

  const apiToken = getDispatcherApiToken();
  if (apiToken) {
    if (AUTH_WHITELIST_PATHS.includes(input.pathname)) {
      return null;
    }

    if (!checkAuthToken(input.authHeader, apiToken)) {
      return {
        status: 401,
        error: "unauthorized",
      };
    }
    return null;
  }

  if (AUTH_WHITELIST_PATHS.includes(input.pathname)) {
    return null;
  }

  if (!isLoopbackAddress(input.clientAddress)) {
    return {
      status: 401,
      error: "unauthorized",
    };
  }

  return null;
}

function nowIso() {
  return formatLocalTimestamp();
}

function buildTraeWorktreeAndAssignmentDirs(stateDir, repoDir, task) {
  const baseWorktreeRoot = repoDir
    ? path.join(repoDir, ".worktrees")
    : path.join(stateDir, "..", "worktrees");
  const worktreeDir = path.join(baseWorktreeRoot, safeTaskDirName(task.id));
  const assignmentDir = path.join(
    worktreeDir,
    ".orchestrator",
    "assignments",
    safeTaskDirName(task.id)
  );
  return { worktree_dir: worktreeDir, assignment_dir: assignmentDir };
}

function normalizeDispatchBody(body) {
  if (!body || !Array.isArray(body.tasks) || !Array.isArray(body.packages)) {
    return body;
  }

  return {
    ...body,
    tasks: body.tasks.map((task) => {
      const targetWorkerId = task?.targetWorkerId ?? task?.target_worker_id ?? null;
      const followUpOfTaskId = task?.followUpOfTaskId ?? task?.follow_up_of_task_id ?? null;
      const workerChangeReason = task?.workerChangeReason ?? task?.worker_change_reason ?? null;
      return {
        ...task,
        ...(targetWorkerId ? { targetWorkerId } : {}),
        ...(followUpOfTaskId ? { followUpOfTaskId } : {}),
        ...(workerChangeReason ? { workerChangeReason } : {}),
      };
    }),
    packages: body.packages.map((pkg) => {
      const assignment = pkg?.assignment ?? {};
      const targetWorkerId = assignment?.targetWorkerId ?? assignment?.target_worker_id ?? null;
      const followUpOfTaskId = assignment?.followUpOfTaskId ?? assignment?.follow_up_of_task_id ?? null;
      const workerChangeReason = assignment?.workerChangeReason ?? assignment?.worker_change_reason ?? null;
      return {
        ...pkg,
        assignment: {
          ...assignment,
          ...(targetWorkerId ? { targetWorkerId } : {}),
          ...(followUpOfTaskId ? { followUpOfTaskId } : {}),
          ...(workerChangeReason ? { workerChangeReason } : {}),
        },
      };
    }),
  };
}

function sendJson(response, statusCode, value, headers = {}) {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    ...headers,
  });
  response.end(`${JSON.stringify(value, null, 2)}\n`);
}

function createJsonResponse(status, value, extraHeaders = {}) {
  return {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...extraHeaders,
    },
    json: value,
    text: `${JSON.stringify(value, null, 2)}\n`,
  };
}

function createNoStoreJsonResponse(status, value) {
  return createJsonResponse(status, value, {
    "cache-control": "no-store",
  });
}

function classifyReviewDecisionError(error) {
  const message = error instanceof Error ? error.message : String(error);
  if (
    message.startsWith("task not found:")
    || message.startsWith("assignment not found for task:")
  ) {
    return 404;
  }
  if (message.startsWith("task not in review:")) {
    return 409;
  }
  return 500;
}

function classifyTaskCancellationError(error) {
  const message = error instanceof Error ? error.message : String(error);
  if (
    message.startsWith("task not found:")
    || message.startsWith("assignment not found for task:")
  ) {
    return 404;
  }
  if (message.startsWith("task not cancellable from state:")) {
    return 409;
  }
  return 500;
}

function classifyWorkerResultError(error) {
  const message = error instanceof Error ? error.message : String(error);
  if (
    message.startsWith("task not found:")
    || message.startsWith("assignment not found for task:")
    || message.startsWith("worker not found:")
  ) {
    return 404;
  }
  if (
    message.startsWith("task not assigned to worker:")
    || message.startsWith("task not executable:")
    || message.includes("mismatch for ")
  ) {
    return 409;
  }
  if (
    message === "worker result body must be a JSON object"
    || message === "worker result.result must be a JSON object"
    || message === "worker result taskId is required"
    || message === "worker result verification.allPassed must be a boolean"
    || message === "worker result verification.commands must be an array"
    || message === "worker result changedFiles must be an array of strings when provided"
    || message === "worker result pullRequest must be null or an object"
    || message === "worker result pullRequest.number must be a positive integer"
    || message === "worker result pullRequest.url must be a string"
    || message === "worker result pullRequest.headBranch must be a string"
    || message === "worker result pullRequest.baseBranch must be a string"
  ) {
    return 400;
  }
  return 500;
}

function classifyWorkerEventError(error) {
  const message = error instanceof Error ? error.message : String(error);
  if (message.startsWith("worker not found:")) {
    return 404;
  }
  if (
    message === "worker event body must be a JSON object"
    || message === "worker event type is required"
    || message === "worker event taskId must be a string"
    || message === "worker event at must be a string"
  ) {
    return 400;
  }
  return 500;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function validateReviewDecisionBody(body) {
  if (!isPlainObject(body)) {
    throw Object.assign(new Error("review decision body must be a JSON object"), { status: 400 });
  }

  const actor = typeof body.actor === "string" ? body.actor.trim() : "";
  if (!actor) {
    throw Object.assign(new Error("review decision actor is required"), { status: 400 });
  }

  const decision = typeof body.decision === "string" ? body.decision.trim() : "";
  if (!["merge", "block", "rework", "changes_requested"].includes(decision)) {
    throw Object.assign(new Error(`invalid review decision: ${decision || "<empty>"}`), { status: 400 });
  }

  if (body.notes !== undefined && typeof body.notes !== "string") {
    throw Object.assign(new Error("review decision notes must be a string when provided"), { status: 400 });
  }

  if (body.evidence !== undefined) {
    if (!isPlainObject(body.evidence)) {
      throw Object.assign(new Error("review decision evidence must be an object when provided"), { status: 400 });
    }
    if (body.evidence.reasonCode !== undefined && typeof body.evidence.reasonCode !== "string") {
      throw Object.assign(new Error("review decision evidence.reasonCode must be a string"), { status: 400 });
    }
    if (
      body.evidence.mustFix !== undefined
      && (!Array.isArray(body.evidence.mustFix) || body.evidence.mustFix.some((item) => typeof item !== "string"))
    ) {
      throw Object.assign(new Error("review decision evidence.mustFix must be an array of strings"), { status: 400 });
    }
    if (body.evidence.canRedrive !== undefined && typeof body.evidence.canRedrive !== "boolean") {
      throw Object.assign(new Error("review decision evidence.canRedrive must be a boolean"), { status: 400 });
    }
    if (body.evidence.redriveStrategy !== undefined && typeof body.evidence.redriveStrategy !== "string") {
      throw Object.assign(new Error("review decision evidence.redriveStrategy must be a string"), { status: 400 });
    }
  }

  return {
    ...body,
    actor,
    decision,
  };
}

function validateWorkerResultBody(body) {
  if (!isPlainObject(body)) {
    throw new Error("worker result body must be a JSON object");
  }

  if (!isPlainObject(body.result)) {
    throw new Error("worker result.result must be a JSON object");
  }

  const taskId = typeof body.result.taskId === "string" ? body.result.taskId.trim() : "";
  if (!taskId) {
    throw new Error("worker result taskId is required");
  }

  const verification = body.result.verification;
  if (!isPlainObject(verification) || typeof verification.allPassed !== "boolean") {
    throw new Error("worker result verification.allPassed must be a boolean");
  }

  if (verification.commands !== undefined && !Array.isArray(verification.commands)) {
    throw new Error("worker result verification.commands must be an array");
  }

  if (
    body.changedFiles !== undefined
    && (!Array.isArray(body.changedFiles) || body.changedFiles.some((item) => typeof item !== "string"))
  ) {
    throw new Error("worker result changedFiles must be an array of strings when provided");
  }

  if (body.pullRequest !== undefined && body.pullRequest !== null) {
    if (!isPlainObject(body.pullRequest)) {
      throw new Error("worker result pullRequest must be null or an object");
    }
    if (!Number.isInteger(body.pullRequest.number) || body.pullRequest.number <= 0) {
      throw new Error("worker result pullRequest.number must be a positive integer");
    }
    if (typeof body.pullRequest.url !== "string") {
      throw new Error("worker result pullRequest.url must be a string");
    }
    if (typeof body.pullRequest.headBranch !== "string") {
      throw new Error("worker result pullRequest.headBranch must be a string");
    }
    if (typeof body.pullRequest.baseBranch !== "string") {
      throw new Error("worker result pullRequest.baseBranch must be a string");
    }
  }

  return body;
}

function validateWorkerEventBody(body) {
  if (!isPlainObject(body)) {
    throw new Error("worker event body must be a JSON object");
  }
  const type = typeof body.type === "string" ? body.type.trim() : "";
  if (!type) {
    throw new Error("worker event type is required");
  }
  if (body.taskId !== undefined && body.taskId !== null && typeof body.taskId !== "string") {
    throw new Error("worker event taskId must be a string");
  }
  if (body.at !== undefined && typeof body.at !== "string") {
    throw new Error("worker event at must be a string");
  }
  return {
    type,
    taskId: body.taskId ?? null,
    at: body.at,
    payload: body.payload,
  };
}

function createHtmlResponse(status, html, extraHeaders = {}) {
  return {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      ...extraHeaders,
    },
    html,
    text: html,
  };
}

function sendHtml(response, html, headers = {}) {
  response.writeHead(200, {
    "content-type": "text/html; charset=utf-8",
    ...headers,
  });
  response.end(html);
}

class PayloadTooLargeError extends Error {
  constructor(message = "payload_too_large") {
    super(message);
    this.name = "PayloadTooLargeError";
    this.code = "payload_too_large";
    this.status = 413;
  }
}

class StateLockTimeoutError extends Error {
  constructor(lockPath, timeoutMs) {
    super(`state lock timeout after ${timeoutMs}ms: ${lockPath}`);
    this.name = "StateLockTimeoutError";
    this.code = "state_lock_timeout";
    this.status = 503;
  }
}

function getStateLockTimeoutMs() {
  return Number(process.env.DISPATCHER_STATE_LOCK_TIMEOUT_MS || DEFAULT_STATE_LOCK_TIMEOUT_MS);
}

function getStateLockRetryMs() {
  return Number(process.env.DISPATCHER_STATE_LOCK_RETRY_MS || DEFAULT_STATE_LOCK_RETRY_MS);
}

function getStateLockStaleMs() {
  return Number(process.env.DISPATCHER_STATE_LOCK_STALE_MS || DEFAULT_STATE_LOCK_STALE_MS);
}

function sleepSync(ms) {
  if (ms <= 0) {
    return;
  }
  Atomics.wait(STATE_LOCK_SLEEP_BUFFER, 0, 0, ms);
}

export function getStateLockFilePath(stateDir) {
  return path.join(stateDir, STATE_LOCK_FILENAME);
}

function isLockStale(lockPath, staleMs) {
  try {
    const stats = fs.statSync(lockPath);
    return Date.now() - stats.mtimeMs >= staleMs;
  } catch (error) {
    if (error?.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

function acquireStateLock(stateDir) {
  fs.mkdirSync(stateDir, { recursive: true });
  const lockPath = getStateLockFilePath(stateDir);
  const timeoutMs = getStateLockTimeoutMs();
  const retryMs = getStateLockRetryMs();
  const staleMs = getStateLockStaleMs();
  const deadline = Date.now() + timeoutMs;

  while (true) {
    let fd = null;
    try {
      fd = fs.openSync(lockPath, "wx");
      const metadata = JSON.stringify({
        pid: process.pid,
        createdAt: nowIso(),
      });
      fs.writeFileSync(fd, metadata);
      fs.closeSync(fd);

      return () => {
        try {
          fs.unlinkSync(lockPath);
        } catch (error) {
          if (error?.code !== "ENOENT") {
            throw error;
          }
        }
      };
    } catch (error) {
      if (fd !== null) {
        try {
          fs.closeSync(fd);
        } catch {}
      }

      if (error?.code !== "EEXIST") {
        throw error;
      }

      if (isLockStale(lockPath, staleMs)) {
        try {
          fs.unlinkSync(lockPath);
          continue;
        } catch (unlinkError) {
          if (unlinkError?.code === "ENOENT") {
            continue;
          }
        }
      }

      if (Date.now() >= deadline) {
        throw new StateLockTimeoutError(lockPath, timeoutMs);
      }

      sleepSync(retryMs);
    }
  }
}

export async function readJsonBody(request, maxBytes = MAX_REQUEST_BODY_BYTES) {
  const chunks = [];
  let totalBytes = 0;
  for await (const chunk of request) {
    totalBytes += Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(chunk);
    if (totalBytes > maxBytes) {
      throw new PayloadTooLargeError();
    }
    chunks.push(chunk);
  }

  const payload = Buffer.concat(chunks).toString("utf8");
  if (!payload) {
    return {};
  }
  return JSON.parse(payload);
}

function withState(stateDir, callback) {
  const releaseLock = acquireStateLock(stateDir);
  try {
    const state = loadRuntimeState(stateDir);
    const result = callback(state);
    if (result?.state) {
      saveRuntimeState(stateDir, result.state);
    }
    return result;
  } finally {
    releaseLock();
  }
}

function routeNotFound(response) {
  sendJson(response, 404, {
    error: "not_found",
  });
}

export function handleDispatcherHttpRequest(input) {
  const { stateDir, method, pathname, body = {}, authHeader, clientAddress, internalCall } = input;

  const authError = createAuthMiddleware({ method, pathname, authHeader, clientAddress, internalCall });
  if (authError) {
    return createJsonResponse(authError.status, { error: authError.error });
  }

  try {
    if (method === "GET" && pathname === "/health") {
      return createNoStoreJsonResponse(200, { status: "ok" });
    }

    if (method === "GET" && pathname === "/dashboard") {
      return createHtmlResponse(200, buildDashboardHtml(), {
        "cache-control": "no-store",
      });
    }

    if (method === "GET" && pathname === "/api/dashboard/snapshot") {
      const snapshot = withState(stateDir, (state) => {
        const nextState = reconcileRuntimeState(state);
        return {
          state: nextState,
          snapshot: buildDashboardSnapshot(nextState),
        };
      });
      return createNoStoreJsonResponse(200, snapshot.snapshot);
    }

    if (method === "GET" && pathname === "/api/metrics") {
      const payload = withState(stateDir, (state) => {
        const nextState = reconcileRuntimeState(state);
        const snapshot = buildDashboardSnapshot(nextState);
        return {
          state: nextState,
          metrics: {
            updatedAt: snapshot.updatedAt,
            queueDepth: snapshot.metrics.queueDepth,
            plannedTasks: snapshot.metrics.plannedTasks,
            reviewBacklog: snapshot.metrics.reviewBacklog,
            avgAssignmentLagMs: snapshot.metrics.avgAssignmentLagMs,
            maxAssignmentLagMs: snapshot.metrics.maxAssignmentLagMs,
            submitResultRetryCount: snapshot.metrics.submitResultRetryCount,
            deliveryFailedCount: snapshot.metrics.deliveryFailedCount,
            cleanupFailureCount: snapshot.metrics.cleanupFailureCount,
            sessionInterruptionCount: snapshot.metrics.sessionInterruptionCount,
            stateLockTimeoutCount: snapshot.metrics.stateLockTimeoutCount + stateLockTimeoutCount,
            workers: snapshot.stats.workers,
            tasks: snapshot.stats.tasks,
          },
        };
      });
      return createNoStoreJsonResponse(200, payload.metrics);
    }

    if (method === "GET" && pathname === "/api/workers") {
      const snapshot = withState(stateDir, (state) => {
        const nextState = reconcileRuntimeState(state);
        return {
          state: nextState,
          snapshot: buildDashboardSnapshot(nextState),
        };
      });
      return createNoStoreJsonResponse(200, snapshot.snapshot.workers);
    }

    if (method === "POST" && pathname === "/api/workers/register") {
      const result = withState(stateDir, (state) => {
        const nextState = reconcileRuntimeState(registerWorker(state, body), {
          now: body.at,
        });
        return {
          state: nextState,
        };
      });
      return createJsonResponse(200, {
        status: "registered",
        workers: result.state.workers,
      });
    }

    const heartbeatMatch = method === "POST"
      ? pathname.match(/^\/api\/workers\/([^/]+)\/heartbeat$/)
      : null;
    if (heartbeatMatch) {
      const result = withState(stateDir, (state) => {
        const nextState = reconcileRuntimeState(heartbeatWorker(state, {
          workerId: decodeURIComponent(heartbeatMatch[1]),
          at: body.at,
        }), {
          now: body.at,
        });
        return {
          state: nextState,
        };
      });
      return createJsonResponse(200, {
        status: "heartbeat",
        workers: result.state.workers,
      });
    }

    const assignedMatch = method === "GET"
      ? pathname.match(/^\/api\/workers\/([^/]+)\/assigned-task$/)
      : null;
    if (assignedMatch) {
      const payload = withState(stateDir, (state) => {
        const nextState = reconcileRuntimeState(state);
        return {
          state: nextState,
          assignment: getAssignedTaskForWorker(nextState, decodeURIComponent(assignedMatch[1])),
        };
      });
      return createNoStoreJsonResponse(200, payload.assignment ?? { assignment: null });
    }

    const claimMatch = method === "POST"
      ? pathname.match(/^\/api\/workers\/([^/]+)\/claim-task$/)
      : null;
    if (claimMatch) {
      const payload = withState(stateDir, (state) => claimAssignedTaskForWorker(state, {
        workerId: decodeURIComponent(claimMatch[1]),
        at: body.at,
      }));
      return createJsonResponse(200, payload.assignment ?? { assignment: null });
    }

    const startMatch = method === "POST"
      ? pathname.match(/^\/api\/workers\/([^/]+)\/start-task$/)
      : null;
    if (startMatch) {
      const result = withState(stateDir, (state) => ({
        state: beginTaskForWorker(state, {
          workerId: decodeURIComponent(startMatch[1]),
          taskId: body.taskId,
          at: body.at,
        }),
      }));
      return createJsonResponse(200, {
        status: "started",
        tasks: result.state.tasks,
      });
    }

    const resultMatch = method === "POST"
      ? pathname.match(/^\/api\/workers\/([^/]+)\/result$/)
      : null;
    if (resultMatch) {
      try {
        const validatedBody = validateWorkerResultBody(body);
        const result = withState(stateDir, (state) => ({
          state: recordWorkerResult(state, {
            workerId: decodeURIComponent(resultMatch[1]),
            result: validatedBody.result,
            changedFiles: validatedBody.changedFiles,
            pullRequest: validatedBody.pullRequest,
          }),
        }));
        return createJsonResponse(200, {
          status: "result_recorded",
          tasks: result.state.tasks,
        });
      } catch (error) {
        return createJsonResponse(classifyWorkerResultError(error), {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const workerEventMatch = method === "POST"
      ? pathname.match(/^\/api\/workers\/([^/]+)\/events$/)
      : null;
    if (workerEventMatch) {
      try {
        const validatedBody = validateWorkerEventBody(body);
        const result = withState(stateDir, (state) => ({
          state: recordWorkerEvent(state, {
            workerId: decodeURIComponent(workerEventMatch[1]),
            type: validatedBody.type,
            taskId: validatedBody.taskId,
            at: validatedBody.at,
            payload: validatedBody.payload,
          }),
        }));
        return createJsonResponse(200, {
          status: "event_recorded",
          events: result.state.events.slice(-5),
        });
      } catch (error) {
        return createJsonResponse(classifyWorkerEventError(error), {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const disableMatch = method === "POST"
      ? pathname.match(/^\/api\/workers\/([^/]+)\/disable$/)
      : null;
    if (disableMatch) {
      const result = withState(stateDir, (state) => ({
        state: disableWorker(state, {
          workerId: decodeURIComponent(disableMatch[1]),
          disabledBy: body.disabledBy,
          at: body.at,
        }),
      }));
      return createJsonResponse(200, {
        status: "disabled",
        workers: result.state.workers,
      });
    }

    const enableMatch = method === "POST"
      ? pathname.match(/^\/api\/workers\/([^/]+)\/enable$/)
      : null;
    if (enableMatch) {
      const result = withState(stateDir, (state) => ({
        state: enableWorker(state, {
          workerId: decodeURIComponent(enableMatch[1]),
          at: body.at,
        }),
      }));
      return createJsonResponse(200, {
        status: "enabled",
        workers: result.state.workers,
      });
    }

    const cancelTaskMatch = method === "POST"
      ? pathname.match(/^\/api\/tasks\/([^/]+)\/cancel$/)
      : null;
    if (cancelTaskMatch) {
      try {
        const result = withState(stateDir, (state) => ({
          state: cancelTask(state, {
            taskId: decodeURIComponent(cancelTaskMatch[1]),
            actor: String(body.actor || "").trim() || "codex-control",
            reason: typeof body.reason === "string" ? body.reason : undefined,
            at: body.at,
          }),
        }));
        const taskId = decodeURIComponent(cancelTaskMatch[1]);
        return createJsonResponse(200, {
          status: "cancelled",
          task: result.state.tasks.find((candidate) => candidate.id === taskId) ?? null,
          workers: result.state.workers,
        });
      } catch (error) {
        return createJsonResponse(classifyTaskCancellationError(error), {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (method === "POST" && pathname === "/api/dispatches") {
      const memoryStore = loadMemoryStore(stateDir);
      const normalizedBody = normalizeDispatchBody(body);

      const result = withState(stateDir, (state) => {
        const dispatchResult = createDispatch(state, normalizedBody);

        if (memoryStore && memoryStore.lessons && memoryStore.lessons.length > 0) {
          for (const assignment of dispatchResult.state.assignments) {
            const task = dispatchResult.state.tasks.find((t) => t.id === assignment.taskId);
            if (!task) continue;

            const criteria = {
              repo: task.repo,
              scope: task.allowedPaths || [],
              category: undefined,
              worker_type: task.pool,
            };

            const relevantLessons = filterLessonsForInjection(
              memoryStore.lessons,
              criteria,
            );

            if (relevantLessons.length > 0) {
              const injectedContext = injectLessonsIntoContext(
                assignment.contextMarkdown || "",
                relevantLessons,
              );
              assignment.contextMarkdown = injectedContext;
              if (assignment.assignment) {
                assignment.assignment.contextMarkdown = injectedContext;
              }
            }
          }
        }

        return dispatchResult;
      });

      return createJsonResponse(200, {
        dispatchId: result.dispatchId,
        taskIds: result.taskIds,
        assignments: result.assignments,
      });
    }

    const reviewMatch = method === "POST"
      ? pathname.match(/^\/api\/reviews\/([^/]+)\/decision$/)
      : null;
    if (reviewMatch) {
      try {
        const validatedBody = validateReviewDecisionBody(body);
        const result = withState(stateDir, (state) => ({
          state: recordReviewDecision(state, {
            taskId: decodeURIComponent(reviewMatch[1]),
            actor: validatedBody.actor,
            decision: validatedBody.decision,
            notes: validatedBody.notes,
            at: validatedBody.at,
            evidence: validatedBody.evidence,
          }),
        }));
        return createJsonResponse(200, {
          status: "decision_recorded",
          tasks: result.state.tasks,
        });
      } catch (error) {
        const status = typeof error?.status === "number" ? error.status : classifyReviewDecisionError(error);
        return createJsonResponse(status, {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const traeRoutes = [
      "/api/trae/register",
      "/api/trae/fetch-task",
      "/api/trae/start-task",
      "/api/trae/report-progress",
      "/api/trae/submit-result",
      "/api/trae/heartbeat",
    ];
    if (method === "POST" && traeRoutes.includes(pathname)) {
      try {
        const result = withState(stateDir, (state) => ({
          state,
          handled: handleTraeRoute(state, { method, pathname, body }),
        }));
        return result.handled;
      } catch (err) {
        console.error("[dispatcher-server] handleTraeRoute error:", err);
        const status = typeof err?.status === "number" ? err.status : 500;
        return createJsonResponse(status, { error: err instanceof Error ? err.message : String(err) });
      }
    }

    return createJsonResponse(404, {
      error: "not_found",
    });
  } catch (error) {
    if (error?.code === "state_lock_timeout") {
      stateLockTimeoutCount += 1;
    }
    const status = typeof error?.status === "number" ? error.status : 500;
    return createJsonResponse(status, {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function startDispatcherServer(input) {
  const host = input.host ?? "127.0.0.1";
  const port = input.port ?? 8787;
  const stateDir = input.stateDir;

  const server = http.createServer(async (request, response) => {
    const requestUrl = new URL(request.url ?? "/", `http://${request.headers.host ?? `${host}:${port}`}`);
    const clientAddress = request.socket.remoteAddress;

    try {
      const body = request.method === "POST" ? await readJsonBody(request) : undefined;
      const authHeader = request.headers.authorization;
      const handled = handleDispatcherHttpRequest({
        stateDir,
        method: request.method ?? "GET",
        pathname: requestUrl.pathname,
        body,
        authHeader,
        clientAddress,
      });
      if (handled.headers["content-type"]?.startsWith("text/html")) {
        sendHtml(response, handled.text, handled.headers);
      } else {
        sendJson(response, handled.status, handled.json, handled.headers);
      }
    } catch (error) {
      if (error?.code === "payload_too_large") {
        sendJson(response, error.status ?? 413, {
          error: "payload_too_large",
        });
        return;
      }
      sendJson(response, 500, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  await new Promise((resolve) => {
    server.listen(port, host, resolve);
  });

  const address = server.address();
  const resolvedPort = typeof address === "object" && address ? address.port : port;

  return {
    server,
    host,
    port: resolvedPort,
    baseUrl: `http://${host}:${resolvedPort}`,
    close: () => new Promise((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    }),
  };
}
