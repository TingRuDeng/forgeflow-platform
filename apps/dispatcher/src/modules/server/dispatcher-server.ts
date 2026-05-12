import crypto from "node:crypto";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { URL } from "node:url";

import { buildDashboardHtml } from "./dashboard.js";
import {
  buildStructuredDashboardSnapshot,
  loadStructuredRuntimeState,
  readStructuredProjectionHealth,
} from "./runtime-state-query-store.js";
import { getRuntimeStateShadowMode, readRuntimeStateShadowWriteStatus } from "./runtime-state-shadow.js";
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
  markWorkerOffline,
  reconcileRuntimeState,
  recordReviewDecision,
  recordWorkerEvent,
  recordWorkerResult,
  registerWorker,
  saveRuntimeState,
} from "./runtime-state.js";
import type { RegisterWorkerInput, RuntimeState, Task } from "./runtime-state.js";
import { handleTraeRoute } from "./runtime-dispatcher-server.js";
import {
  filterLessonsForInjection,
  injectLessonsIntoContext,
  loadMemoryStore,
} from "./review-memory.js";
import { buildStage3SloStatus } from "./slo.js";
import { safeTaskDirName } from "./task-worktree.js";
import { formatLocalTimestamp } from "../time.js";
import { getDispatcherAuthMode, getDispatcherApiToken } from "./dispatcher-config.js";

const MAX_REQUEST_BODY_BYTES = 16 * 1024;
const STATE_LOCK_FILENAME = ".runtime-state.lock";
const DEFAULT_STATE_LOCK_TIMEOUT_MS = 2000;
const DEFAULT_STATE_LOCK_RETRY_MS = 25;
const DEFAULT_STATE_LOCK_STALE_MS = 30000;
const STRUCTURED_READS_ENV = "DISPATCHER_STRUCTURED_READS";
const READ_ONLY_MODE_ENV = "DISPATCHER_READ_ONLY_MODE";
const STATE_LOCK_SLEEP_BUFFER = new Int32Array(new SharedArrayBuffer(4));
const MUTATION_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
let stateLockTimeoutCount = 0;

const AUTH_WHITELIST_PATHS = ["/health"];

type AuthMode = "legacy" | "token" | "open";
type HeaderMap = Record<string, string>;
type JsonResponse = {
  status: number;
  headers: HeaderMap;
  json?: unknown;
  text: string;
  html?: string;
};
type DispatcherRequestInput = {
  stateDir: string;
  method: string;
  pathname: string;
  body?: Record<string, any>;
  authHeader?: string;
  clientAddress?: string;
  internalCall?: boolean;
};

function useStructuredReads() {
  return process.env[STRUCTURED_READS_ENV] === "1";
}

function isReadOnlyModeEnabled() {
  return process.env[READ_ONLY_MODE_ENV] === "1";
}

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

function nowIso(): string {
  return formatLocalTimestamp();
}

function buildTraeWorktreeAndAssignmentDirs(stateDir: string, repoDir: string | undefined, task: Task) {
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

function normalizeDispatchBody(body: any): any {
  if (!body || !Array.isArray(body.tasks) || !Array.isArray(body.packages)) {
    return body;
  }

  return {
    ...body,
    tasks: body.tasks.map((task: any) => {
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
    packages: body.packages.map((pkg: any) => {
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

function sendJson(response: http.ServerResponse, statusCode: number, value: unknown, headers: HeaderMap = {}): void {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    ...headers,
  });
  response.end(`${JSON.stringify(value, null, 2)}\n`);
}

function createJsonResponse(status: number, value: unknown, extraHeaders: HeaderMap = {}): JsonResponse {
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

function createNoStoreJsonResponse(status: number, value: unknown): JsonResponse {
  return createJsonResponse(status, value, {
    "cache-control": "no-store",
  });
}

function classifyReviewDecisionError(error: unknown): number {
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

function classifyTaskCancellationError(error: unknown): number {
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

function classifyWorkerResultError(error: unknown): number {
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
    || message.startsWith("active attempt not found for task:")
    || message.startsWith("stale attempt ")
    || message.startsWith("attempt owned by another worker:")
    || message.startsWith("attempt id mismatch:")
    || message.startsWith("lease token mismatch:")
    || message.includes("mismatch for ")
  ) {
    return 409;
  }
  if (
    message === "worker start body must be a JSON object"
    || message === "worker start taskId is required"
    || message === "worker start at must be a string when provided"
    || message === "worker attemptId must be a string when provided"
    || message === "worker leaseToken must be a string when provided"
    || message === "worker result body must be a JSON object"
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

function classifyWorkerEventError(error: unknown): number {
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

function isPlainObject(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readWorkerLeaseFields(body: Record<string, any>): { attemptId?: string; leaseToken?: string } {
  if (body.attemptId !== undefined && typeof body.attemptId !== "string") {
    throw new Error("worker attemptId must be a string when provided");
  }
  if (body.leaseToken !== undefined && typeof body.leaseToken !== "string") {
    throw new Error("worker leaseToken must be a string when provided");
  }
  return {
    attemptId: body.attemptId,
    leaseToken: body.leaseToken,
  };
}

function validateWorkerStartBody(body: unknown): Record<string, any> {
  if (!isPlainObject(body)) {
    throw new Error("worker start body must be a JSON object");
  }

  const taskId = typeof body.taskId === "string" ? body.taskId.trim() : "";
  if (!taskId) {
    throw new Error("worker start taskId is required");
  }
  if (body.at !== undefined && typeof body.at !== "string") {
    throw new Error("worker start at must be a string when provided");
  }

  return {
    taskId,
    at: body.at,
    ...readWorkerLeaseFields(body),
  };
}

function readReviewEvidenceFields(source: Record<string, any>, prefix: string): Record<string, any> {
  const evidence: Record<string, any> = {};
  if (source.reasonCode !== undefined) {
    if (typeof source.reasonCode !== "string") {
      throw Object.assign(new Error(`${prefix}.reasonCode must be a string`), { status: 400 });
    }
    evidence.reasonCode = source.reasonCode;
  }
  if (source.mustFix !== undefined) {
    if (!Array.isArray(source.mustFix) || source.mustFix.some((item) => typeof item !== "string")) {
      throw Object.assign(new Error(`${prefix}.mustFix must be an array of strings`), { status: 400 });
    }
    evidence.mustFix = source.mustFix;
  }
  if (source.canRedrive !== undefined) {
    if (typeof source.canRedrive !== "boolean") {
      throw Object.assign(new Error(`${prefix}.canRedrive must be a boolean`), { status: 400 });
    }
    evidence.canRedrive = source.canRedrive;
  }
  if (source.redriveStrategy !== undefined) {
    if (typeof source.redriveStrategy !== "string") {
      throw Object.assign(new Error(`${prefix}.redriveStrategy must be a string`), { status: 400 });
    }
    evidence.redriveStrategy = source.redriveStrategy;
  }
  return evidence;
}

function normalizeReviewDecisionEvidence(body: Record<string, any>): Record<string, any> | undefined {
  let evidence = body.evidence === undefined ? undefined : readReviewEvidenceFields(body.evidence, "review decision evidence");
  const topLevel = readReviewEvidenceFields(body, "review decision");
  if (Object.keys(topLevel).length > 0) {
    evidence = {
      ...(evidence ?? {}),
      ...topLevel,
    };
  }
  return evidence;
}

function validateReviewDecisionBody(body: unknown): Record<string, any> {
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
  }
  const evidence = normalizeReviewDecisionEvidence(body);

  return {
    ...body,
    actor,
    decision,
    evidence,
  };
}

function validateWorkerRegisterBody(body: unknown): RegisterWorkerInput {
  if (!isPlainObject(body)) {
    throw Object.assign(new Error("worker register body must be a JSON object"), { status: 400 });
  }

  const workerId = typeof body.workerId === "string" ? body.workerId.trim() : "";
  if (!workerId) {
    throw Object.assign(new Error("worker register workerId is required"), { status: 400 });
  }

  const pool = typeof body.pool === "string" ? body.pool.trim() : "";
  if (!pool) {
    throw Object.assign(new Error("worker register pool is required"), { status: 400 });
  }

  const hostname = typeof body.hostname === "string" ? body.hostname.trim() : "";
  if (!hostname) {
    throw Object.assign(new Error("worker register hostname is required"), { status: 400 });
  }

  if (body.labels !== undefined && (!Array.isArray(body.labels) || body.labels.some((item) => typeof item !== "string"))) {
    throw Object.assign(new Error("worker register labels must be an array of strings"), { status: 400 });
  }
  if (body.repoDir !== undefined && typeof body.repoDir !== "string") {
    throw Object.assign(new Error("worker register repoDir must be a string"), { status: 400 });
  }
  if (body.at !== undefined && typeof body.at !== "string") {
    throw Object.assign(new Error("worker register at must be a string"), { status: 400 });
  }

  return {
    workerId,
    pool,
    hostname,
    labels: body.labels ?? [],
    repoDir: body.repoDir,
    at: body.at,
  };
}

function validateWorkerResultBody(body: unknown): Record<string, any> {
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

  return {
    ...body,
    ...readWorkerLeaseFields(body),
  };
}

function validateWorkerEventBody(body: unknown): { type: string; taskId: string | null; at: string | undefined; payload: unknown } {
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

function rethrowStateLockTimeout(error: any): void {
  if (error?.code === "state_lock_timeout") {
    throw error;
  }
}

function createHtmlResponse(status: number, html: string, extraHeaders: HeaderMap = {}): JsonResponse {
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

function sendHtml(response: http.ServerResponse, html: string, headers: HeaderMap = {}): void {
  response.writeHead(200, {
    "content-type": "text/html; charset=utf-8",
    ...headers,
  });
  response.end(html);
}

class PayloadTooLargeError extends Error {
  code: string;
  status: number;
  constructor(message = "payload_too_large") {
    super(message);
    this.name = "PayloadTooLargeError";
    this.code = "payload_too_large";
    this.status = 413;
  }
}

class InvalidJsonBodyError extends Error {
  code: string;
  status: number;
  constructor(message = "invalid_json_body") {
    super(message);
    this.name = "InvalidJsonBodyError";
    this.code = "invalid_json_body";
    this.status = 400;
  }
}

class StateLockTimeoutError extends Error {
  code: string;
  status: number;
  constructor(lockPath: string, timeoutMs: number) {
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

function sleepSync(ms: number): void {
  if (ms <= 0) {
    return;
  }
  Atomics.wait(STATE_LOCK_SLEEP_BUFFER, 0, 0, ms);
}

export function getStateLockFilePath(stateDir: string): string {
  return path.join(stateDir, STATE_LOCK_FILENAME);
}

function isLockStale(lockPath: string, staleMs: number): boolean {
  try {
    const stats = fs.statSync(lockPath);
    return Date.now() - stats.mtimeMs >= staleMs;
  } catch (error: any) {
    if (error?.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

function acquireStateLock(stateDir: string): () => void {
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
        } catch (error: any) {
          if (error?.code !== "ENOENT") {
            throw error;
          }
        }
      };
    } catch (error: any) {
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
        } catch (unlinkError: any) {
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

export async function readJsonBody(request: AsyncIterable<Buffer | string>, maxBytes = MAX_REQUEST_BODY_BYTES): Promise<Record<string, unknown>> {
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  for await (const chunk of request) {
    totalBytes += Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(chunk);
    if (totalBytes > maxBytes) {
      throw new PayloadTooLargeError();
    }
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const payload = Buffer.concat(chunks).toString("utf8");
  if (!payload) {
    return {};
  }
  try {
    return JSON.parse(payload);
  } catch {
    throw new InvalidJsonBodyError();
  }
}

function withState<T>(stateDir: string, callback: (state: RuntimeState) => T): T {
  const releaseLock = acquireStateLock(stateDir);
  try {
    const state = loadRuntimeState(stateDir);
    const result = callback(state);
    const nextState = (result as { state?: RuntimeState } | null | undefined)?.state;
    if (nextState && !isReadOnlyModeEnabled()) {
      saveRuntimeState(stateDir, nextState);
    }
    return result;
  } finally {
    releaseLock();
  }
}

function routeNotFound(response: http.ServerResponse): void {
  sendJson(response, 404, {
    error: "not_found",
  });
}

function isMutationRequest(method: string, pathname: string): boolean {
  if (!MUTATION_METHODS.has(method.toUpperCase())) {
    return false;
  }
  return pathname.startsWith("/api/");
}

function listBackupManifests(stateDir: string): Array<{ name: string; path: string }> {
  const backupDir = path.join(stateDir, "backups");
  if (!fs.existsSync(backupDir)) {
    return [];
  }
  return fs.readdirSync(backupDir)
    .filter((entry) => entry.endsWith("manifest.json"))
    .sort()
    .reverse()
    .slice(0, 5)
    .map((entry) => ({
      name: entry,
      path: path.join(backupDir, entry),
    }));
}

export function handleDispatcherHttpRequest(input: DispatcherRequestInput): JsonResponse {
  const { stateDir, method, pathname, body = {}, authHeader, clientAddress, internalCall } = input;

  const authError = createAuthMiddleware({ method, pathname, authHeader, clientAddress, internalCall });
  if (authError) {
    return createJsonResponse(authError.status, { error: authError.error });
  }

  try {
    if (isReadOnlyModeEnabled() && isMutationRequest(method, pathname)) {
      return createJsonResponse(503, {
        error: "dispatcher is in read-only mode",
        code: "read_only_mode",
      });
    }

    if (method === "GET" && pathname === "/health") {
      return createNoStoreJsonResponse(200, {
        status: "ok",
        readOnly: isReadOnlyModeEnabled(),
        structuredReads: useStructuredReads(),
      });
    }

    if (method === "GET" && pathname === "/dashboard") {
      return createHtmlResponse(200, buildDashboardHtml(), {
        "cache-control": "no-store",
      });
    }

    if (method === "GET" && pathname === "/api/dashboard/snapshot") {
      const snapshot = useStructuredReads()
        ? { snapshot: buildStructuredDashboardSnapshot(stateDir) }
        : withState(stateDir, (state) => {
          const nextState = reconcileRuntimeState(state);
          return {
            state: nextState,
            snapshot: buildDashboardSnapshot(nextState),
          };
        });
      return createNoStoreJsonResponse(200, snapshot.snapshot);
    }

    if (method === "GET" && pathname === "/api/metrics") {
      const payload = (useStructuredReads()
        ? (() => {
          const snapshot = buildStructuredDashboardSnapshot(stateDir);
          return {
            metrics: {
              updatedAt: snapshot.updatedAt,
              queueDepth: snapshot.metrics.queueDepth,
              plannedTasks: snapshot.metrics.plannedTasks,
              reviewBacklog: snapshot.metrics.reviewBacklog,
              avgAssignmentLagMs: snapshot.metrics.avgAssignmentLagMs,
              maxAssignmentLagMs: snapshot.metrics.maxAssignmentLagMs,
              submitResultRetryCount: snapshot.metrics.submitResultRetryCount,
              retryRatePct: snapshot.metrics.retryRatePct,
              deliveryFailedCount: snapshot.metrics.deliveryFailedCount,
              cleanupFailureCount: snapshot.metrics.cleanupFailureCount,
              sessionInterruptionCount: snapshot.metrics.sessionInterruptionCount,
              stateLockTimeoutCount: snapshot.metrics.stateLockTimeoutCount + stateLockTimeoutCount,
              branchProtectionHitCount: snapshot.metrics.branchProtectionHitCount,
              leaseConflictCount: snapshot.metrics.leaseConflictCount,
              leaseReclaimCount: snapshot.metrics.leaseReclaimCount,
              activeLeases: snapshot.metrics.activeLeases,
              repoConcurrencySaturation: snapshot.metrics.repoConcurrencySaturation,
              failureCodes: snapshot.metrics.failureCodes,
              reviewReasonCodes: snapshot.metrics.reviewReasonCodes,
              workers: snapshot.stats.workers,
              tasks: snapshot.stats.tasks,
            },
          };
        })()
        : withState(stateDir, (state) => {
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
              retryRatePct: snapshot.metrics.retryRatePct,
              deliveryFailedCount: snapshot.metrics.deliveryFailedCount,
              cleanupFailureCount: snapshot.metrics.cleanupFailureCount,
              sessionInterruptionCount: snapshot.metrics.sessionInterruptionCount,
              stateLockTimeoutCount: snapshot.metrics.stateLockTimeoutCount + stateLockTimeoutCount,
              branchProtectionHitCount: snapshot.metrics.branchProtectionHitCount,
              leaseConflictCount: snapshot.metrics.leaseConflictCount,
              leaseReclaimCount: snapshot.metrics.leaseReclaimCount,
              activeLeases: snapshot.metrics.activeLeases,
              repoConcurrencySaturation: snapshot.metrics.repoConcurrencySaturation,
              failureCodes: snapshot.metrics.failureCodes,
              reviewReasonCodes: snapshot.metrics.reviewReasonCodes,
              workers: snapshot.stats.workers,
              tasks: snapshot.stats.tasks,
            },
          };
        }));
      return createNoStoreJsonResponse(200, payload.metrics);
    }

    if (method === "GET" && pathname === "/api/slo") {
      const snapshot = useStructuredReads()
        ? buildStructuredDashboardSnapshot(stateDir)
        : withState(stateDir, (state) => {
          const nextState = reconcileRuntimeState(state);
          return {
            state: nextState,
            snapshot: buildDashboardSnapshot(nextState),
          };
        }).snapshot;
      return createNoStoreJsonResponse(200, buildStage3SloStatus(snapshot));
    }

    if (method === "GET" && pathname === "/api/dr/status") {
      return createNoStoreJsonResponse(200, {
        readOnly: isReadOnlyModeEnabled(),
        structuredReads: useStructuredReads(),
        shadowMode: getRuntimeStateShadowMode(),
        shadowWrite: readRuntimeStateShadowWriteStatus(),
        projectionHealth: readStructuredProjectionHealth(stateDir),
        backups: listBackupManifests(stateDir),
      });
    }

    if (method === "GET" && pathname === "/api/workers") {
      const snapshot = useStructuredReads()
        ? { snapshot: buildStructuredDashboardSnapshot(stateDir) }
        : withState(stateDir, (state) => {
          const nextState = reconcileRuntimeState(state);
          return {
            state: nextState,
            snapshot: buildDashboardSnapshot(nextState),
          };
        });
      return createNoStoreJsonResponse(200, snapshot.snapshot.workers);
    }

    if (method === "GET" && pathname === "/api/leases") {
      const state = useStructuredReads()
        ? loadStructuredRuntimeState(stateDir)
        : withState(stateDir, (currentState) => ({
          state: reconcileRuntimeState(currentState),
        })).state;
      return createNoStoreJsonResponse(200, state.leases ?? []);
    }

    if (method === "GET" && pathname === "/api/query/tasks") {
      return createNoStoreJsonResponse(200, loadStructuredRuntimeState(stateDir).tasks);
    }

    if (method === "GET" && pathname === "/api/query/events") {
      return createNoStoreJsonResponse(200, loadStructuredRuntimeState(stateDir).events);
    }

    if (method === "GET" && pathname === "/api/query/reviews") {
      return createNoStoreJsonResponse(200, loadStructuredRuntimeState(stateDir).reviews);
    }

    if (method === "GET" && pathname === "/api/query/leases") {
      return createNoStoreJsonResponse(200, loadStructuredRuntimeState(stateDir).leases ?? []);
    }

    if (method === "GET" && pathname === "/api/query/artifacts") {
      return createNoStoreJsonResponse(200, loadStructuredRuntimeState(stateDir).artifactBundles ?? []);
    }

    if (method === "GET" && pathname === "/api/query/dashboard-snapshot") {
      return createNoStoreJsonResponse(200, buildStructuredDashboardSnapshot(stateDir));
    }

    const artifactMatch = method === "GET"
      ? pathname.match(/^\/api\/artifacts\/([^/]+)$/)
      : null;
    if (artifactMatch) {
      const bundleId = decodeURIComponent(artifactMatch[1]);
      const state = loadRuntimeState(stateDir);
      const artifact = (state.artifactBundles ?? []).find((candidate) => candidate.bundleId === bundleId);
      return artifact
        ? createNoStoreJsonResponse(200, artifact)
        : createNoStoreJsonResponse(404, { error: "artifact_not_found" });
    }

    if (method === "GET" && pathname === "/api/query/projection-health") {
      return createNoStoreJsonResponse(200, readStructuredProjectionHealth(stateDir));
    }

    if (method === "POST" && pathname === "/api/workers/register") {
      try {
        const validatedBody = validateWorkerRegisterBody(body);
        const result = withState(stateDir, (state) => {
          const nextState = reconcileRuntimeState(registerWorker(state, validatedBody), {
            now: validatedBody.at,
          });
          return {
            state: nextState,
          };
        });
        return createJsonResponse(200, {
          status: "registered",
          workers: result.state.workers,
        });
      } catch (error: any) {
        rethrowStateLockTimeout(error);
        return createJsonResponse(error?.status ?? 500, {
          error: error instanceof Error ? error.message : String(error),
        });
      }
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

    const offlineMatch = method === "POST"
      ? pathname.match(/^\/api\/workers\/([^/]+)\/offline$/)
      : null;
    if (offlineMatch) {
      const result = withState(stateDir, (state) => ({
        state: markWorkerOffline(state, {
          workerId: decodeURIComponent(offlineMatch[1]),
          at: body.at,
          reason: typeof body.reason === "string" ? body.reason : null,
        }),
      }));
      return createJsonResponse(200, {
        status: "offline",
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
      try {
        const validatedBody = validateWorkerStartBody(body);
        const result = withState(stateDir, (state) => ({
          state: beginTaskForWorker(state, {
            workerId: decodeURIComponent(startMatch[1]),
            taskId: validatedBody.taskId,
            attemptId: validatedBody.attemptId,
            leaseToken: validatedBody.leaseToken,
            at: validatedBody.at,
          }),
        }));
        return createJsonResponse(200, {
          status: "started",
          tasks: result.state.tasks,
        });
      } catch (error: any) {
        rethrowStateLockTimeout(error);
        return createJsonResponse(classifyWorkerResultError(error), {
          error: error instanceof Error ? error.message : String(error),
        });
      }
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
            attemptId: validatedBody.attemptId,
            leaseToken: validatedBody.leaseToken,
            result: validatedBody.result,
            changedFiles: validatedBody.changedFiles,
            artifactBundle: validatedBody.artifactBundle,
            pullRequest: validatedBody.pullRequest,
          }),
        }));
        return createJsonResponse(200, {
          status: "result_recorded",
          tasks: result.state.tasks,
        });
      } catch (error: any) {
        rethrowStateLockTimeout(error);
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
      } catch (error: any) {
        rethrowStateLockTimeout(error);
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
          task: result.state.tasks.find((candidate: Task) => candidate.id === taskId) ?? null,
          workers: result.state.workers,
        });
      } catch (error: any) {
        rethrowStateLockTimeout(error);
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
            const task = dispatchResult.state.tasks.find((t: Task) => t.id === assignment.taskId);
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
      } catch (error: any) {
        rethrowStateLockTimeout(error);
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
      } catch (err: any) {
        rethrowStateLockTimeout(err);
        console.error("[dispatcher-server] handleTraeRoute error:", err);
        const status = typeof err?.status === "number" ? err.status : 500;
        return createJsonResponse(status, { error: err instanceof Error ? err.message : String(err) });
      }
    }

    return createJsonResponse(404, {
      error: "not_found",
    });
  } catch (error: any) {
    if (error?.code === "state_lock_timeout") {
      stateLockTimeoutCount += 1;
    }
    const status = typeof error?.status === "number" ? error.status : 500;
    return createJsonResponse(status, {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function startDispatcherServer(input: { host?: string; port?: number; stateDir: string }) {
  const host = input.host ?? "127.0.0.1";
  const port = input.port ?? 8787;
  const stateDir = input.stateDir;

  const server = http.createServer(async (request, response) => {
    const requestUrl = new URL(request.url ?? "/", `http://${request.headers.host ?? `${host}:${port}`}`);
    const clientAddress = request.socket.remoteAddress;
    const method = request.method ?? "GET";
    const pathname = requestUrl.pathname;
    const authHeader = request.headers.authorization;

    try {
      const authError = createAuthMiddleware({ method, pathname, authHeader, clientAddress });
      if (authError) {
        sendJson(response, authError.status, { error: authError.error });
        return;
      }

      const body = method === "POST" ? await readJsonBody(request) : undefined;
      const handled = handleDispatcherHttpRequest({
        stateDir,
        method,
        pathname,
        body,
        authHeader,
        clientAddress,
        internalCall: true,
      });
      if (handled.headers["content-type"]?.startsWith("text/html")) {
        sendHtml(response, handled.text, handled.headers);
      } else {
        sendJson(response, handled.status, handled.json, handled.headers);
      }
    } catch (error: any) {
      if (error?.code === "payload_too_large") {
        sendJson(response, error.status ?? 413, {
          error: "payload_too_large",
        });
        return;
      }
      if (error?.code === "invalid_json_body") {
        sendJson(response, error.status ?? 400, {
          error: "invalid_json_body",
        });
        return;
      }
      sendJson(response, 500, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  await new Promise<void>((resolve) => {
    server.listen(port, host, () => resolve());
  });

  const address = server.address();
  const resolvedPort = typeof address === "object" && address ? address.port : port;

  return {
    server,
    host,
    port: resolvedPort,
    baseUrl: `http://${host}:${resolvedPort}`,
    close: () => new Promise<void>((resolve, reject) => {
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
