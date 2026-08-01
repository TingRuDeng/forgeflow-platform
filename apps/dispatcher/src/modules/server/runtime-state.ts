import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

import { jsonStore } from "./runtime-state-json.js";
import {
  loadRuntimeStateFromPostgres,
  saveRuntimeStateToPostgres,
} from "./runtime-state-postgres.js";
import {
  DEFAULT_LEASE_TTL_MS,
  acquireLease,
  getActiveLease,
  listActiveLeases,
  reclaimExpiredLeases,
  releaseLease,
} from "./leases.js";
import { sqliteStore } from "./runtime-state-sqlite.js";
import type { RuntimeStateStore } from "./runtime-state-store.js";
import type { LeaseResourceType, RuntimeLease } from "./leases.js";
import {
  ArtifactBundleSchema,
  resolveWorkerFailure,
  type ArtifactBundle,
  type ReviewFreshness,
  type ResolvedWorkerFailure,
} from "@forgeflow/result-contracts";
import type {
  ReviewDecisionEvidence,
  WorkerEvidence,
} from "./runtime-glue-types.js";
import {
  assessReviewRisk,
  resolveReviewMergeGateMode,
  resolveReviewRiskConfig,
  type ReviewRiskAssessment,
} from "./review-risk.js";
import {
  evaluateDispatchQuality,
  resolveDispatchQualityConfig,
} from "./dispatch-quality.js";
import { validateResumePayloadAgainstSchema } from "./runtime-state-hitl.js";
import {
  appendRuntimeEvent,
  describeRuntimeEventWindow,
} from "./runtime-events.js";
import { compareTimestampAsc, formatLocalTimestamp } from "../time.js";

const defaultStore: RuntimeStateStore = sqliteStore;

const RUNTIME_STATE_BACKEND_ENV = "RUNTIME_STATE_BACKEND";
const DEFAULT_MAX_TASK_ATTEMPTS = 2;
const ATTEMPT_LEASE_EXPIRED_CODE = "attempt_lease_expired";
const WORKER_PROTOCOL_VERSION = "2026-05-v1";
const REDRIVEABLE_FAILURE_CODES = new Set([
  "worktree_mismatch",
  "branch_mismatch",
  "preflight_workspace_mismatch",
  "workspace_prepare_failed",
  "transient_gateway_timeout",
  "transient_model_3003",
  "artifact_remote_unverified",
  "prompt_contract_mismatch",
  "delivery_failed",
  ATTEMPT_LEASE_EXPIRED_CODE,
]);
const REDRIVEABLE_FAILURE_PATTERNS: Array<{ code: string; patterns: RegExp[] }> = [
  {
    code: "worktree_mismatch",
    patterns: [/worktree[_ ]mismatch/i, /workspace.*worktree.*mismatch/i, /worktree.*workspace.*mismatch/i],
  },
  {
    code: "branch_mismatch",
    patterns: [/branch[_ ]mismatch/i, /workspace.*branch.*mismatch/i, /branch.*workspace.*mismatch/i],
  },
  {
    code: "preflight_workspace_mismatch",
    patterns: [/preflight.*workspace.*mismatch/i, /workspace.*preflight.*mismatch/i],
  },
  {
    code: "workspace_prepare_failed",
    patterns: [/workspace_prepare_failed/i],
  },
  {
    code: "transient_gateway_timeout",
    patterns: [/request timeout/i, /gateway is not ready/i, /timed out/i],
  },
  {
    code: "transient_model_3003",
    patterns: [/\b3003\b/],
  },
  {
    code: "artifact_remote_unverified",
    patterns: [/artifact not reviewable/i, /remote artifact/i, /remote verification failed/i],
  },
  {
    code: "prompt_contract_mismatch",
    patterns: [/template echo/i, /task id mismatch/i, /required template/i, /placeholder/i],
  },
  {
    code: "delivery_failed",
    patterns: [/delivery_failed/i, /submit result.*failed/i],
  },
  {
    code: ATTEMPT_LEASE_EXPIRED_CODE,
    patterns: [/attempt lease expired/i],
  },
];

export class InvalidDispatchInputError extends Error {
  readonly code = "invalid_dispatch_input";
}

function resolveStore(): RuntimeStateStore {
  if (process.env[RUNTIME_STATE_BACKEND_ENV] === "json") {
    return jsonStore;
  }
  return defaultStore;
}

export function isRuntimeStatePostgresBackend(): boolean {
  return process.env[RUNTIME_STATE_BACKEND_ENV] === "postgres";
}

export function isRuntimeStateJsonBackend(): boolean {
  return process.env[RUNTIME_STATE_BACKEND_ENV] === "json";
}

export function createEmptyRuntimeState(): RuntimeState {
  return resolveStore().createEmpty();
}

export function loadRuntimeState(stateDir: string): RuntimeState {
  if (isRuntimeStatePostgresBackend()) {
    throw new Error("RUNTIME_STATE_BACKEND=postgres requires loadRuntimeStateAsync");
  }
  return resolveStore().load(stateDir);
}

export function saveRuntimeState(stateDir: string, state: RuntimeState): void {
  if (isRuntimeStatePostgresBackend()) {
    throw new Error("RUNTIME_STATE_BACKEND=postgres requires saveRuntimeStateAsync");
  }
  return resolveStore().save(stateDir, state);
}

export async function loadRuntimeStateAsync(stateDir: string): Promise<RuntimeState> {
  if (isRuntimeStatePostgresBackend()) {
    return loadRuntimeStateFromPostgres(stateDir);
  }
  return loadRuntimeState(stateDir);
}

export async function saveRuntimeStateAsync(stateDir: string, state: RuntimeState): Promise<void> {
  if (isRuntimeStatePostgresBackend()) {
    await saveRuntimeStateToPostgres(stateDir, state);
    return;
  }
  saveRuntimeState(stateDir, state);
}

export type WorkerStatus = "idle" | "busy" | "offline" | "disabled";

export type TaskStatus = "planned" | "ready" | "assigned" | "in_progress" | "waiting_for_input" | "review" | "merged" | "blocked" | "failed" | "cancelled";

export type AssignmentStatus = "pending" | "assigned" | "in_progress" | "waiting_for_input" | "review" | "merged" | "blocked" | "failed" | "cancelled";

export type ReviewDecision = "pending" | "merge" | "block" | "rework" | "changes_requested";

export type PullRequestStatus = "opened" | "merged" | "changes_requested";
export type WorkerRuntime = "codex" | "gemini" | "trae" | "custom";
export type TaskAttemptStatus =
  | "created"
  | "leased"
  | "starting"
  | "running"
  | "checkpointed"
  | "result_submitted"
  | "succeeded"
  | "failed"
  | "expired"
  | "cancelled"
  | "superseded";

export interface Worker {
  id: string;
  pool: string;
  hostname: string;
  labels: string[];
  repoDir: string;
  status: WorkerStatus;
  lastHeartbeatAt: string;
  currentTaskId?: string;
  disabledAt?: string | null;
  disabledBy?: string | null;
}

export interface Task {
  id: string;
  externalTaskId: string;
  traceId?: string | null;
  repo: string;
  defaultBranch: string;
  title: string;
  pool: string;
  allowedPaths: string[];
  acceptance: string[];
  dependsOn: string[];
  branchName: string;
  targetWorkerId?: string | null;
  verification: {
    mode: "run" | "review";
  };
  terminationPolicy?: {
    maxAttempts?: number;
    attemptLeaseTimeoutMs?: number;
    heartbeatTimeoutMs?: number;
    assignmentTimeoutMs?: number;
  };
  chatMode?: string;
  continuationMode?: string;
  continueFromTaskId?: string | null;
  followUpOfTaskId?: string | null;
  workerChangeReason?: string | null;
  waitingForInput?: {
    requestId?: string;
    attemptId?: string;
    sourceSessionId?: string;
    requestedBy: string;
    reason?: string;
    requestedAt: string;
    expiresAt?: string;
    resumePayloadSchema?: ResumePayloadSchema;
  } | null;
  resumePayload?: Record<string, unknown> | null;
  lastResolvedInput?: {
    requestId: string;
    attemptId?: string;
    resolvedBy: string;
    resolvedAt: string;
    resumePayload: Record<string, unknown> | null;
  };
  status: TaskStatus;
  assignedWorkerId?: string | null;
  lastAssignedWorkerId?: string | null;
  requestedBy: string;
  createdAt: string;
}

export interface ResumePayloadFieldSchema {
  type?: "string" | "number" | "integer" | "boolean" | "array";
  title?: string;
  description?: string;
  enum?: string[];
  default?: unknown;
  format?: "text" | "textarea";
  placeholder?: string;
  minimum?: number;
  maximum?: number;
  minItems?: number;
  maxItems?: number;
  items?: {
    type?: "string";
    enum?: string[];
  };
}

export interface ResumePayloadSchema {
  properties?: Record<string, ResumePayloadFieldSchema>;
  required?: string[];
}

export interface Event {
  eventId?: string;
  auditSequence?: number;
  taskId: string;
  type: string;
  at: string;
  summary?: string | null;
  payload?: unknown;
}

export interface TaskAttempt {
  attemptId: string;
  taskId: string;
  attemptNo: number;
  workerId: string;
  workerRuntime: WorkerRuntime;
  protocolVersion: "2026-05-v1";
  leaseToken: string;
  status: TaskAttemptStatus;
  traceId: string;
  startedAt?: string;
  heartbeatAt?: string;
  leaseExpiresAt?: string;
  endedAt?: string;
  failureCode?: string;
  failureMessage?: string;
  artifactBundleId?: string;
  idempotencyKey: string;
}

export interface AssignmentPayload {
  taskId: string;
  traceId?: string | null;
  workerId?: string | null;
  pool: string;
  status: AssignmentStatus;
  branchName: string;
  allowedPaths?: string[];
  commands?: Record<string, string>;
  repo: string;
  defaultBranch: string;
  targetWorkerId?: string | null;
  chatMode?: string;
  continuationMode?: string;
  continueFromTaskId?: string | null;
  followUpOfTaskId?: string | null;
  workerChangeReason?: string | null;
  resumePayload?: Record<string, unknown> | null;
}

export interface Assignment {
  taskId: string;
  workerId?: string | null;
  pool: string;
  status: AssignmentStatus;
  assignment: AssignmentPayload;
  workerPrompt?: string;
  contextMarkdown?: string;
  workerPromptMode?: "auto" | "custom";
  reportSchemaVersion?: "trae-v1";
  assignedAt?: string | null;
  claimedAt?: string | null;
}

export interface ReviewMaterial {
  repo: string;
  title: string;
  changedFiles: string[];
  selfTestPassed: boolean;
  checks: string[];
  freshness: ReviewFreshness;
  pullRequest?: {
    number: number;
    url: string;
    headBranch: string;
    baseBranch: string;
  } | null;
}

export interface Review {
  taskId: string;
  decision: ReviewDecision;
  actor?: string | null;
  notes: string;
  decidedAt?: string | null;
  reviewMaterial?: ReviewMaterial | null;
  latestWorkerResult?: WorkerResult | null;
  evidence?: ReviewDecisionEvidence | null;
  riskAssessment?: ReviewRiskAssessment | null;
}

export interface PullRequest {
  taskId: string;
  number: number;
  url: string;
  headBranch: string;
  baseBranch: string;
  title: string;
  status: PullRequestStatus;
  createdAt: string;
  updatedAt: string;
}

export interface Dispatch {
  id: string;
  repo: string;
  defaultBranch: string;
  requestedBy: string;
  createdAt: string;
  taskIds: string[];
}

export interface RuntimeState {
  version: number;
  updatedAt: string;
  sequence: number;
  eventSequence?: number;
  workers: Worker[];
  tasks: Task[];
  taskAttempts: TaskAttempt[];
  artifactBundles: ArtifactBundle[];
  events: Event[];
  assignments: Assignment[];
  reviews: Review[];
  pullRequests: PullRequest[];
  dispatches: Dispatch[];
  leases: RuntimeLease[];
}

export interface RegisterWorkerInput {
  workerId: string;
  pool: string;
  hostname: string;
  labels?: string[];
  repoDir?: string;
  at?: string;
}

export interface HeartbeatWorkerInput {
  workerId: string;
  at?: string;
}

export interface CreateDispatchInput {
  repo: string;
  defaultBranch: string;
  requestedBy?: string;
  tasks: Array<{
    id: string;
    title: string;
    pool: string;
    allowedPaths?: string[];
    acceptance?: string[];
    dependsOn?: string[];
    branchName: string;
    targetWorkerId?: string | null;
    target_worker_id?: string | null;
    verification?: {
      mode: "run" | "review";
    };
    terminationPolicy?: Task["terminationPolicy"];
    chatMode?: string;
    continuationMode?: string;
    continueFromTaskId?: string | null;
    followUpOfTaskId?: string | null;
    follow_up_of_task_id?: string | null;
    workerChangeReason?: string | null;
    worker_change_reason?: string | null;
  }>;
  packages: Array<{
    taskId: string;
    assignment: AssignmentPayload;
    workerPrompt?: string;
    contextMarkdown?: string;
    workerPromptMode?: "auto" | "custom";
    reportSchemaVersion?: "trae-v1";
  }>;
  createdAt?: string;
}

export interface CreateDispatchResult {
  state: RuntimeState;
  dispatchId: string;
  taskIds: string[];
  assignments: Array<{
    taskId: string;
    workerId?: string | null;
    status: AssignmentStatus;
  }>;
}

export interface RedriveTaskInput {
  taskId: string;
  requestedBy?: string;
  at?: string;
}

export interface RedriveTaskResult extends CreateDispatchResult {
  originalTaskId: string;
  newTaskId: string;
  targetWorkerId: string | null;
  failureCode: string | null;
  failureSummary: string;
  continuationMode: "continue";
  continueFromTaskId: string;
}

export interface GetAssignedTaskResult {
  task: Task;
  assignment: AssignmentPayload;
  attemptId?: string;
  leaseToken?: string;
  protocolVersion?: string;
  traceId?: string;
  idempotencyKey?: string;
  workerPrompt?: string;
  contextMarkdown?: string;
  workerPromptMode?: "auto" | "custom";
  reportSchemaVersion?: "trae-v1";
  chatMode?: string;
  continuationMode?: string;
  continueFromTaskId?: string | null;
  followUpOfTaskId?: string | null;
  workerChangeReason?: string | null;
  resumePayload?: Record<string, unknown> | null;
}

function withActiveAttemptEnvelope(state: RuntimeState, result: GetAssignedTaskResult): GetAssignedTaskResult {
  const attempt = findActiveTaskAttempt(state, result.task.id);
  if (!attempt) {
    return result;
  }
  return {
    ...result,
    attemptId: attempt.attemptId,
    leaseToken: attempt.leaseToken,
    protocolVersion: attempt.protocolVersion,
    traceId: attempt.traceId,
    idempotencyKey: attempt.idempotencyKey,
  };
}

export interface ClaimAssignedTaskInput {
  workerId: string;
  at?: string;
  heartbeatTimeoutMs?: number;
  assignmentTimeoutMs?: number;
}

export interface ClaimAssignedTaskResult {
  state: RuntimeState;
  assignment: GetAssignedTaskResult | null;
}

export interface BeginTaskInput {
  workerId: string;
  taskId: string;
  attemptId?: string;
  leaseToken?: string;
  protocolVersion?: string;
  traceId?: string;
  idempotencyKey?: string;
  at?: string;
}

export interface WorkerVerificationCommandResult {
  command: string;
  exitCode: number;
  output: string;
}

export interface WorkerResult {
  taskId: string;
  workerId: string;
  provider: string;
  pool: string;
  branchName: string;
  repo: string;
  defaultBranch: string;
  mode: "run" | "review";
  output: string;
  generatedAt: string;
  verification: {
    allPassed: boolean;
    commands: WorkerVerificationCommandResult[];
  };
  evidence?: WorkerEvidence;
  artifactBundle?: ArtifactBundle;
  waitingForInput?: {
    requestId?: string;
    sourceSessionId?: string;
    requestedBy?: string;
    reason?: string;
    prompt?: string;
    expiresAt?: string;
    resumePayloadSchema?: ResumePayloadSchema;
  };
}

export interface RecordWorkerResultInput {
  workerId: string;
  receivedAt: string;
  attemptId?: string;
  leaseToken?: string;
  protocolVersion?: string;
  traceId?: string;
  idempotencyKey?: string;
  result: WorkerResult;
  changedFiles?: string[];
  artifactBundle?: ArtifactBundle;
  pullRequest?: {
    number: number;
    url: string;
    headBranch: string;
    baseBranch: string;
  } | null;
}

export interface RecordReviewDecisionInput {
  taskId: string;
  decision: ReviewDecision;
  actor: string;
  notes?: string;
  at?: string;
  evidence?: ReviewDecisionEvidence;
  expectedFreshness: ReviewFreshness;
  acknowledgeRisk?: boolean;
}

export interface InterruptTaskForInputInput {
  taskId: string;
  actor: string;
  requestId?: string;
  sourceSessionId?: string;
  reason?: string;
  expiresAt?: string;
  resumePayloadSchema?: ResumePayloadSchema;
  at?: string;
}

export interface ResumeTaskFromInputInput {
  taskId: string;
  actor: string;
  requestId?: string;
  attemptId?: string;
  resumePayload?: Record<string, unknown> | null;
  at?: string;
}

export interface RecordWorkerEventInput {
  workerId: string;
  type: string;
  taskId?: string | null;
  at?: string;
  payload?: unknown;
}

export interface CancelTaskInput {
  taskId: string;
  actor: string;
  reason?: string;
  at?: string;
}

export interface ReconcileOptions {
  now?: string;
  heartbeatTimeoutMs?: number;
  assignmentTimeoutMs?: number;
  maxTaskAttempts?: number;
}

export interface TaskRedriveEligibility {
  canRedrive: boolean;
  reason:
    | "recoverable_failure"
    | "review_rework"
    | "already_redriven"
    | "non_redriveable_failure"
    | "review_redrive_disabled"
    | "review_decision_not_redriveable"
    | "state_not_redriveable";
  failureCode: string | null;
  existingTaskId: string | null;
}

export type DashboardTask = Task & {
  redriveEligibility: TaskRedriveEligibility;
};

export interface DashboardSnapshot {
  updatedAt: string;
  stats: {
    workers: {
      total: number;
      idle: number;
      busy: number;
      offline: number;
      disabled: number;
    };
    tasks: {
      total: number;
      ready: number;
      assigned: number;
      inProgress: number;
      review: number;
      merged: number;
      failed: number;
      cancelled: number;
    };
  };
  metrics: {
    queueDepth: number;
    plannedTasks: number;
    reviewBacklog: number;
    avgAssignmentLagMs: number;
    maxAssignmentLagMs: number;
    submitResultRetryCount: number;
    retryRatePct: number;
    deliveryFailedCount: number;
    cleanupFailureCount: number;
    sessionInterruptionCount: number;
    stateLockTimeoutCount: number;
    shadowWriteFailureCount: number;
    branchProtectionHitCount: number;
    leaseConflictCount: number;
    leaseReclaimCount: number;
    activeLeases: {
      total: number;
      byResourceType: Partial<Record<LeaseResourceType, number>>;
    };
    repoConcurrencySaturation: Record<string, {
      activeWorkers: number;
      busyWorkers: number;
      saturationPct: number;
    }>;
    failureCodes: Record<string, number>;
    reviewReasonCodes: Record<string, number>;
    eventWindow: {
      scope: "retained_runtime_events";
      retentionLimit: number;
      retainedCount: number;
      oldestAt: string | null;
      newestAt: string | null;
    };
  };
  workers: Worker[];
  tasks: DashboardTask[];
  taskAttempts: TaskAttempt[];
  artifactBundles: ArtifactBundle[];
  assignments: Assignment[];
  reviews: Review[];
  pullRequests: PullRequest[];
  events: Event[];
  dispatches: Dispatch[];
  leases: RuntimeLease[];
}

function nowIso(): string {
  return formatLocalTimestamp();
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeTimestamp(value: unknown, fallback: string): string {
  if (typeof value !== "string") {
    return fallback;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return fallback;
  }
  return Number.isFinite(Date.parse(trimmed)) ? trimmed : fallback;
}

function normalizeString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function buildTaskTraceId(taskId: string): string {
  const normalized = String(taskId || "").trim().replace(/[^a-zA-Z0-9_-]+/g, "-");
  return `trace-${normalized || "unknown-task"}`;
}

function resolveTaskTraceId(task: Pick<Task, "id" | "traceId"> | null | undefined): string | null {
  if (!task) {
    return null;
  }
  const traceId = normalizeString(task.traceId).trim();
  return traceId || buildTaskTraceId(task.id);
}

function summarizeEvent(type: string, payload: unknown): string | null {
  const record = isRecord(payload) ? payload : null;
  const data = isRecord(record?.data) ? record?.data : null;
  const message = normalizeString(record?.message).trim() || normalizeString(data?.message).trim();
  if (message) {
    return message;
  }

  const failureSummary = normalizeString(record?.failureSummary).trim()
    || normalizeString(data?.failureSummary).trim();
  if (failureSummary) {
    return failureSummary;
  }

  if (type === "status_changed") {
    const from = normalizeString(record?.from).trim();
    const to = normalizeString(record?.to).trim();
    if (from || to) {
      return `${from || "unknown"} -> ${to || "unknown"}`;
    }
  }

  if (type === "review_decided") {
    const decision = normalizeString(record?.decision).trim();
    const actor = normalizeString(record?.actor).trim();
    if (decision) {
      return actor ? `${decision} by ${actor}` : decision;
    }
  }

  if (type === "review_risk_flagged") {
    const level = normalizeString(record?.level).trim();
    if (level) {
      const count = record?.changedFileCount;
      return typeof count === "number" ? `${level} (${count} files)` : level;
    }
  }

  if (type === "dispatch_quality_flagged") {
    const riskTier = normalizeString(record?.riskTier).trim();
    const violations = Array.isArray(record?.violations) ? record?.violations.length : 0;
    if (riskTier || violations) {
      return `${riskTier || "standard"}${violations ? ` (${violations} violations)` : ""}`;
    }
  }

  if (type === "review_merge_risk_acknowledged") {
    const level = normalizeString(record?.level).trim();
    const acknowledged = record?.acknowledged === true;
    if (level) {
      return `${level} merge ${acknowledged ? "acknowledged" : "(warn)"}`;
    }
  }

  const failureCode = normalizeString(record?.failureCode).trim() || normalizeString(data?.failureCode).trim();
  if (failureCode) {
    return failureCode;
  }

  const sessionId = normalizeString(record?.sessionId).trim() || normalizeString(data?.sessionId).trim();
  const traceId = normalizeString(record?.traceId).trim() || normalizeString(data?.traceId).trim();
  if (sessionId || traceId) {
    return [sessionId ? `session=${sessionId}` : "", traceId ? `trace=${traceId}` : ""]
      .filter(Boolean)
      .join(" ");
  }

  return null;
}

function normalizeVerificationCommands(value: unknown): WorkerVerificationCommandResult[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const commands: WorkerVerificationCommandResult[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) {
      continue;
    }

    const command = normalizeString(entry.command).trim();
    const output = normalizeString(entry.output);
    const exitCodeRaw = entry.exitCode;
    const exitCode = typeof exitCodeRaw === "number"
      ? exitCodeRaw
      : typeof exitCodeRaw === "string" && exitCodeRaw.trim()
        ? Number(exitCodeRaw)
        : Number.NaN;
    if (!command || !Number.isInteger(exitCode)) {
      continue;
    }

    commands.push({
      command,
      exitCode,
      output,
    });
  }

  return commands;
}

function normalizeWorkerEvidence(value: unknown): WorkerEvidence | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  return clone(value) as WorkerEvidence;
}

function assertWorkerResultMatchesTask(
  task: Task,
  workerId: string,
  result: Record<string, unknown>,
): void {
  const rawTaskId = normalizeString(result.taskId).trim();
  if (!rawTaskId) {
    throw new Error("worker result taskId is required");
  }
  if (rawTaskId !== task.id) {
    throw new Error(`worker result taskId mismatch for ${task.id}`);
  }

  const rawWorkerId = normalizeString(result.workerId).trim();
  if (rawWorkerId && rawWorkerId !== workerId) {
    throw new Error(`worker result workerId mismatch for ${task.id}`);
  }

  const rawPool = normalizeString(result.pool).trim();
  if (rawPool && rawPool !== task.pool) {
    throw new Error(`worker result pool mismatch for ${task.id}`);
  }

  const rawRepo = normalizeString(result.repo).trim();
  if (rawRepo && rawRepo !== task.repo) {
    throw new Error(`worker result repo mismatch for ${task.id}`);
  }

  const rawDefaultBranch = normalizeString(result.defaultBranch).trim();
  if (rawDefaultBranch && rawDefaultBranch !== task.defaultBranch) {
    throw new Error(`worker result defaultBranch mismatch for ${task.id}`);
  }

  const rawBranchName = normalizeString(result.branchName).trim();
  if (rawBranchName && rawBranchName !== task.branchName) {
    throw new Error(`worker result branchName mismatch for ${task.id}`);
  }
}

function canonicalizePullRequest(
  task: Task,
  pullRequest?: {
    number: number;
    url: string;
    headBranch: string;
    baseBranch: string;
  } | null,
): {
  number: number;
  url: string;
  headBranch: string;
  baseBranch: string;
} | null {
  if (!pullRequest) {
    return null;
  }

  if (
    !Number.isInteger(pullRequest.number)
    || pullRequest.number <= 0
    || !pullRequest.url
  ) {
    throw new Error(`pull request metadata invalid for ${task.id}`);
  }

  if (
    pullRequest.headBranch !== task.branchName
    || pullRequest.baseBranch !== task.defaultBranch
  ) {
    throw new Error(`pull request metadata mismatch for ${task.id}`);
  }

  return {
    number: pullRequest.number,
    url: pullRequest.url,
    headBranch: task.branchName,
    baseBranch: task.defaultBranch,
  };
}

function buildCanonicalWorkerResult(task: Task, workerId: string, result: WorkerResult): WorkerResult {
  const rawResult: Record<string, unknown> = isRecord(result) ? result : {};
  assertWorkerResultMatchesTask(task, workerId, rawResult);

  const verification: Record<string, unknown> = isRecord(rawResult.verification)
    ? rawResult.verification
    : {};
  const commands = normalizeVerificationCommands(verification.commands);
  const allPassed = verification.allPassed === true;
  const generatedAt = normalizeTimestamp(rawResult.generatedAt, nowIso());

  return {
    taskId: task.id,
    workerId,
    provider: normalizeString(rawResult.provider, task.pool) || task.pool,
    pool: task.pool,
    branchName: task.branchName,
    repo: task.repo,
    defaultBranch: task.defaultBranch,
    mode: task.verification.mode,
    output: normalizeString(rawResult.output),
    generatedAt,
    verification: {
      allPassed,
      commands,
    },
    evidence: normalizeWorkerEvidence(rawResult.evidence),
    waitingForInput: normalizeWaitingForInput(rawResult.waitingForInput, workerId, normalizeString(rawResult.output)),
  };
}

function normalizeWaitingForInput(value: unknown, workerId: string, fallbackReason: string): WorkerResult["waitingForInput"] {
  if (!isRecord(value)) {
    return undefined;
  }
  const reason = normalizeString(value.reason, fallbackReason).trim();
  const prompt = normalizeString(value.prompt).trim();
  const requestId = normalizeString(value.requestId).trim();
  const sourceSessionId = normalizeString(value.sourceSessionId).trim();
  const expiresAt = normalizeString(value.expiresAt).trim();
  const resumePayloadSchema = normalizeResumePayloadSchema(value.resumePayloadSchema);
  return {
    ...(requestId ? { requestId } : {}),
    ...(sourceSessionId ? { sourceSessionId } : {}),
    requestedBy: normalizeString(value.requestedBy, workerId).trim() || workerId,
    reason: reason || fallbackReason || "worker requested input",
    ...(prompt ? { prompt } : {}),
    ...(expiresAt ? { expiresAt } : {}),
    ...(resumePayloadSchema ? { resumePayloadSchema } : {}),
  };
}

function normalizeResumePayloadSchema(value: unknown): ResumePayloadSchema | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const properties = normalizeResumePayloadProperties(value.properties);
  const required = Array.isArray(value.required)
    ? value.required.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : undefined;
  return properties || required?.length ? { ...(properties ? { properties } : {}), ...(required?.length ? { required } : {}) } : undefined;
}

function normalizeResumePayloadProperties(value: unknown): Record<string, ResumePayloadFieldSchema> | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const entries = Object.entries(value)
    .map(([name, field]) => [name, normalizeResumePayloadField(field)] as const)
    .filter((entry): entry is readonly [string, ResumePayloadFieldSchema] => Boolean(entry[1]));
  return entries.length ? Object.fromEntries(entries) : undefined;
}

function normalizeResumePayloadField(value: unknown): ResumePayloadFieldSchema | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const field: ResumePayloadFieldSchema = {};
  if (["string", "number", "integer", "boolean", "array"].includes(String(value.type))) {
    field.type = value.type as ResumePayloadFieldSchema["type"];
  }
  if (typeof value.title === "string") field.title = value.title;
  if (typeof value.description === "string") field.description = value.description;
  if (Array.isArray(value.enum)) {
    const enumValues = value.enum.filter((item): item is string => typeof item === "string");
    if (enumValues.length > 0) field.enum = enumValues;
  }
  if (value.default !== undefined) field.default = value.default;
  if (value.format === "text" || value.format === "textarea") field.format = value.format;
  if (typeof value.placeholder === "string") field.placeholder = value.placeholder;
  if (typeof value.minimum === "number" && Number.isFinite(value.minimum)) field.minimum = value.minimum;
  if (typeof value.maximum === "number" && Number.isFinite(value.maximum)) field.maximum = value.maximum;
  if (typeof value.minItems === "number" && Number.isInteger(value.minItems) && value.minItems >= 0) field.minItems = value.minItems;
  if (typeof value.maxItems === "number" && Number.isInteger(value.maxItems) && value.maxItems >= 0) field.maxItems = value.maxItems;
  if (isRecord(value.items)) {
    const items: ResumePayloadFieldSchema["items"] = {};
    if (value.items.type === "string") items.type = "string";
    if (Array.isArray(value.items.enum)) {
      const enumValues = value.items.enum.filter((item): item is string => typeof item === "string");
      if (enumValues.length > 0) items.enum = enumValues;
    }
    if (Object.keys(items).length > 0) field.items = items;
  }
  return Object.keys(field).length ? field : undefined;
}

function resolveSourceTaskForFollowUp(state: RuntimeState, followUpOfTaskId: string) {
  const sourceTask = state.tasks.find((task) => task.id === followUpOfTaskId);
  if (!sourceTask) {
    throw new Error(`follow-up source task not found: ${followUpOfTaskId}`);
  }
  const sourceAssignment = state.assignments.find((assignment) => assignment.taskId === followUpOfTaskId);
  const sourceWorkerId = sourceTask.lastAssignedWorkerId
    ?? sourceTask.assignedWorkerId
    ?? sourceAssignment?.assignment.targetWorkerId
    ?? sourceAssignment?.workerId
    ?? null;

  return {
    sourceTask,
    sourceWorkerId,
  };
}

function nextDispatchId(state: RuntimeState): { state: RuntimeState; dispatchId: string } {
  const next = (state.sequence ?? 0) + 1;
  return {
    state: {
      ...state,
      sequence: next,
    },
    dispatchId: `dispatch-${next}`,
  };
}

function appendEvent(state: RuntimeState, event: Event): RuntimeState {
  const nextEvent: Event = {
    ...event,
    summary: event.summary ?? summarizeEvent(event.type, event.payload),
  };
  return appendRuntimeEvent(state, nextEvent);
}

function countEventsByType(events: Event[], type: string): number {
  return events.filter((event) => event.type === type).length;
}

function countActiveLeasesByResourceType(leases: RuntimeLease[], at: string): Partial<Record<LeaseResourceType, number>> {
  const counts: Partial<Record<LeaseResourceType, number>> = {};

  for (const lease of listActiveLeases(leases, at)) {
    counts[lease.resourceType] = (counts[lease.resourceType] ?? 0) + 1;
  }

  return counts;
}

function countFailureCodes(reviews: Review[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const review of reviews) {
    const blockers = Array.isArray(review.latestWorkerResult?.evidence?.blockers)
      ? review.latestWorkerResult?.evidence?.blockers
      : [];
    for (const blocker of blockers) {
      const code = normalizeString((blocker as { code?: unknown }).code).trim();
      if (!code) {
        continue;
      }
      counts[code] = (counts[code] ?? 0) + 1;
    }
  }
  return counts;
}

function computeRepoConcurrencySaturation(workers: Worker[]): Record<string, {
  activeWorkers: number;
  busyWorkers: number;
  saturationPct: number;
}> {
  const grouped = new Map<string, { activeWorkers: number; busyWorkers: number }>();

  for (const worker of workers) {
    if (worker.disabledAt) {
      continue;
    }

    const repoDir = normalizeString(worker.repoDir).trim();
    if (!repoDir) {
      continue;
    }

    const entry = grouped.get(repoDir) ?? { activeWorkers: 0, busyWorkers: 0 };
    if (worker.status === "idle" || worker.status === "busy") {
      entry.activeWorkers += 1;
    }
    if (worker.status === "busy") {
      entry.busyWorkers += 1;
    }
    grouped.set(repoDir, entry);
  }

  return Object.fromEntries(
    [...grouped.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([repoDir, entry]) => {
        const saturationPct = entry.activeWorkers > 0
          ? Number(((entry.busyWorkers / entry.activeWorkers) * 100).toFixed(1))
          : 0;
        return [repoDir, {
          activeWorkers: entry.activeWorkers,
          busyWorkers: entry.busyWorkers,
          saturationPct,
        }];
      }),
  );
}

function countReviewReasonCodes(reviews: Review[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const review of reviews) {
    const code = normalizeString(review.evidence?.reasonCode).trim();
    if (!code) {
      continue;
    }
    counts[code] = (counts[code] ?? 0) + 1;
  }
  return counts;
}

function computeRetryRatePct(tasks: Task[], events: Event[]): number {
  const terminalTasks = tasks.filter((task) =>
    ["review", "merged", "blocked", "failed", "cancelled"].includes(task.status)
  ).length;
  if (terminalTasks === 0) {
    return 0;
  }
  const retryCount = countEventsByType(events, "submit_result_retry_failed");
  return Number(((retryCount / terminalTasks) * 100).toFixed(2));
}

function backfillTraceMetadata(state: RuntimeState, at: string): RuntimeState {
  let changed = false;

  const tasks = state.tasks.map((task) => {
    const traceId = resolveTaskTraceId(task);
    if (task.traceId === traceId) {
      return task;
    }
    changed = true;
    return {
      ...task,
      traceId,
    };
  });

  const assignments = state.assignments.map((assignment) => {
    const task = tasks.find((candidate) => candidate.id === assignment.taskId);
    const traceId = resolveTaskTraceId(task);
    if ((assignment.assignment.traceId ?? null) === traceId) {
      return assignment;
    }
    changed = true;
    return {
      ...assignment,
      assignment: {
        ...assignment.assignment,
        traceId,
      },
    };
  });

  if (!changed) {
    return state;
  }

  return {
    ...state,
    updatedAt: at,
    tasks,
    assignments,
  };
}

function upsertWorker(workers: Worker[], worker: Worker): Worker[] {
  const existingIndex = workers.findIndex((candidate) => candidate.id === worker.id);
  if (existingIndex === -1) {
    return [...workers, worker];
  }

  const next = [...workers];
  next[existingIndex] = worker;
  return next;
}

function upsertTask(tasks: Task[], task: Task): Task[] {
  const existingIndex = tasks.findIndex((candidate) => candidate.id === task.id);
  if (existingIndex === -1) {
    return [...tasks, task];
  }

  const next = [...tasks];
  next[existingIndex] = task;
  return next;
}

export function upsertReview(reviews: Review[], review: Review): Review[] {
  const existingIndex = reviews.findIndex((candidate) => candidate.taskId === review.taskId);
  if (existingIndex === -1) {
    return [...reviews, review];
  }

  const next = [...reviews];
  next[existingIndex] = {
    ...next[existingIndex],
    ...review,
  };
  return next;
}

function upsertPullRequest(pullRequests: PullRequest[], pullRequest: PullRequest): PullRequest[] {
  const existingIndex = pullRequests.findIndex((candidate) => candidate.taskId === pullRequest.taskId);
  if (existingIndex === -1) {
    return [...pullRequests, pullRequest];
  }

  const next = [...pullRequests];
  next[existingIndex] = {
    ...next[existingIndex],
    ...pullRequest,
  };
  return next;
}

function upsertAssignment(assignments: Assignment[], assignment: Assignment): Assignment[] {
  const existingIndex = assignments.findIndex((candidate) => candidate.taskId === assignment.taskId);
  if (existingIndex === -1) {
    return [...assignments, assignment];
  }

  const next = [...assignments];
  next[existingIndex] = assignment;
  return next;
}

function isTerminalAttemptStatus(status: TaskAttemptStatus): boolean {
  return ["succeeded", "failed", "expired", "cancelled", "superseded"].includes(status);
}

function resolveWorkerRuntime(pool: string): WorkerRuntime {
  return pool === "codex" || pool === "gemini" || pool === "trae" ? pool : "custom";
}

function findActiveTaskAttempt(state: RuntimeState, taskId: string): TaskAttempt | null {
  return (state.taskAttempts ?? []).find((attempt) =>
    attempt.taskId === taskId && !isTerminalAttemptStatus(attempt.status)) ?? null;
}

function upsertTaskAttempt(attempts: TaskAttempt[], attempt: TaskAttempt): TaskAttempt[] {
  const existingIndex = attempts.findIndex((candidate) => candidate.attemptId === attempt.attemptId);
  if (existingIndex === -1) {
    return [...attempts, attempt];
  }

  const next = [...attempts];
  next[existingIndex] = attempt;
  return next;
}

function createOrReuseTaskAttempt(
  state: RuntimeState,
  task: Task,
  workerId: string,
  at: string,
): RuntimeState {
  const activeAttempt = findActiveTaskAttempt(state, task.id);
  const leaseExpiresAt = new Date(Date.parse(at) + resolveAttemptLeaseTimeoutMs(task)).toISOString();
  if (activeAttempt) {
    const resumesCheckpointedAttempt = activeAttempt.status === "checkpointed";
    return {
      ...state,
      taskAttempts: upsertTaskAttempt(state.taskAttempts ?? [], {
        ...activeAttempt,
        workerId,
        leaseToken: `assignment:${workerId}`,
        status: activeAttempt.status === "created" || resumesCheckpointedAttempt
          ? "leased"
          : activeAttempt.status,
        heartbeatAt: at,
        leaseExpiresAt,
        endedAt: resumesCheckpointedAttempt ? undefined : activeAttempt.endedAt,
      }),
    };
  }

  const attemptNo = (state.taskAttempts ?? []).filter((attempt) => attempt.taskId === task.id).length + 1;
  const attemptId = `${task.id}:attempt-${attemptNo}`;
  return {
    ...state,
    taskAttempts: upsertTaskAttempt(state.taskAttempts ?? [], {
      attemptId,
      taskId: task.id,
      attemptNo,
      workerId,
      workerRuntime: resolveWorkerRuntime(task.pool),
      protocolVersion: "2026-05-v1",
      leaseToken: `assignment:${workerId}`,
      status: "leased",
      traceId: resolveTaskTraceId(task) ?? buildTaskTraceId(task.id),
      heartbeatAt: at,
      leaseExpiresAt,
      idempotencyKey: `worker-v1:${task.id}:attempt-${attemptNo}`,
    }),
  };
}

function updateActiveTaskAttempt(
  state: RuntimeState,
  taskId: string,
  update: (attempt: TaskAttempt) => TaskAttempt,
): RuntimeState {
  const activeAttempt = findActiveTaskAttempt(state, taskId);
  if (!activeAttempt) {
    return state;
  }
  return {
    ...state,
    taskAttempts: upsertTaskAttempt(state.taskAttempts ?? [], update(activeAttempt)),
  };
}

function upsertArtifactBundle(bundles: ArtifactBundle[] = [], bundle: ArtifactBundle): ArtifactBundle[] {
  const existingIndex = bundles.findIndex((candidate) => candidate.bundleId === bundle.bundleId);
  if (existingIndex < 0) {
    return [...bundles, bundle];
  }
  const next = [...bundles];
  next[existingIndex] = bundle;
  return next;
}

function normalizeArtifactChangedFiles(changedFiles: string[] | undefined): ArtifactBundle["changedFiles"] {
  return (changedFiles ?? []).map((filePath) => ({
    path: filePath,
    changeType: "modified" as const,
  }));
}

function mergeArtifactChangedFiles(
  changedFiles: string[] | undefined,
  bundleChangedFiles: ArtifactBundle["changedFiles"] | undefined,
): ArtifactBundle["changedFiles"] {
  const merged = new Map<string, ArtifactBundle["changedFiles"][number]>();
  for (const entry of bundleChangedFiles ?? []) {
    merged.set(entry.path, entry);
  }
  for (const entry of normalizeArtifactChangedFiles(changedFiles)) {
    if (!merged.has(entry.path)) {
      merged.set(entry.path, entry);
    }
  }
  return [...merged.values()];
}

function buildWorkerResultTrajectory(result: WorkerResult): ArtifactBundle["trajectory"] | undefined {
  const steps = result.verification.commands.map((command, index) => ({
    sequence: index + 1,
    phase: "verification" as const,
    action: command.command,
    observation: command.output,
    status: command.exitCode === 0 ? "succeeded" as const : "failed" as const,
    exitCode: command.exitCode,
  }));
  if (steps.length === 0) {
    return undefined;
  }
  return {
    schemaVersion: "artifact-trajectory/v1",
    steps,
  };
}

function buildArtifactBundle(input: {
  task: Task;
  attempt: TaskAttempt;
  result: WorkerResult;
  artifactBundle?: ArtifactBundle;
  changedFiles?: string[];
  pullRequest: {
    url: string;
  } | null;
}): ArtifactBundle {
  const rawBundle = input.artifactBundle ?? input.result.artifactBundle;
  const bundle = ArtifactBundleSchema.parse({
    taskId: input.task.id,
    attemptId: input.attempt.attemptId,
    schemaVersion: "artifact-bundle/v1",
    refs: {},
    ...rawBundle,
    changedFiles: mergeArtifactChangedFiles(input.changedFiles, rawBundle?.changedFiles),
    trajectory: rawBundle?.trajectory ?? buildWorkerResultTrajectory(input.result),
    bundleId: rawBundle?.bundleId ?? `${input.attempt.attemptId}:artifact-bundle`,
    summary: rawBundle?.summary ?? input.result.output,
    branch: rawBundle?.branch ?? input.task.branchName,
    commit: rawBundle?.commit,
    pullRequestUrl: rawBundle?.pullRequestUrl ?? input.pullRequest?.url,
    createdAt: rawBundle?.createdAt ?? input.result.generatedAt,
  });

  if (bundle.taskId !== input.task.id) {
    throw new Error(`artifact bundle taskId mismatch for ${input.task.id}`);
  }
  if (bundle.attemptId !== input.attempt.attemptId) {
    throw new Error(`artifact bundle attemptId mismatch for ${input.task.id}`);
  }
  return bundle;
}

function assertActiveAttemptLease(input: {
  state: RuntimeState;
  taskId: string;
  workerId: string;
  attemptId?: string;
  leaseToken?: string;
  protocolVersion?: string;
  traceId?: string;
  idempotencyKey?: string;
  operation?: string;
  at?: string;
}): void {
  const declaresV1Envelope = Boolean(input.protocolVersion || input.traceId || input.idempotencyKey);
  const operation = input.operation ?? "write";
  const activeAttempt = findActiveTaskAttempt(input.state, input.taskId);
  const historicalAttempt = input.attemptId
    ? (input.state.taskAttempts ?? []).find((attempt) =>
        attempt.taskId === input.taskId && attempt.attemptId === input.attemptId
      )
    : null;
  if (!activeAttempt) {
    if (historicalAttempt && isTerminalAttemptStatus(historicalAttempt.status)) {
      throw new Error(`stale attempt ${operation} rejected: ${input.attemptId}`);
    }
    throw new Error(`active attempt not found for task: ${input.taskId}`);
  }
  if (declaresV1Envelope || activeAttempt) {
    assertCompleteWorkerProtocolEnvelope(input);
  }
  if (activeAttempt.workerId !== input.workerId) {
    throw new Error(`attempt owned by another worker: ${activeAttempt.workerId}`);
  }
  if (
    historicalAttempt
    && historicalAttempt.attemptId !== activeAttempt.attemptId
    && isTerminalAttemptStatus(historicalAttempt.status)
  ) {
    throw new Error(`stale attempt ${operation} rejected: ${input.attemptId}`);
  }
  if (input.attemptId && input.attemptId !== activeAttempt.attemptId) {
    throw new Error(`attempt id mismatch: ${input.attemptId}`);
  }
  if (input.leaseToken && input.leaseToken !== activeAttempt.leaseToken) {
    throw new Error(`lease token mismatch: ${input.taskId}`);
  }
  if (input.protocolVersion && input.protocolVersion !== activeAttempt.protocolVersion) {
    throw new Error(`protocol version mismatch: ${input.protocolVersion}`);
  }
  if (input.traceId && input.traceId !== activeAttempt.traceId) {
    throw new Error(`trace id mismatch: ${input.taskId}`);
  }
  if (input.idempotencyKey && input.idempotencyKey !== activeAttempt.idempotencyKey) {
    throw new Error(`idempotency key mismatch: ${input.taskId}`);
  }
  if (input.at && isAttemptLeaseExpired(activeAttempt, input.at)) {
    throw new Error(`stale attempt ${operation} rejected: ${activeAttempt.attemptId} lease expired`);
  }
}

function assertCompleteWorkerProtocolEnvelope(input: {
  attemptId?: string;
  leaseToken?: string;
  protocolVersion?: string;
  traceId?: string;
  idempotencyKey?: string;
}): void {
  const missingField = [
    ["protocolVersion", input.protocolVersion],
    ["attemptId", input.attemptId],
    ["leaseToken", input.leaseToken],
    ["traceId", input.traceId],
    ["idempotencyKey", input.idempotencyKey],
  ].find(([, value]) => !value);
  if (missingField) {
    throw new Error(`worker protocol v1 envelope incomplete: ${missingField[0]} required`);
  }
  if (input.protocolVersion !== WORKER_PROTOCOL_VERSION) {
    throw new Error(`unsupported worker protocol version: ${input.protocolVersion || "<empty>"}`);
  }
}

function isIdempotentWorkerResultReplay(
  state: RuntimeState,
  task: Task,
  input: RecordWorkerResultInput,
): boolean {
  if (findActiveTaskAttempt(state, task.id) || !input.attemptId) {
    return false;
  }
  const attempt = (state.taskAttempts ?? []).find((candidate) =>
    candidate.taskId === task.id && candidate.attemptId === input.attemptId
  );
  const recordedReview = state.reviews.find((review) => review.taskId === task.id);
  const latestResult = recordedReview?.latestWorkerResult;
  if (
    !attempt
    || !["succeeded", "failed"].includes(attempt.status)
    || !latestResult
    || latestResult.taskId !== task.id
  ) {
    return false;
  }

  assertCompleteWorkerProtocolEnvelope(input);
  if (attempt.workerId !== input.workerId) {
    throw new Error(`attempt owned by another worker: ${attempt.workerId}`);
  }
  if (input.leaseToken !== attempt.leaseToken) {
    throw new Error(`lease token mismatch: ${task.id}`);
  }
  if (input.protocolVersion !== attempt.protocolVersion) {
    throw new Error(`protocol version mismatch: ${input.protocolVersion}`);
  }
  if (input.traceId !== attempt.traceId) {
    throw new Error(`trace id mismatch: ${task.id}`);
  }
  if (input.idempotencyKey !== attempt.idempotencyKey) {
    throw new Error(`idempotency key mismatch: ${task.id}`);
  }
  if (latestResult.workerId !== input.workerId) {
    throw new Error(`worker result already recorded by another worker: ${latestResult.workerId}`);
  }

  const canonicalResult = buildCanonicalWorkerResult(task, input.workerId, input.result);
  const canonicalPullRequest = canonicalizePullRequest(task, input.pullRequest);
  const storedPullRequest = state.pullRequests.find((candidate) => candidate.taskId === task.id);
  const storedPullRequestInput = storedPullRequest
    ? {
        number: storedPullRequest.number,
        url: storedPullRequest.url,
        headBranch: storedPullRequest.headBranch,
        baseBranch: storedPullRequest.baseBranch,
      }
    : null;
  const replayBundle = buildArtifactBundle({
    task,
    attempt,
    result: canonicalResult,
    artifactBundle: input.artifactBundle ?? input.result.artifactBundle,
    changedFiles: input.changedFiles,
    pullRequest: canonicalPullRequest,
  });
  const storedBundle = (state.artifactBundles ?? []).find((bundle) =>
    bundle.bundleId === attempt.artifactBundleId
    || bundle.attemptId === attempt.attemptId
  );
  const artifactBundleMatches = storedBundle
    ? isDeepStrictEqual(
        comparableArtifactBundle(replayBundle),
        comparableArtifactBundle(storedBundle),
      )
    : !attempt.artifactBundleId
      && !input.artifactBundle
      && !input.result.artifactBundle;
  const changedFilesMatch = !canonicalResult.verification.allPassed
    || isDeepStrictEqual(
      replayBundle.changedFiles.map((entry) => entry.path),
      recordedReview?.reviewMaterial?.changedFiles ?? [],
    );
  if (
    !isDeepStrictEqual(clone(canonicalResult), latestResult)
    || !isDeepStrictEqual(canonicalPullRequest, storedPullRequestInput)
    || !changedFilesMatch
    || !artifactBundleMatches
  ) {
    throw new Error(`idempotency replay mismatch for task: ${task.id}`);
  }
  return true;
}

function comparableArtifactBundle(bundle: ArtifactBundle): unknown {
  const refs: Record<string, string | string[]> = {};
  for (const [key, value] of Object.entries(bundle.refs)) {
    if (key === "screenshots" && Array.isArray(value)) {
      const externalRefs = value.filter((ref) => !ref.startsWith("artifact://"));
      if (externalRefs.length > 0) {
        refs[key] = externalRefs;
      }
      continue;
    }
    if (typeof value === "string" && !value.startsWith("artifact://")) {
      refs[key] = value;
    }
  }
  const testResults = bundle.testResults?.map((result) => {
    const { outputRef, ...summary } = result;
    return outputRef && !outputRef.startsWith("artifact://")
      ? { ...summary, outputRef }
      : summary;
  });
  return clone({
    ...bundle,
    refs,
    testResults,
  });
}

type TaskResourceLeaseInput = {
  resourceType: LeaseResourceType;
  resourceId: string;
  ownerToken: string;
  metadata: Record<string, unknown>;
};

function buildBaseTaskResourceLeaseInputs(task: Task, workerId: string): TaskResourceLeaseInput[] {
  const baseMetadata = {
    taskId: task.id,
    workerId,
    repo: task.repo,
    branchName: task.branchName,
  };
  return [
    {
      resourceType: "assignment",
      resourceId: task.id,
      ownerToken: `assignment:${workerId}`,
      metadata: baseMetadata,
    },
    {
      resourceType: "repo",
      resourceId: task.repo,
      ownerToken: `repo:${workerId}`,
      metadata: baseMetadata,
    },
    {
      resourceType: "branch",
      resourceId: `${task.repo}:${task.branchName}`,
      ownerToken: `branch:${workerId}`,
      metadata: baseMetadata,
    },
  ];
}

function buildSessionResourceLeaseInput(task: Task, workerId: string): TaskResourceLeaseInput | null {
  const baseMetadata = {
    taskId: task.id,
    workerId,
    repo: task.repo,
    branchName: task.branchName,
  };
  const sessionAnchor = task.continueFromTaskId ?? task.followUpOfTaskId ?? null;
  if (!sessionAnchor) {
    return null;
  }
  return {
    resourceType: "session",
    resourceId: `${task.repo}:${sessionAnchor}`,
    ownerToken: `session:${workerId}`,
    metadata: {
      ...baseMetadata,
      sessionAnchor,
    },
  };
}

function buildTaskResourceLeaseInputs(task: Task, workerId: string): TaskResourceLeaseInput[] {
  const inputs = buildBaseTaskResourceLeaseInputs(task, workerId);
  const sessionInput = buildSessionResourceLeaseInput(task, workerId);
  return sessionInput ? [...inputs, sessionInput] : inputs;
}

function acquireTaskResourceLeases(
  state: RuntimeState,
  task: Task,
  workerId: string,
  at: string,
): {
  state: RuntimeState;
  acquired: boolean;
} {
  let nextLeases = state.leases ?? [];
  let nextState = state;

  for (const input of buildTaskResourceLeaseInputs(task, workerId)) {
    const result = acquireLease(nextLeases, {
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      ownerId: workerId,
      ownerToken: input.ownerToken,
      at,
      ttlMs: resolveAttemptLeaseTimeoutMs(task),
      metadata: input.metadata,
    });

    nextState = appendEvent({
      ...nextState,
      leases: result.leases,
    }, {
      taskId: task.id,
      type: result.acquired ? "lease_acquired" : "lease_conflict",
      at,
      payload: {
        resourceType: input.resourceType,
        resourceId: input.resourceId,
        ownerId: workerId,
        conflictingOwnerId: result.conflictedWith?.ownerId ?? null,
      },
    });

    if (!result.acquired) {
      return {
        state: nextState,
        acquired: false,
      };
    }
    nextLeases = result.leases;
  }

  return {
    state: nextState,
    acquired: true,
  };
}

function renewTaskResourceLeases(
  state: RuntimeState,
  task: Task,
  workerId: string,
  at: string,
): RuntimeState | null {
  const leaseInputs = buildTaskResourceLeaseInputs(task, workerId);
  const currentLeases = state.leases ?? [];
  const ownsEveryLease = leaseInputs.every((input) => {
    const lease = getActiveLease(currentLeases, input.resourceType, input.resourceId, at);
    return lease?.ownerId === workerId && lease.ownerToken === input.ownerToken;
  });
  if (!ownsEveryLease) {
    return null;
  }

  let renewedLeases = currentLeases;
  for (const input of leaseInputs) {
    const result = acquireLease(renewedLeases, {
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      ownerId: workerId,
      ownerToken: input.ownerToken,
      at,
      ttlMs: resolveAttemptLeaseTimeoutMs(task),
      metadata: input.metadata,
    });
    if (!result.acquired) {
      return null;
    }
    renewedLeases = result.leases;
  }

  return {
    ...state,
    leases: renewedLeases,
  };
}

function releaseTaskResourceLeases(
  state: RuntimeState,
  taskId: string,
  workerId: string,
  at: string,
  reclaimReason?: string | null,
): RuntimeState {
  const task = state.tasks.find((candidate) => candidate.id === taskId);
  const leaseInputs = task
    ? buildTaskResourceLeaseInputs(task, workerId)
    : [{
        resourceType: "assignment" as const,
        resourceId: taskId,
        ownerToken: `assignment:${workerId}`,
        metadata: { taskId, workerId },
      }];

  return leaseInputs.reduce((nextState, input) => {
    const result = releaseLease(nextState.leases ?? [], {
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      ownerId: workerId,
      ownerToken: input.ownerToken,
      at,
      reclaimReason: reclaimReason ?? null,
    });
    if (!result.releasedLease) {
      return nextState;
    }

    return appendEvent({
      ...nextState,
      leases: result.leases,
    }, {
      taskId,
      type: reclaimReason ? "lease_reclaimed" : "lease_released",
      at,
      payload: {
        resourceType: input.resourceType,
        resourceId: input.resourceId,
        ownerId: workerId,
        reclaimReason: reclaimReason ?? null,
      },
    });
  }, state);
}

function resolveAttemptLeaseTimeoutMs(task?: Task): number {
  return task?.terminationPolicy?.attemptLeaseTimeoutMs ?? DEFAULT_LEASE_TTL_MS;
}

function resolveHeartbeatTimeoutMs(options: ReconcileOptions = {}, task?: Task): number {
  return task?.terminationPolicy?.heartbeatTimeoutMs ?? options.heartbeatTimeoutMs ?? 5 * 60_000;
}

function resolveAssignmentTimeoutMs(options: ReconcileOptions = {}, task?: Task): number {
  return task?.terminationPolicy?.assignmentTimeoutMs ?? options.assignmentTimeoutMs ?? 5 * 60_000;
}

function resolveMaxTaskAttempts(options: ReconcileOptions = {}, task?: Task): number {
  const configured = Math.floor(task?.terminationPolicy?.maxAttempts ?? options.maxTaskAttempts ?? DEFAULT_MAX_TASK_ATTEMPTS);
  return configured > 0 ? configured : DEFAULT_MAX_TASK_ATTEMPTS;
}

function resolveWorkerStatus(worker: Worker, options: ReconcileOptions = {}, task?: Task): WorkerStatus {
  if (worker.disabledAt) {
    return "disabled";
  }

  const now = Date.parse(options.now ?? nowIso());
  const heartbeatTimeoutMs = resolveHeartbeatTimeoutMs(options, task);
  const lastHeartbeatAt = Date.parse(worker.lastHeartbeatAt ?? "");
  if (!Number.isFinite(lastHeartbeatAt)) {
    return "offline";
  }

  if (now - lastHeartbeatAt > heartbeatTimeoutMs) {
    return "offline";
  }

  return worker.status;
}

function selectWorker(state: RuntimeState, pool: string, options: ReconcileOptions = {}): Worker | undefined {
  return [...state.workers]
    .filter((worker) =>
      worker.pool === pool &&
      worker.status === "idle" &&
      !worker.disabledAt &&
      resolveWorkerStatus(worker, options) === "idle")
    .sort((left, right) => {
      const heartbeatCompare = compareTimestampAsc(left.lastHeartbeatAt, right.lastHeartbeatAt);
      if (heartbeatCompare !== 0) {
        return heartbeatCompare;
      }
      return left.id.localeCompare(right.id);
    })[0];
}

function selectWorkerForDispatch(state: RuntimeState, pool: string): Worker | undefined {
  return [...state.workers]
    .filter((worker) => worker.pool === pool && worker.status === "idle" && !worker.disabledAt)
    .sort((left, right) => {
      const heartbeatCompare = compareTimestampAsc(left.lastHeartbeatAt, right.lastHeartbeatAt);
      if (heartbeatCompare !== 0) {
        return heartbeatCompare;
      }
      return left.id.localeCompare(right.id);
    })[0];
}

function selectTargetWorker(state: RuntimeState, pool: string, workerId: string | null, options: ReconcileOptions = {}): Worker | null {
  if (!workerId) {
    return null;
  }

  const worker = state.workers.find((candidate) => candidate.id === workerId);
  if (!worker) {
    return null;
  }

  if (worker.disabledAt) {
    return null;
  }

  if (
    worker.pool !== pool ||
    worker.status !== "idle" ||
    resolveWorkerStatus(worker, options) !== "idle"
  ) {
    return null;
  }

  return worker;
}

function hasHealthyIdleAlternative(state: RuntimeState, pool: string, workerId: string, options: ReconcileOptions = {}, task?: Task): boolean {
  return state.workers.some((worker) =>
    worker.id !== workerId &&
    worker.pool === pool &&
    worker.status === "idle" &&
    !worker.disabledAt &&
    resolveWorkerStatus(worker, options, task) === "idle");
}

function assignmentWasClaimed(assignment: Assignment | undefined): boolean {
  return Boolean(assignment?.claimedAt);
}

function areDependenciesSatisfied(state: RuntimeState, task: Task): boolean {
  if (!task.dependsOn.length) {
    return true;
  }

  return task.dependsOn.every((dependencyTaskId) => {
    const dependencyTask = state.tasks.find((candidate) => candidate.id === dependencyTaskId);
    return dependencyTask?.status === "merged";
  });
}

function didWorkerHeartbeatAfterAssignment(worker: Worker | undefined, assignment: Assignment | undefined): boolean {
  const assignedAt = Date.parse(assignment?.assignedAt ?? "");
  const lastHeartbeatAt = Date.parse(worker?.lastHeartbeatAt ?? "");
  if (!Number.isFinite(assignedAt) || !Number.isFinite(lastHeartbeatAt)) {
    return false;
  }
  return lastHeartbeatAt > assignedAt;
}

function isAssignmentTimedOut(assignment: Assignment | undefined, worker: Worker | undefined, options: ReconcileOptions = {}, task?: Task): boolean {
  if (!assignment?.assignedAt || assignmentWasClaimed(assignment)) {
    return false;
  }

  const now = Date.parse(options.now ?? nowIso());
  const assignedAt = Date.parse(assignment.assignedAt);
  if (!Number.isFinite(now) || !Number.isFinite(assignedAt)) {
    return false;
  }

  if (now - assignedAt <= resolveAssignmentTimeoutMs(options, task)) {
    return false;
  }

  return !didWorkerHeartbeatAfterAssignment(worker, assignment);
}

function isAttemptLeaseExpired(attempt: TaskAttempt | null, at: string): boolean {
  // attempt lease 是 worker 执行尝试的真实占用边界，过期后必须进入可审计恢复路径。
  const leaseExpiresAt = Date.parse(attempt?.leaseExpiresAt ?? "");
  const now = Date.parse(at);
  return Number.isFinite(leaseExpiresAt) && Number.isFinite(now) && now >= leaseExpiresAt;
}

function expireTaskAttempt(state: RuntimeState, attempt: TaskAttempt, at: string): RuntimeState {
  // 保留历史 attempt，不覆盖或删除失败证据，避免 retry 抹掉原始执行记录。
  return {
    ...state,
    taskAttempts: upsertTaskAttempt(state.taskAttempts ?? [], {
      ...attempt,
      status: "expired",
      endedAt: at,
      failureCode: ATTEMPT_LEASE_EXPIRED_CODE,
      failureMessage: "attempt lease expired before worker result was submitted",
    }),
  };
}

function appendRetryRedriveEvents(
  state: RuntimeState,
  input: { task: Task; attempt: TaskAttempt; at: string },
): RuntimeState {
  let nextState = appendEvent(state, {
    taskId: input.task.id,
    type: "status_changed",
    at: input.at,
    payload: { from: "in_progress", to: "awaiting_retry" },
  });
  nextState = appendEvent(nextState, {
    taskId: input.task.id,
    type: "task_redriven",
    at: input.at,
    payload: {
      reason: ATTEMPT_LEASE_EXPIRED_CODE,
      fromAttemptId: input.attempt.attemptId,
      nextAttemptNo: input.attempt.attemptNo + 1,
    },
  });
  nextState = appendEvent(nextState, {
    taskId: input.task.id,
    type: "status_changed",
    at: input.at,
    payload: { from: "awaiting_retry", to: "ready" },
  });
  return nextState;
}

function markTaskReadyForRetry(
  state: RuntimeState,
  input: { task: Task; assignment: Assignment; worker: Worker; attempt: TaskAttempt; at: string },
): RuntimeState {
  // 当前最小策略用事件表达 awaiting_retry 中间语义，持久 task 状态仍回到 ready 供下一次 claim。
  const nextState = appendRetryRedriveEvents(state, {
    task: input.task,
    attempt: input.attempt,
    at: input.at,
  });
  return {
    ...nextState,
    updatedAt: input.at,
    tasks: upsertTask(nextState.tasks, {
      ...input.task,
      status: "ready",
      assignedWorkerId: null,
      lastAssignedWorkerId: input.worker.id,
    }),
    assignments: upsertAssignment(nextState.assignments, {
      ...input.assignment,
      workerId: null,
      status: "pending",
      assignedAt: null,
      claimedAt: null,
      assignment: {
        ...input.assignment.assignment,
        workerId: null,
        status: "pending",
      },
    }),
    workers: upsertWorker(nextState.workers, {
      ...input.worker,
      status: "offline",
      currentTaskId: undefined,
    }),
  };
}

function markTaskFailedAfterRetries(
  state: RuntimeState,
  input: { task: Task; assignment: Assignment; worker: Worker; at: string },
): RuntimeState {
  // retry 耗尽后显式失败，避免离线 worker 让任务长期停留在 in_progress。
  const nextState = appendEvent(state, {
    taskId: input.task.id,
    type: "status_changed",
    at: input.at,
    payload: {
      from: "in_progress",
      to: "failed",
      failureType: "execution",
      failureCode: ATTEMPT_LEASE_EXPIRED_CODE,
      failureSummary: "attempt lease expired and the task exhausted its retry policy",
    },
  });
  return {
    ...nextState,
    updatedAt: input.at,
    tasks: upsertTask(nextState.tasks, {
      ...input.task,
      status: "failed",
    }),
    assignments: upsertAssignment(nextState.assignments, {
      ...input.assignment,
      status: "failed",
      assignment: {
        ...input.assignment.assignment,
        status: "failed",
      },
    }),
    workers: upsertWorker(nextState.workers, {
      ...input.worker,
      status: "offline",
      currentTaskId: undefined,
    }),
  };
}

function reconcileExpiredRunningAttempts(state: RuntimeState, options: ReconcileOptions, at: string): RuntimeState {
  let nextState = state;
  for (const task of state.tasks) {
    if (task.status !== "in_progress" || !task.assignedWorkerId) {
      continue;
    }
    const worker = nextState.workers.find((candidate) => candidate.id === task.assignedWorkerId);
    const assignment = nextState.assignments.find((candidate) => candidate.taskId === task.id);
    const attempt = findActiveTaskAttempt(nextState, task.id);
    if (!worker || !assignment || !attempt || !isAttemptLeaseExpired(attempt, at)) {
      continue;
    }
    nextState = appendEvent(expireTaskAttempt(nextState, attempt, at), {
      taskId: task.id,
      type: "attempt_expired",
      at,
      payload: {
        attemptId: attempt.attemptId,
        failureCode: ATTEMPT_LEASE_EXPIRED_CODE,
      },
    });
    nextState = releaseTaskResourceLeases(
      nextState,
      task.id,
      worker.id,
      at,
      ATTEMPT_LEASE_EXPIRED_CODE,
    );
    const attemptsForTask = (nextState.taskAttempts ?? []).filter((candidate) => candidate.taskId === task.id).length;
    nextState = attemptsForTask < resolveMaxTaskAttempts(options, task)
      ? markTaskReadyForRetry(nextState, { task, assignment, worker, attempt, at })
      : markTaskFailedAfterRetries(nextState, { task, assignment, worker, at });
  }
  return nextState;
}

export function reconcileRuntimeState(state: RuntimeState, options: ReconcileOptions = {}): RuntimeState {
  const at = options.now ?? nowIso();
  let nextState = backfillTraceMetadata(state, at);
  const reclaimedLeases = reclaimExpiredLeases(nextState.leases ?? [], at, "expired");
  if (reclaimedLeases.reclaimed.length > 0) {
    nextState = {
      ...nextState,
      updatedAt: at,
      leases: reclaimedLeases.leases,
    };
    for (const reclaimed of reclaimedLeases.reclaimed) {
      nextState = appendEvent(nextState, {
        taskId: reclaimed.lease.resourceId,
        type: "lease_reclaimed",
        at,
        payload: {
          resourceType: reclaimed.lease.resourceType,
          resourceId: reclaimed.lease.resourceId,
          ownerId: reclaimed.lease.ownerId,
          reclaimReason: reclaimed.reason,
        },
      });
    }
  }

  nextState = reconcileExpiredRunningAttempts(nextState, options, at);

  for (const worker of state.workers) {
    const currentWorker = nextState.workers.find((candidate) => candidate.id === worker.id) ?? worker;
    const assignedTask = currentWorker.currentTaskId
      ? nextState.tasks.find((candidate) => candidate.id === currentWorker.currentTaskId)
      : null;
    const assignment = currentWorker.currentTaskId
      ? nextState.assignments.find((candidate) => candidate.taskId === currentWorker.currentTaskId)
      : null;
    const workerResolvedStatus = resolveWorkerStatus(currentWorker, options, assignedTask ?? undefined);
    const shouldRequeueBecauseOffline =
      workerResolvedStatus === "offline" &&
      assignedTask &&
      assignment &&
      assignedTask.status === "assigned" &&
      assignedTask.assignedWorkerId === worker.id &&
      assignment.workerId === worker.id &&
      assignment.status === "assigned" &&
      !assignmentWasClaimed(assignment);
    const shouldRequeueBecauseTimeout =
      assignedTask &&
      assignment &&
      assignedTask.status === "assigned" &&
      assignedTask.assignedWorkerId === worker.id &&
      assignment.workerId === worker.id &&
      assignment.status === "assigned" &&
      isAssignmentTimedOut(assignment, worker, options, assignedTask);

    if (
      shouldRequeueBecauseOffline ||
      shouldRequeueBecauseTimeout
    ) {
      nextState = releaseTaskResourceLeases(nextState, assignedTask.id, worker.id, at, shouldRequeueBecauseOffline ? "worker_offline" : "assignment_timeout");
      nextState = appendEvent(nextState, {
        taskId: assignedTask.id,
        type: "status_changed",
        at,
        payload: {
          from: "assigned",
          to: "ready",
        },
      });

      nextState = {
        ...nextState,
        tasks: upsertTask(nextState.tasks, {
          ...assignedTask,
          status: "ready",
          assignedWorkerId: null,
          lastAssignedWorkerId: worker.id,
        }),
        assignments: upsertAssignment(nextState.assignments, {
          ...assignment,
          workerId: null,
          status: "pending",
          assignedAt: null,
          claimedAt: null,
          assignment: {
            ...assignment.assignment,
            workerId: null,
            status: "pending",
          },
        }),
      };
    }

    if (workerResolvedStatus !== "offline" && !shouldRequeueBecauseTimeout) {
      continue;
    }

    nextState = {
      ...nextState,
      workers: upsertWorker(nextState.workers, {
        ...currentWorker,
        status: shouldRequeueBecauseTimeout || workerResolvedStatus === "offline" ? "offline" : "idle",
        currentTaskId: shouldRequeueBecauseOffline || shouldRequeueBecauseTimeout
          ? undefined
          : currentWorker.currentTaskId,
      }),
    };
  }

  if (nextState !== state) {
    nextState = {
      ...nextState,
      updatedAt: at,
    };
  }

  for (const task of nextState.tasks) {
    if (task.status !== "planned" || !task.dependsOn.length || !areDependenciesSatisfied(nextState, task)) {
      continue;
    }

    const assignment = nextState.assignments.find((candidate) => candidate.taskId === task.id);
    if (!assignment) {
      throw new Error(`assignment not found for task: ${task.id}`);
    }

    nextState = appendEvent(nextState, {
      taskId: task.id,
      type: "status_changed",
      at,
      payload: {
        from: "planned",
        to: "ready",
      },
    });

    nextState = {
      ...nextState,
      updatedAt: at,
      tasks: upsertTask(nextState.tasks, {
        ...task,
        status: "ready",
        assignedWorkerId: null,
      }),
      assignments: upsertAssignment(nextState.assignments, {
        ...assignment,
        workerId: null,
        status: "pending",
        assignedAt: null,
        claimedAt: null,
        assignment: {
          ...assignment.assignment,
          workerId: null,
          status: "pending",
        },
      }),
    };
  }

  return nextState;
}

export function registerWorker(state: RuntimeState, input: RegisterWorkerInput): RuntimeState {
  const existing = state.workers.find((candidate) => candidate.id === input.workerId);
  return {
    ...state,
    updatedAt: input.at ?? nowIso(),
    workers: upsertWorker(state.workers, {
      id: input.workerId,
      pool: input.pool,
      hostname: input.hostname,
      labels: input.labels ?? [],
      repoDir: input.repoDir ?? "",
      status: existing?.status ?? "idle",
      lastHeartbeatAt: input.at ?? nowIso(),
      currentTaskId: existing?.currentTaskId,
    }),
  };
}

export function heartbeatWorker(state: RuntimeState, input: HeartbeatWorkerInput): RuntimeState {
  const worker = state.workers.find((candidate) => candidate.id === input.workerId);
  if (!worker) {
    throw new Error(`worker not found: ${input.workerId}`);
  }

  const hasActiveTask = Boolean(worker.currentTaskId);
  const previousStatus = worker.status;
  const receivedAt = input.at ?? nowIso();
  const heartbeatAt = compareTimestampAsc(worker.lastHeartbeatAt, receivedAt) > 0
    ? worker.lastHeartbeatAt
    : receivedAt;
  const updatedAt = compareTimestampAsc(state.updatedAt, heartbeatAt) > 0
    ? state.updatedAt
    : heartbeatAt;

  let nextState: RuntimeState = {
    ...state,
    updatedAt,
    workers: upsertWorker(state.workers, {
      ...worker,
      lastHeartbeatAt: heartbeatAt,
      status: hasActiveTask ? "busy" : (previousStatus === "offline" ? "idle" : previousStatus),
    }),
  };

  if (!worker.currentTaskId) {
    return nextState;
  }
  const task = nextState.tasks.find((candidate) => candidate.id === worker.currentTaskId);
  const activeAttempt = task ? findActiveTaskAttempt(nextState, task.id) : null;
  if (
    !task
    || !activeAttempt
    || activeAttempt.workerId !== worker.id
    || isAttemptLeaseExpired(activeAttempt, heartbeatAt)
  ) {
    return nextState;
  }

  const renewedState = renewTaskResourceLeases(nextState, task, worker.id, heartbeatAt);
  if (!renewedState) {
    return nextState;
  }
  const leaseExpiresAt = new Date(
    Date.parse(heartbeatAt) + resolveAttemptLeaseTimeoutMs(task),
  ).toISOString();
  nextState = updateActiveTaskAttempt(renewedState, task.id, (attempt) => ({
    ...attempt,
    heartbeatAt,
    leaseExpiresAt,
  }));
  return nextState;
}

export function createDispatch(state: RuntimeState, input: CreateDispatchInput): CreateDispatchResult {
  const seenTaskIds = new Set<string>();
  for (const task of input.tasks) {
    if (seenTaskIds.has(task.id)) {
      throw new InvalidDispatchInputError(`duplicate task id in dispatch: ${task.id}`);
    }
    seenTaskIds.add(task.id);
  }

  const dispatchSeed = nextDispatchId(state);
  let nextState = dispatchSeed.state;
  const dispatchId = dispatchSeed.dispatchId;
  const assignments: Assignment[] = [];
  const taskIds: string[] = [];
  const createdAt = input.createdAt ?? nowIso();
  const dispatchQualityConfig = resolveDispatchQualityConfig();

  for (const taskInput of input.tasks) {
    const taskId = `${dispatchId}:${taskInput.id}`;
    taskIds.push(taskId);

    if (dispatchQualityConfig.mode !== "off") {
      const quality = evaluateDispatchQuality({
        allowedPaths: taskInput.allowedPaths ?? [],
        acceptance: taskInput.acceptance ?? [],
        config: dispatchQualityConfig,
      });
      if (!quality.ok && dispatchQualityConfig.mode === "enforce") {
        const codes = quality.violations.map((violation) => violation.code).join(", ");
        throw new Error(
          `dispatch quality gate rejected task "${taskInput.id}": ${codes}`,
        );
      }
    }
    const followUpOfTaskId = taskInput.followUpOfTaskId ?? taskInput.follow_up_of_task_id ?? null;
    const workerChangeReason = taskInput.workerChangeReason ?? taskInput.worker_change_reason ?? null;
    let targetWorkerId = taskInput.targetWorkerId ?? taskInput.target_worker_id ?? null;
    if (followUpOfTaskId) {
      const { sourceWorkerId } = resolveSourceTaskForFollowUp(nextState, followUpOfTaskId);
      if (targetWorkerId && sourceWorkerId && targetWorkerId !== sourceWorkerId && !workerChangeReason) {
        throw new Error(
          `follow-up task "${taskInput.id}" changes worker from "${sourceWorkerId}" to "${targetWorkerId}" without a worker change reason`,
        );
      }
      if (!targetWorkerId && sourceWorkerId) {
        targetWorkerId = sourceWorkerId;
      }
    }
    const hasDependencies = (taskInput.dependsOn ?? []).length > 0;
    let worker: Worker | null = null;
    let hasTargetWorkerConstraint = false;
    if (!hasDependencies && targetWorkerId) {
      worker = [...state.workers, ...nextState.workers].reduce<Worker | null>((found, w) => {
        if (found) return found;
        if (
          w.id === targetWorkerId &&
          w.pool === taskInput.pool &&
          w.status === "idle"
        ) {
          return w;
        }
        return found;
      }, null);
      if (!worker) {
        hasTargetWorkerConstraint = true;
      }
    }
    if (!hasDependencies && !worker && !hasTargetWorkerConstraint) {
      worker = selectWorkerForDispatch(nextState, taskInput.pool) ?? null;
    }

    const initialTaskStatus: TaskStatus = hasDependencies
      ? "planned"
      : worker
        ? "assigned"
        : "ready";

    const task: Task = {
      id: taskId,
      externalTaskId: taskInput.id,
      traceId: buildTaskTraceId(taskId),
      repo: input.repo,
      defaultBranch: input.defaultBranch,
      title: taskInput.title,
      pool: taskInput.pool,
      allowedPaths: taskInput.allowedPaths ?? [],
      acceptance: taskInput.acceptance ?? [],
      dependsOn: taskInput.dependsOn ?? [],
      branchName: taskInput.branchName,
      targetWorkerId,
      verification: taskInput.verification ?? { mode: "run" },
      terminationPolicy: taskInput.terminationPolicy,
      chatMode: taskInput.chatMode ?? "new_chat",
      continuationMode: taskInput.continuationMode,
      continueFromTaskId: taskInput.continueFromTaskId ?? null,
      followUpOfTaskId,
      workerChangeReason,
      status: initialTaskStatus,
      assignedWorkerId: worker?.id ?? null,
      lastAssignedWorkerId: hasDependencies ? null : worker?.id ?? null,
      requestedBy: input.requestedBy ?? "unknown",
      createdAt,
    };

    nextState = appendEvent(nextState, {
      taskId,
      type: "created",
      at: createdAt,
      payload: {
        status: "planned",
        traceId: task.traceId,
      },
    });
    if (dispatchQualityConfig.mode !== "off") {
      const quality = evaluateDispatchQuality({
        allowedPaths: task.allowedPaths,
        acceptance: task.acceptance,
        config: dispatchQualityConfig,
      });
      if (!quality.ok || quality.riskTier === "sensitive") {
        nextState = appendEvent(nextState, {
          taskId,
          type: "dispatch_quality_flagged",
          at: createdAt,
          payload: {
            mode: dispatchQualityConfig.mode,
            riskTier: quality.riskTier,
            violations: quality.violations,
          },
        });
      }
    }
    if (initialTaskStatus !== "planned") {
      nextState = appendEvent(nextState, {
        taskId,
        type: "status_changed",
        at: createdAt,
        payload: {
          from: "planned",
          to: initialTaskStatus,
        },
      });
    }

    const sourcePackage = input.packages.find((candidate) => candidate.taskId === taskInput.id);
    if (!sourcePackage) {
      throw new Error(`assignment package not found for task: ${taskInput.id}`);
    }

    const assignment: Assignment = {
      taskId,
      workerId: worker?.id ?? null,
      pool: task.pool,
      status: worker ? "assigned" : "pending",
      assignment: {
        ...clone(sourcePackage.assignment),
        taskId,
        workerId: worker?.id ?? null,
        status: worker ? "assigned" : "pending",
        traceId: task.traceId,
        branchName: task.branchName,
        targetWorkerId,
        repo: input.repo,
        defaultBranch: input.defaultBranch,
        chatMode: taskInput.chatMode ?? "new_chat",
        continuationMode: taskInput.continuationMode,
        continueFromTaskId: taskInput.continueFromTaskId ?? null,
        followUpOfTaskId,
        workerChangeReason,
      },
      workerPrompt: sourcePackage.workerPrompt,
      contextMarkdown: sourcePackage.contextMarkdown,
      workerPromptMode: sourcePackage.workerPromptMode,
      reportSchemaVersion: sourcePackage.reportSchemaVersion,
      assignedAt: worker ? createdAt : null,
      claimedAt: null,
    };

    assignments.push(assignment);

    nextState = {
      ...nextState,
      tasks: upsertTask(nextState.tasks, task),
      assignments: [...nextState.assignments, assignments[assignments.length - 1]],
    };

    if (worker) {
      nextState = {
        ...nextState,
        workers: upsertWorker(nextState.workers, {
          ...worker,
          status: "busy",
          currentTaskId: taskId,
          lastHeartbeatAt: createdAt,
        }),
      };
    }

    nextState = {
      ...nextState,
      reviews: upsertReview(nextState.reviews, {
        taskId,
        decision: "pending",
        actor: null,
        notes: "",
        decidedAt: null,
        reviewMaterial: null,
      }),
    };
  }

  nextState = {
    ...nextState,
    updatedAt: createdAt,
    dispatches: [
      ...nextState.dispatches,
      {
        id: dispatchId,
        repo: input.repo,
        defaultBranch: input.defaultBranch,
        requestedBy: input.requestedBy ?? "unknown",
        createdAt,
        taskIds,
      },
    ],
  };

  return {
    state: nextState,
    dispatchId,
    taskIds,
    assignments: assignments.map((item) => ({
      taskId: item.taskId,
      workerId: item.workerId,
      status: item.status,
    })),
  };
}

function incrementRedriveBranchName(branchName: string): string {
  const match = branchName.match(/^(.*?)-r(\d+)$/);
  if (!match) {
    return `${branchName}-r2`;
  }
  const round = Number.parseInt(match[2], 10);
  return `${match[1]}-r${Number.isSafeInteger(round) && round > 0 ? round + 1 : 2}`;
}

function nextAvailableRedriveBranchName(state: RuntimeState, sourceBranchName: string): string {
  const occupiedBranches = new Set(state.tasks.map((task) => task.branchName));
  let candidate = incrementRedriveBranchName(sourceBranchName);
  while (occupiedBranches.has(candidate)) {
    candidate = incrementRedriveBranchName(candidate);
  }
  return candidate;
}

function classifyRedriveableFailure(code: string, summary: string): string | null {
  const normalizedCode = code.trim();
  if (REDRIVEABLE_FAILURE_CODES.has(normalizedCode)) {
    return normalizedCode;
  }
  for (const candidate of REDRIVEABLE_FAILURE_PATTERNS) {
    if (candidate.patterns.some((pattern) => pattern.test(summary))) {
      return candidate.code;
    }
  }
  return null;
}

function resolveFailedTaskFailure(state: RuntimeState, task: Task): ResolvedWorkerFailure {
  const review = state.reviews.find((candidate) => candidate.taskId === task.id);
  const workerResult = review?.latestWorkerResult;
  if (workerResult) {
    return resolveWorkerFailure(workerResult.evidence, workerResult.output);
  }

  const latestAttempt = [...(state.taskAttempts ?? [])]
    .filter((attempt) => attempt.taskId === task.id)
    .sort((left, right) => right.attemptNo - left.attemptNo)[0];
  if (latestAttempt?.failureCode || latestAttempt?.failureMessage) {
    return {
      kind: latestAttempt.failureCode === ATTEMPT_LEASE_EXPIRED_CODE ? "execution" : "unknown",
      code: latestAttempt.failureCode?.trim() || "unknown",
      message: latestAttempt.failureMessage?.trim() || latestAttempt.failureCode?.trim() || "unknown",
    };
  }

  const failureEvent = [...state.events].reverse().find((event) => {
    if (event.taskId !== task.id) {
      return false;
    }
    const payload = isRecord(event.payload) ? event.payload : null;
    return (
      (event.type === "status_changed" && payload?.to === "failed")
      || event.type === "attempt_expired"
      || event.type === "delivery_failed"
    );
  });
  const payload = isRecord(failureEvent?.payload) ? failureEvent.payload : null;
  const data = isRecord(payload?.data) ? payload.data : null;
  const code = normalizeString(payload?.failureCode).trim()
    || normalizeString(data?.failureCode).trim()
    || "unknown";
  const message = normalizeString(payload?.failureSummary).trim()
    || normalizeString(payload?.message).trim()
    || normalizeString(payload?.error).trim()
    || normalizeString(data?.message).trim()
    || failureEvent?.summary?.trim()
    || code;
  return { kind: "unknown", code, message };
}

function findExistingManualRedrive(state: RuntimeState, sourceTaskId: string): {
  task: Task;
  assignment: Assignment;
  dispatch: Dispatch;
  event: Event | null;
} | null {
  const event = [...state.events].reverse().find((candidate) => {
    if (candidate.taskId !== sourceTaskId || candidate.type !== "task_redriven") {
      return false;
    }
    const payload = isRecord(candidate.payload) ? candidate.payload : null;
    return Boolean(normalizeString(payload?.newTaskId).trim());
  }) ?? null;
  const eventPayload = isRecord(event?.payload) ? event.payload : null;
  const eventTaskId = normalizeString(eventPayload?.newTaskId).trim();
  const task = (
    eventTaskId
      ? state.tasks.find((candidate) => candidate.id === eventTaskId)
      : undefined
  ) ?? state.tasks.find((candidate) =>
    candidate.continueFromTaskId === sourceTaskId
    && candidate.externalTaskId.startsWith("redrive-")
  );
  if (!task) {
    return null;
  }
  const assignment = state.assignments.find((candidate) => candidate.taskId === task.id);
  const dispatch = state.dispatches.find((candidate) => candidate.taskIds.includes(task.id));
  if (!assignment || !dispatch) {
    throw new Error(`redrive state incomplete for task: ${sourceTaskId}`);
  }
  return { task, assignment, dispatch, event };
}

function resolveTaskRedriveEligibility(state: RuntimeState, task: Task): TaskRedriveEligibility {
  const existing = findExistingManualRedrive(state, task.id);
  if (existing) {
    return {
      canRedrive: false,
      reason: "already_redriven",
      failureCode: null,
      existingTaskId: existing.task.id,
    };
  }
  if (task.status === "failed") {
    const failure = resolveFailedTaskFailure(state, task);
    const failureCode = classifyRedriveableFailure(failure.code, failure.message);
    return {
      canRedrive: Boolean(failureCode),
      reason: failureCode ? "recoverable_failure" : "non_redriveable_failure",
      failureCode,
      existingTaskId: null,
    };
  }
  if (task.status === "blocked") {
    const review = state.reviews.find((candidate) => candidate.taskId === task.id);
    if (review?.evidence?.canRedrive === false) {
      return {
        canRedrive: false,
        reason: "review_redrive_disabled",
        failureCode: null,
        existingTaskId: null,
      };
    }
    const canRedrive = Boolean(review && ["rework", "changes_requested"].includes(review.decision));
    return {
      canRedrive,
      reason: canRedrive ? "review_rework" : "review_decision_not_redriveable",
      failureCode: null,
      existingTaskId: null,
    };
  }
  return {
    canRedrive: false,
    reason: "state_not_redriveable",
    failureCode: null,
    existingTaskId: null,
  };
}

function buildBlockedTaskRedriveReason(review: Review): { reason: string; notes: string | null } {
  if (!["rework", "changes_requested"].includes(review.decision)) {
    throw new Error(
      `task ${review.taskId} is blocked but latest review decision is "${review.decision}" `
      + '(only "rework" and "changes_requested" are redriveable)',
    );
  }
  if (review.evidence?.canRedrive === false) {
    throw new Error(`task ${review.taskId} latest review explicitly disabled redrive`);
  }

  const mustFix = review.evidence?.mustFix?.map((item) => item.trim()).filter(Boolean) ?? [];
  const notes = mustFix.length > 0
    ? mustFix.join("; ")
    : review.notes?.trim() || null;
  const reason = mustFix.length > 0
    ? `rework: ${mustFix.join("; ")}`
    : review.evidence?.reasonCode
      ? `rework: ${review.evidence.reasonCode}`
      : `rework: ${notes ?? "no notes"}`;
  return { reason, notes };
}

export function redriveTask(state: RuntimeState, input: RedriveTaskInput): RedriveTaskResult {
  const task = state.tasks.find((candidate) => candidate.id === input.taskId);
  if (!task) {
    throw new Error(`task not found: ${input.taskId}`);
  }
  const sourceAssignment = state.assignments.find((candidate) => candidate.taskId === task.id);
  if (!sourceAssignment) {
    throw new Error(`assignment not found for task: ${task.id}`);
  }
  const existingRedrive = findExistingManualRedrive(state, task.id);
  if (existingRedrive) {
    const payload = isRecord(existingRedrive.event?.payload) ? existingRedrive.event.payload : null;
    const targetWorkerId = normalizeString(payload?.targetWorkerId).trim()
      || existingRedrive.task.targetWorkerId
      || existingRedrive.assignment.workerId
      || null;
    const failureCode = normalizeString(payload?.failureCode).trim() || null;
    const failureSummary = normalizeString(payload?.failureSummary).trim() || "task already redriven";
    return {
      state,
      dispatchId: existingRedrive.dispatch.id,
      taskIds: [...existingRedrive.dispatch.taskIds],
      assignments: existingRedrive.dispatch.taskIds.flatMap((taskId) => {
        const assignment = state.assignments.find((candidate) => candidate.taskId === taskId);
        return assignment ? [{
          taskId,
          workerId: assignment.workerId,
          status: assignment.status,
        }] : [];
      }),
      originalTaskId: task.id,
      newTaskId: existingRedrive.task.id,
      targetWorkerId,
      failureCode,
      failureSummary,
      continuationMode: "continue",
      continueFromTaskId: task.id,
    };
  }

  let failureCode: string | null = null;
  let failureSummary: string;
  let reworkNotes: string | null = null;

  if (task.status === "failed") {
    const failure = resolveFailedTaskFailure(state, task);
    failureCode = classifyRedriveableFailure(failure.code, failure.message);
    if (!failureCode) {
      throw new Error(
        `task ${task.id} failed for a non-redriveable reason: ${failure.message.slice(0, 100)}`,
      );
    }
    failureSummary = failure.message.slice(0, 200);
  } else if (task.status === "blocked") {
    const review = state.reviews.find((candidate) => candidate.taskId === task.id);
    if (!review) {
      throw new Error(`task ${task.id} is blocked but has no review decision`);
    }
    const blockedReason = buildBlockedTaskRedriveReason(review);
    failureSummary = blockedReason.reason;
    reworkNotes = blockedReason.notes;
  } else {
    throw new Error(
      `task ${task.id} is in "${task.status}" state and is not redriveable `
      + '(only "failed" and "blocked" with rework/changes_requested are redriveable)',
    );
  }

  const targetWorkerId = task.lastAssignedWorkerId
    ?? task.assignedWorkerId
    ?? sourceAssignment.workerId
    ?? sourceAssignment.assignment.targetWorkerId
    ?? null;
  const newExternalTaskId = `redrive-${(state.sequence ?? 0) + 1}`;
  const newBranchName = nextAvailableRedriveBranchName(state, task.branchName);
  const reworkSection = reworkNotes ? `\n\n## Rework Notes\n\n${reworkNotes}` : "";
  const workerPrompt = (
    sourceAssignment.workerPrompt
    ?? "You are a ForgeFlow worker. Stay within allowedPaths and satisfy acceptance."
  ) + reworkSection;
  const contextMarkdown = (
    sourceAssignment.contextMarkdown
    ?? "# Context\n\nComplete the assigned task within scope."
  ) + reworkSection;

  const dispatchResult = createDispatch(state, {
    repo: task.repo,
    defaultBranch: task.defaultBranch,
    requestedBy: input.requestedBy ?? "codex-control",
    createdAt: input.at,
    tasks: [{
      id: newExternalTaskId,
      title: task.title,
      pool: task.pool,
      allowedPaths: [...task.allowedPaths],
      acceptance: [...task.acceptance],
      branchName: newBranchName,
      targetWorkerId,
      verification: clone(task.verification),
      terminationPolicy: task.terminationPolicy ? clone(task.terminationPolicy) : undefined,
      chatMode: task.chatMode,
      continuationMode: "continue",
      continueFromTaskId: task.id,
    }],
    packages: [{
      taskId: newExternalTaskId,
      assignment: {
        ...clone(sourceAssignment.assignment),
        taskId: newExternalTaskId,
        workerId: null,
        status: "pending",
        branchName: newBranchName,
        targetWorkerId,
        continuationMode: "continue",
        continueFromTaskId: task.id,
        followUpOfTaskId: null,
        workerChangeReason: null,
        resumePayload: null,
      },
      workerPrompt,
      contextMarkdown,
      workerPromptMode: sourceAssignment.workerPromptMode,
      reportSchemaVersion: sourceAssignment.reportSchemaVersion,
    }],
  });
  const newTaskId = dispatchResult.taskIds[0];
  const redrivenState = appendEvent(dispatchResult.state, {
    taskId: task.id,
    type: "task_redriven",
    at: input.at ?? dispatchResult.state.updatedAt,
    payload: {
      newTaskId,
      targetWorkerId,
      failureCode,
      failureSummary,
      continuationMode: "continue",
    },
  });

  return {
    ...dispatchResult,
    state: redrivenState,
    originalTaskId: task.id,
    newTaskId,
    targetWorkerId,
    failureCode,
    failureSummary,
    continuationMode: "continue",
    continueFromTaskId: task.id,
  };
}

export function getAssignedTaskForWorker(state: RuntimeState, workerId: string): GetAssignedTaskResult | null {
  const worker = state.workers.find((candidate) => candidate.id === workerId);
  if (!worker || !worker.currentTaskId) {
    return null;
  }

  const assignment = state.assignments.find((candidate) => candidate.taskId === worker.currentTaskId);
  if (!assignment || !["assigned", "in_progress"].includes(assignment.status)) {
    return null;
  }

  const task = state.tasks.find((candidate) => candidate.id === assignment.taskId);
  if (!task || !["assigned", "in_progress"].includes(task.status)) {
    return null;
  }

  return withActiveAttemptEnvelope(state, {
    task,
    assignment: assignment.assignment,
    workerPrompt: assignment.workerPrompt,
    contextMarkdown: assignment.contextMarkdown,
    workerPromptMode: assignment.workerPromptMode,
    reportSchemaVersion: assignment.reportSchemaVersion,
    chatMode: (assignment as { chatMode?: string }).chatMode ?? task.chatMode ?? "new_chat",
    continuationMode: (assignment as { continuationMode?: string }).continuationMode ?? task.continuationMode,
    continueFromTaskId: (assignment as { continueFromTaskId?: string | null }).continueFromTaskId ?? task.continueFromTaskId ?? null,
    resumePayload: (assignment as { resumePayload?: Record<string, unknown> | null }).resumePayload ?? task.resumePayload ?? null,
  });
}

export function claimAssignedTaskForWorker(state: RuntimeState, input: ClaimAssignedTaskInput): ClaimAssignedTaskResult {
  const at = input.at ?? nowIso();
  const originalWorker = state.workers.find((candidate) => candidate.id === input.workerId);
  let reconciledState = reconcileRuntimeState(state, {
    now: at,
    heartbeatTimeoutMs: input.heartbeatTimeoutMs,
    assignmentTimeoutMs: input.assignmentTimeoutMs,
  });
  let worker = reconciledState.workers.find((candidate) => candidate.id === input.workerId);
  if (!worker) {
    throw new Error(`worker not found: ${input.workerId}`);
  }

  if (worker.disabledAt) {
    return {
      state: reconciledState,
      assignment: null,
    };
  }

  if (
    worker.status === "offline" &&
    !worker.currentTaskId &&
    originalWorker &&
    !originalWorker.currentTaskId &&
    originalWorker.status !== "busy"
  ) {
    worker = {
      ...worker,
      status: "idle",
      lastHeartbeatAt: at,
    };
    reconciledState = {
      ...reconciledState,
      updatedAt: at,
      workers: upsertWorker(reconciledState.workers, worker),
    };
  }

  const existingAssignment = getAssignedTaskForWorker(reconciledState, input.workerId);
  if (existingAssignment) {
    const assignedTask = reconciledState.tasks.find((candidate) => candidate.id === existingAssignment.task.id);
    const assignmentRecord = reconciledState.assignments.find((candidate) => candidate.taskId === existingAssignment.task.id);
    let nextState = reconciledState;
    const leaseResult = acquireTaskResourceLeases(nextState, existingAssignment.task, input.workerId, at);
    nextState = leaseResult.state;
    if (!leaseResult.acquired) {
      return {
        state: nextState,
        assignment: null,
      };
    }
    if (assignedTask) {
      nextState = createOrReuseTaskAttempt(nextState, assignedTask, input.workerId, at);
    }
    if (assignedTask?.status === "assigned" && assignmentRecord?.status === "assigned" && !assignmentRecord.claimedAt) {
      nextState = {
        ...appendEvent(nextState, {
          taskId: assignedTask.id,
          type: "assignment_claimed",
          at,
          payload: {
            workerId: input.workerId,
          },
        }),
        updatedAt: at,
        assignments: upsertAssignment(nextState.assignments, {
          ...assignmentRecord,
          claimedAt: at,
        }),
      };
    }
    return {
      state: nextState,
      assignment: withActiveAttemptEnvelope(nextState, existingAssignment),
    };
  }

  // Trae fetch/start flow can assign a task before writing currentTaskId.
  // Allow claiming that pre-assigned task so start-task can converge state.
  const preAssignedTask = reconciledState.tasks.find((candidate) =>
    candidate.status === "assigned" && candidate.assignedWorkerId === input.workerId);
  if (preAssignedTask) {
    const assignmentRecord = reconciledState.assignments.find((candidate) => candidate.taskId === preAssignedTask.id);
    if (!assignmentRecord) {
      throw new Error(`assignment not found for task: ${preAssignedTask.id}`);
    }
    if (assignmentRecord.status !== "assigned" || assignmentRecord.workerId !== input.workerId) {
      throw new Error(`task not assigned to worker: ${input.workerId}`);
    }

    let nextState = reconciledState;
    const leaseResult = acquireTaskResourceLeases(nextState, preAssignedTask, input.workerId, at);
    nextState = leaseResult.state;
    if (!leaseResult.acquired) {
      return {
        state: nextState,
        assignment: null,
      };
    }
    nextState = createOrReuseTaskAttempt(nextState, preAssignedTask, input.workerId, at);
    if (!assignmentRecord.claimedAt) {
      nextState = {
        ...appendEvent(nextState, {
          taskId: preAssignedTask.id,
          type: "assignment_claimed",
          at,
          payload: {
            workerId: input.workerId,
          },
        }),
        updatedAt: at,
        assignments: upsertAssignment(nextState.assignments, {
          ...assignmentRecord,
          claimedAt: at,
        }),
      };
    }

    nextState = {
      ...nextState,
      workers: upsertWorker(nextState.workers, {
        ...worker,
        status: "busy",
        currentTaskId: preAssignedTask.id,
        lastHeartbeatAt: at,
      }),
    };

    return {
      state: nextState,
      assignment: withActiveAttemptEnvelope(nextState, {
        task: nextState.tasks.find((candidate) => candidate.id === preAssignedTask.id)!,
        assignment: {
          ...assignmentRecord.assignment,
          workerId: input.workerId,
          status: "assigned",
        },
        workerPrompt: assignmentRecord.workerPrompt,
        contextMarkdown: assignmentRecord.contextMarkdown,
        chatMode: (assignmentRecord as { chatMode?: string }).chatMode ?? preAssignedTask.chatMode ?? "new_chat",
        continuationMode: (assignmentRecord as { continuationMode?: string }).continuationMode ?? preAssignedTask.continuationMode,
        continueFromTaskId: (assignmentRecord as { continueFromTaskId?: string | null }).continueFromTaskId ?? preAssignedTask.continueFromTaskId ?? null,
        followUpOfTaskId: (assignmentRecord as { followUpOfTaskId?: string | null }).followUpOfTaskId ?? preAssignedTask.followUpOfTaskId ?? null,
        workerChangeReason: (assignmentRecord as { workerChangeReason?: string | null }).workerChangeReason ?? preAssignedTask.workerChangeReason ?? null,
        resumePayload: (assignmentRecord as { resumePayload?: Record<string, unknown> | null }).resumePayload ?? preAssignedTask.resumePayload ?? null,
      }),
    };
  }

  if (worker.status !== "idle") {
    return {
      state: reconciledState,
      assignment: null,
    };
  }

  const readyTask = [...reconciledState.tasks]
    .filter((task) => task.pool === worker.pool && task.status === "ready")
    .filter((task) => areDependenciesSatisfied(reconciledState, task))
    .filter((task) => {
      if (task.targetWorkerId && task.targetWorkerId !== worker.id) {
        return false;
      }
      if (task.lastAssignedWorkerId !== worker.id) {
        return true;
      }
      return !hasHealthyIdleAlternative(reconciledState, worker.pool, worker.id, {
        now: at,
        heartbeatTimeoutMs: input.heartbeatTimeoutMs,
      }, task);
    })
    .sort((left, right) => compareTimestampAsc(left.createdAt, right.createdAt) || left.id.localeCompare(right.id))[0];

  if (!readyTask) {
    return {
      state: reconciledState,
      assignment: null,
    };
  }

  const assignment = reconciledState.assignments.find((candidate) => candidate.taskId === readyTask.id);
  if (!assignment) {
    throw new Error(`assignment not found for task: ${readyTask.id}`);
  }

  let nextState = appendEvent(reconciledState, {
    taskId: readyTask.id,
    type: "status_changed",
    at,
    payload: {
      from: "ready",
      to: "assigned",
    },
  });

  const leaseResult = acquireTaskResourceLeases(nextState, readyTask, worker.id, at);
  nextState = leaseResult.state;
  if (!leaseResult.acquired) {
    return {
      state: nextState,
      assignment: null,
    };
  }
  nextState = createOrReuseTaskAttempt(nextState, readyTask, worker.id, at);

  nextState = {
    ...nextState,
    updatedAt: at,
    tasks: upsertTask(nextState.tasks, {
      ...readyTask,
      status: "assigned",
      assignedWorkerId: worker.id,
      lastAssignedWorkerId: worker.id,
    }),
    assignments: upsertAssignment(nextState.assignments, {
      ...assignment,
      workerId: worker.id,
      status: "assigned",
      assignedAt: at,
      claimedAt: null,
      assignment: {
        ...assignment.assignment,
        workerId: worker.id,
        status: "assigned",
      },
    }),
    workers: upsertWorker(nextState.workers, {
      ...worker,
      status: "busy",
      currentTaskId: readyTask.id,
      lastHeartbeatAt: at,
    }),
  };

  return {
    state: nextState,
    assignment: withActiveAttemptEnvelope(nextState, {
      task: nextState.tasks.find((candidate) => candidate.id === readyTask.id)!,
      assignment: {
        ...assignment.assignment,
        workerId: worker.id,
        status: "assigned",
      },
      workerPrompt: assignment.workerPrompt,
      contextMarkdown: assignment.contextMarkdown,
      workerPromptMode: assignment.workerPromptMode,
      reportSchemaVersion: assignment.reportSchemaVersion,
      resumePayload: readyTask.resumePayload ?? null,
    }),
  };
}

export function beginTaskForWorker(state: RuntimeState, input: BeginTaskInput): RuntimeState {
  const worker = state.workers.find((candidate) => candidate.id === input.workerId);
  if (!worker) {
    throw new Error(`worker not found: ${input.workerId}`);
  }

  const task = state.tasks.find((candidate) => candidate.id === input.taskId);
  if (!task) {
    throw new Error(`task not found: ${input.taskId}`);
  }

  const assignment = state.assignments.find((candidate) => candidate.taskId === input.taskId);
  if (!assignment) {
    throw new Error(`assignment not found for task: ${input.taskId}`);
  }

  if (task.assignedWorkerId !== input.workerId || assignment.workerId !== input.workerId) {
    throw new Error(`task not assigned to worker: ${input.workerId}`);
  }

  const at = input.at ?? nowIso();
  assertActiveAttemptLease({
    state,
    taskId: input.taskId,
    workerId: input.workerId,
    attemptId: input.attemptId,
    leaseToken: input.leaseToken,
    protocolVersion: input.protocolVersion,
    traceId: input.traceId,
    idempotencyKey: input.idempotencyKey,
    operation: "start",
    at,
  });

  if (task.status === "in_progress") {
    return state;
  }

  if (task.status !== "assigned" || assignment.status !== "assigned") {
    throw new Error(`task not ready to start: ${input.taskId}`);
  }
  const leaseResult = acquireTaskResourceLeases(state, task, input.workerId, at);
  if (!leaseResult.acquired) {
    throw new Error(`assignment lease not available: ${input.taskId}`);
  }
  const leaseExpiresAt = new Date(
    Date.parse(at) + resolveAttemptLeaseTimeoutMs(task),
  ).toISOString();
  let nextState = updateActiveTaskAttempt(leaseResult.state, input.taskId, (attempt) => ({
    ...attempt,
    status: "running",
    startedAt: attempt.startedAt ?? at,
    heartbeatAt: at,
    leaseExpiresAt,
  }));
  nextState = appendEvent(nextState, {
    taskId: input.taskId,
    type: "status_changed",
    at,
    payload: {
      from: "assigned",
      to: "in_progress",
    },
  });

  nextState = {
    ...nextState,
    updatedAt: at,
    tasks: upsertTask(nextState.tasks, {
      ...task,
      status: "in_progress",
    }),
    assignments: upsertAssignment(nextState.assignments, {
      ...assignment,
      status: "in_progress",
      claimedAt: assignment.claimedAt ?? at,
      assignment: {
        ...assignment.assignment,
        status: "in_progress",
      },
    }),
    workers: upsertWorker(nextState.workers, {
      ...worker,
      status: "busy",
      currentTaskId: input.taskId,
      lastHeartbeatAt: at,
    }),
  };

  return nextState;
}

export function recordWorkerResult(state: RuntimeState, input: RecordWorkerResultInput): RuntimeState {
  const taskId = isRecord(input.result) ? normalizeString(input.result.taskId).trim() : "";
  const task = state.tasks.find((candidate) => candidate.id === taskId);
  if (!task) {
    throw new Error(`task not found: ${taskId || "<unknown>"}`);
  }
  const assignment = state.assignments.find((candidate) => candidate.taskId === task.id);
  if (!assignment) {
    throw new Error(`assignment not found for task: ${task.id}`);
  }

  const worker = state.workers.find((candidate) => candidate.id === input.workerId);
  if (!worker) {
    throw new Error(`worker not found: ${input.workerId}`);
  }
  if (isIdempotentWorkerResultReplay(state, task, input)) {
    return state;
  }
  const receivedAt = normalizeTimestamp(input.receivedAt, nowIso());
  assertActiveAttemptLease({
    state,
    taskId: task.id,
    workerId: input.workerId,
    attemptId: input.attemptId,
    leaseToken: input.leaseToken,
    protocolVersion: input.protocolVersion,
    traceId: input.traceId,
    idempotencyKey: input.idempotencyKey,
    operation: "result",
    at: receivedAt,
  });
  if (task.assignedWorkerId !== input.workerId) {
    throw new Error(`task not assigned to worker: ${input.workerId}`);
  }
  const activeAttempt = findActiveTaskAttempt(state, task.id);
  const activeAssignmentLease = listActiveLeases(state.leases ?? [], receivedAt)
    .find((lease) => lease.resourceType === "assignment" && lease.resourceId === task.id);
  if (
    !activeAssignmentLease
  ) {
    throw new Error(`stale attempt result rejected: ${input.attemptId ?? task.id} assignment lease expired`);
  }
  if (activeAssignmentLease.ownerId !== input.workerId) {
    throw new Error(`assignment lease owned by another worker: ${activeAssignmentLease.ownerId}`);
  }
  if (activeAssignmentLease.ownerToken !== activeAttempt?.leaseToken) {
    throw new Error(`lease token mismatch: ${task.id}`);
  }
  if (!["assigned", "in_progress"].includes(task.status)) {
    throw new Error(`task not executable: ${task.id}`);
  }
  const currentReview = state.reviews.find((candidate) => candidate.taskId === task.id);
  const canonicalResult = buildCanonicalWorkerResult(task, input.workerId, input.result);
  const canonicalPullRequest = canonicalizePullRequest(task, input.pullRequest);
  if (!activeAttempt) {
    throw new Error(`active attempt not found for task: ${task.id}`);
  }
  if (canonicalResult.waitingForInput) {
    return interruptTaskForInput(state, {
      taskId: task.id,
      actor: canonicalResult.waitingForInput.requestedBy ?? input.workerId,
      requestId: canonicalResult.waitingForInput.requestId,
      sourceSessionId: canonicalResult.waitingForInput.sourceSessionId,
      reason: canonicalResult.waitingForInput.reason ?? canonicalResult.output,
      expiresAt: canonicalResult.waitingForInput.expiresAt,
      resumePayloadSchema: canonicalResult.waitingForInput.resumePayloadSchema,
      at: receivedAt,
    });
  }
  const artifactBundle = buildArtifactBundle({
    task,
    attempt: activeAttempt,
    result: canonicalResult,
    artifactBundle: input.artifactBundle ?? input.result.artifactBundle,
    changedFiles: input.changedFiles,
    pullRequest: canonicalPullRequest,
  });

  const nextStatus = canonicalResult.verification.allPassed ? "review" : "failed";
  const terminalFailure = canonicalResult.verification.allPassed
    ? null
    : resolveWorkerFailure(canonicalResult.evidence, canonicalResult.output);
  const reviewChangedFiles = artifactBundle.changedFiles.map((entry) => entry.path);
  const reviewMaterial = canonicalResult.verification.allPassed
    ? {
        repo: task.repo,
        title: task.title,
        changedFiles: reviewChangedFiles,
        selfTestPassed: true,
        checks: canonicalResult.verification.commands.map((item) => item.command),
        freshness: {
          attemptId: activeAttempt.attemptId,
          artifactBundleId: artifactBundle.bundleId!,
          ...(artifactBundle.commit ? { commitSha: artifactBundle.commit } : {}),
        },
        pullRequest: canonicalPullRequest,
      }
    : null;
  const riskAssessment = canonicalResult.verification.allPassed
    ? assessReviewRisk({
        changedFiles: reviewChangedFiles,
        config: resolveReviewRiskConfig(),
      })
    : null;

  let nextState = state;
  if (task.status === "assigned") {
    nextState = appendEvent(nextState, {
      taskId: task.id,
      type: "status_changed",
      at: receivedAt,
      payload: {
        from: "assigned",
        to: "in_progress",
      },
    });
  }
  nextState = appendEvent(nextState, {
    taskId: task.id,
    type: "status_changed",
    at: receivedAt,
    payload: {
      from: "in_progress",
      to: nextStatus,
      ...(terminalFailure ? {
        failureType: terminalFailure.kind,
        failureCode: terminalFailure.code,
        failureSummary: terminalFailure.message,
      } : {}),
    },
  });

  nextState = {
    ...nextState,
    updatedAt: receivedAt,
    tasks: upsertTask(nextState.tasks, {
      ...task,
      status: nextStatus,
    }),
    assignments: upsertAssignment(nextState.assignments, {
      ...assignment,
      status: nextStatus,
      assignment: {
        ...assignment.assignment,
        status: nextStatus,
      },
    }),
    workers: upsertWorker(nextState.workers, {
      ...worker,
      status: "idle",
      currentTaskId: undefined,
      lastHeartbeatAt: receivedAt,
    }),
    reviews: upsertReview(nextState.reviews, {
      taskId: task.id,
      decision: "pending",
      actor: null,
      notes: "",
      decidedAt: null,
      reviewMaterial,
      latestWorkerResult: clone(canonicalResult),
      evidence: currentReview?.evidence ?? null,
      riskAssessment,
    }),
  };

  if (riskAssessment && riskAssessment.level !== "low") {
    nextState = appendEvent(nextState, {
      taskId: task.id,
      type: "review_risk_flagged",
      at: receivedAt,
      payload: {
        level: riskAssessment.level,
        changedFileCount: riskAssessment.changedFileCount,
        maxChangedFiles: riskAssessment.maxChangedFiles,
        protectedPathHits: riskAssessment.protectedPathHits.map((hit) => hit.pattern),
        reasons: riskAssessment.reasons,
      },
    });
  }

  if (canonicalPullRequest) {
    nextState = {
      ...nextState,
      pullRequests: upsertPullRequest(nextState.pullRequests, {
        taskId: task.id,
        number: canonicalPullRequest.number,
        url: canonicalPullRequest.url,
        headBranch: canonicalPullRequest.headBranch,
        baseBranch: canonicalPullRequest.baseBranch,
        title: task.title,
        status: "opened",
        createdAt: receivedAt,
        updatedAt: receivedAt,
      }),
    };
  }

  if (artifactBundle) {
    nextState = appendEvent({
      ...nextState,
      artifactBundles: upsertArtifactBundle(nextState.artifactBundles ?? [], artifactBundle),
    }, {
      taskId: task.id,
      type: "artifact_bundle_created",
      at: receivedAt,
      payload: {
        attemptId: artifactBundle.attemptId,
        bundleId: artifactBundle.bundleId,
      },
    });
  }

  nextState = updateActiveTaskAttempt(nextState, task.id, (attempt) => ({
    ...attempt,
    status: canonicalResult.verification.allPassed ? "succeeded" : "failed",
    heartbeatAt: receivedAt,
    endedAt: receivedAt,
    failureCode: terminalFailure?.code,
    failureMessage: terminalFailure?.message,
    artifactBundleId: artifactBundle?.bundleId ?? attempt.artifactBundleId,
  }));

  return releaseTaskResourceLeases(nextState, task.id, input.workerId, receivedAt);
}

export function recordReviewDecision(state: RuntimeState, input: RecordReviewDecisionInput): RuntimeState {
  const task = state.tasks.find((candidate) => candidate.id === input.taskId);
  if (!task) {
    throw new Error(`task not found: ${input.taskId}`);
  }
  const assignment = state.assignments.find((candidate) => candidate.taskId === input.taskId);
  if (!assignment) {
    throw new Error(`assignment not found for task: ${input.taskId}`);
  }
  const review = state.reviews.find((candidate) => candidate.taskId === input.taskId);
  if (task.status !== "review") {
    throw new Error(`task not in review: ${input.taskId}`);
  }
  const decisionAt = input.at ?? nowIso();
  if (!Number.isFinite(Date.parse(decisionAt))) {
    throw new Error("review decision at must be a valid timestamp");
  }
  const reviewStartedEvent = [...state.events].reverse().find((event) => (
    event.taskId === task.id
    && event.type === "status_changed"
    && (event.payload as { to?: unknown } | undefined)?.to === "review"
  ));
  const reviewStartedAtMs = Date.parse(reviewStartedEvent?.at ?? "");
  if (Number.isFinite(reviewStartedAtMs) && Date.parse(decisionAt) < reviewStartedAtMs) {
    throw new Error(`review decision at must not be before review started for task: ${input.taskId}`);
  }
  const canonicalFreshness = review?.reviewMaterial?.freshness;
  if (!canonicalFreshness) {
    throw new Error(`review freshness unavailable for task: ${input.taskId}`);
  }
  if (!input.expectedFreshness) {
    throw new Error(`review freshness required for task: ${input.taskId}`);
  }
  if (
    !isDeepStrictEqual(input.expectedFreshness, canonicalFreshness)
  ) {
    throw new Error(`review freshness mismatch for task: ${input.taskId}`);
  }
  const decisionEvidence = {
    ...(input.evidence ?? review?.evidence ?? { mustFix: [] }),
    ...(canonicalFreshness ? { reviewedFreshness: canonicalFreshness } : {}),
  };

  // Server-side merge risk gate (authoritative across Console, CLI, and direct
  // HTTP). Disabled by default; opt in via DISPATCHER_REVIEW_MERGE_GATE.
  const mergeGateMode = resolveReviewMergeGateMode();
  const riskLevel = review?.riskAssessment?.level ?? null;
  const riskAboveLow = Boolean(riskLevel && riskLevel !== "low");
  if (input.decision === "merge" && mergeGateMode !== "off" && riskAboveLow) {
    if (mergeGateMode === "enforce" && input.acknowledgeRisk !== true) {
      const reasons = review?.riskAssessment?.reasons ?? [];
      const reasonText = reasons.length > 0 ? ` (${reasons.join("; ")})` : "";
      throw new Error(
        `merge blocked by risk gate: review risk is "${riskLevel}"${reasonText}; acknowledge required`,
      );
    }
  }

  const nextStatus = input.decision === "merge" ? "merged" : "blocked";
  let nextState = appendEvent(state, {
    taskId: task.id,
    type: "status_changed",
    at: decisionAt,
    payload: {
      from: "review",
      to: nextStatus,
    },
  });
  nextState = appendEvent(nextState, {
    taskId: task.id,
    type: "review_decided",
    at: decisionAt,
    payload: {
      decision: input.decision,
      actor: input.actor,
      notes: input.notes ?? "",
      evidence: decisionEvidence,
      freshness: canonicalFreshness ?? null,
    },
  });

  if (input.decision === "merge" && mergeGateMode !== "off" && riskAboveLow) {
    nextState = appendEvent(nextState, {
      taskId: task.id,
      type: "review_merge_risk_acknowledged",
      at: decisionAt,
      payload: {
        mode: mergeGateMode,
        level: riskLevel,
        acknowledged: input.acknowledgeRisk === true,
        actor: input.actor,
      },
    });
  }

  nextState = {
    ...nextState,
    updatedAt: decisionAt,
    tasks: upsertTask(nextState.tasks, {
      ...task,
      status: nextStatus,
    }),
    assignments: upsertAssignment(nextState.assignments, {
      ...assignment,
      status: nextStatus,
      assignment: {
        ...assignment.assignment,
        status: nextStatus,
      },
    }),
    reviews: upsertReview(nextState.reviews, {
      taskId: task.id,
      decision: input.decision,
      actor: input.actor,
      notes: input.notes ?? "",
      decidedAt: decisionAt,
      reviewMaterial: review?.reviewMaterial ?? null,
      latestWorkerResult: review?.latestWorkerResult ?? null,
      evidence: decisionEvidence,
      riskAssessment: review?.riskAssessment ?? null,
    }),
  };

  const pullRequest = nextState.pullRequests.find((candidate) => candidate.taskId === task.id);
  if (pullRequest) {
    nextState = {
      ...nextState,
      pullRequests: upsertPullRequest(nextState.pullRequests, {
        ...pullRequest,
        status: input.decision === "merge" ? "merged" : "changes_requested",
        updatedAt: decisionAt,
      }),
    };
  }

  if (!task.assignedWorkerId) {
    return nextState;
  }
  return releaseTaskResourceLeases(nextState, task.id, task.assignedWorkerId, input.at ?? nowIso());
}

function requireTaskAndAssignment(state: RuntimeState, taskId: string): { task: Task; assignment: Assignment } {
  const task = state.tasks.find((candidate) => candidate.id === taskId);
  if (!task) {
    throw new Error(`task not found: ${taskId}`);
  }
  const assignment = state.assignments.find((candidate) => candidate.taskId === taskId);
  if (!assignment) {
    throw new Error(`assignment not found for task: ${taskId}`);
  }
  return { task, assignment };
}

function appendTaskStatusChange(state: RuntimeState, input: {
  taskId: string;
  from: TaskStatus;
  to: TaskStatus;
  at: string;
}): RuntimeState {
  return appendEvent(state, {
    taskId: input.taskId,
    type: "status_changed",
    at: input.at,
    payload: { from: input.from, to: input.to },
  });
}

function releaseWorkerFromTask(workers: Worker[], taskId: string, at: string): Worker[] {
  return workers.map((worker) => worker.currentTaskId === taskId
    ? {
        ...worker,
        status: (worker.disabledAt ? "disabled" : "idle") as WorkerStatus,
        currentTaskId: undefined,
        lastHeartbeatAt: at,
      }
    : worker);
}

function checkpointActiveAttempt(state: RuntimeState, taskId: string, at: string): RuntimeState {
  return updateActiveTaskAttempt(state, taskId, (attempt) => ({
    ...attempt,
    status: "checkpointed",
    heartbeatAt: at,
    endedAt: at,
  }));
}

function applyInterruptedTaskState(state: RuntimeState, input: {
  task: Task;
  assignment: Assignment;
  actor: string;
  requestId: string;
  attemptId?: string;
  sourceSessionId?: string;
  reason?: string;
  expiresAt?: string;
  resumePayloadSchema?: ResumePayloadSchema;
  at: string;
}): RuntimeState {
  return {
    ...state,
    updatedAt: input.at,
    tasks: upsertTask(state.tasks, {
      ...input.task,
      status: "waiting_for_input",
      assignedWorkerId: null,
      waitingForInput: {
        requestId: input.requestId,
        ...(input.attemptId ? { attemptId: input.attemptId } : {}),
        ...(input.sourceSessionId ? { sourceSessionId: input.sourceSessionId } : {}),
        requestedBy: input.actor,
        reason: input.reason ?? "",
        requestedAt: input.at,
        ...(input.expiresAt ? { expiresAt: input.expiresAt } : {}),
        ...(input.resumePayloadSchema ? { resumePayloadSchema: input.resumePayloadSchema } : {}),
      },
    }),
    assignments: upsertAssignment(state.assignments, {
      ...input.assignment,
      workerId: null,
      status: "waiting_for_input",
      assignment: {
        ...input.assignment.assignment,
        workerId: null,
        status: "waiting_for_input",
      },
    }),
    workers: releaseWorkerFromTask(state.workers, input.task.id, input.at),
  };
}

export function interruptTaskForInput(state: RuntimeState, input: InterruptTaskForInputInput): RuntimeState {
  const { task, assignment } = requireTaskAndAssignment(state, input.taskId);
  if (task.status === "waiting_for_input") {
    if (input.requestId && input.requestId !== task.waitingForInput?.requestId) {
      throw new Error(`input request mismatch for task: ${input.taskId}`);
    }
    return state;
  }
  if (!["ready", "assigned", "in_progress", "blocked"].includes(task.status)) {
    throw new Error(`task not interruptible from state: ${task.status}`);
  }

  const at = input.at ?? nowIso();
  if (typeof at !== "string" || !Number.isFinite(Date.parse(at))) {
    throw new Error("input request at must be a valid timestamp");
  }
  const requestId = input.requestId?.trim() || randomUUID();
  const sourceSessionId = input.sourceSessionId?.trim() || undefined;
  const expiresAt = input.expiresAt?.trim() || undefined;
  if (expiresAt && !Number.isFinite(Date.parse(expiresAt))) {
    throw new Error("input request expiresAt must be a valid timestamp");
  }
  if (expiresAt && Date.parse(expiresAt) <= Date.parse(at)) {
    throw new Error("input request expiresAt must be after requestedAt");
  }
  const activeAttempt = findActiveTaskAttempt(state, task.id);
  const resumePayloadSchema = normalizeResumePayloadSchema(input.resumePayloadSchema);
  let nextState = appendTaskStatusChange(state, {
    taskId: input.taskId,
    from: task.status,
    to: "waiting_for_input",
    at,
  });
  nextState = appendEvent(nextState, {
    taskId: input.taskId,
    type: "task_interrupted",
    at,
    payload: {
      actor: input.actor,
      requestId,
      attemptId: activeAttempt?.attemptId ?? null,
      sourceSessionId: sourceSessionId ?? null,
      reason: input.reason ?? "",
      expiresAt: expiresAt ?? null,
      ...(resumePayloadSchema ? { resumePayloadSchema } : {}),
    },
  });

  nextState = applyInterruptedTaskState(nextState, {
    task,
    assignment,
    actor: input.actor,
    requestId,
    attemptId: activeAttempt?.attemptId,
    sourceSessionId,
    reason: input.reason,
    expiresAt,
    resumePayloadSchema,
    at,
  });

  const releasedState = task.assignedWorkerId
    ? releaseTaskResourceLeases(nextState, task.id, task.assignedWorkerId, at, "waiting_for_input")
    : nextState;

  return checkpointActiveAttempt(releasedState, task.id, at);
}

export function resumeTaskFromInput(state: RuntimeState, input: ResumeTaskFromInputInput): RuntimeState {
  const { task, assignment } = requireTaskAndAssignment(state, input.taskId);
  const resumePayload = input.resumePayload ?? null;
  if (task.status !== "waiting_for_input") {
    const resolved = task.lastResolvedInput;
    if (resolved && input.requestId === resolved.requestId) {
      if (resolved.attemptId && !input.attemptId) {
        throw new Error(`input request attemptId required for task: ${input.taskId}`);
      }
      if (input.attemptId && input.attemptId !== resolved.attemptId) {
        throw new Error(`input request attempt mismatch for task: ${input.taskId}`);
      }
      if (!isDeepStrictEqual(resumePayload, resolved.resumePayload)) {
        throw new Error(`input request replay payload mismatch for task: ${input.taskId}`);
      }
      return state;
    }
    throw new Error(`task not waiting for input: ${input.taskId}`);
  }

  const at = input.at ?? nowIso();
  if (typeof at !== "string" || !Number.isFinite(Date.parse(at))) {
    throw new Error("input request at must be a valid timestamp");
  }
  const resumeAtMs = Date.parse(at);
  const waiting = task.waitingForInput;
  if (waiting?.requestId && !input.requestId) {
    throw new Error(`input requestId required for task: ${input.taskId}`);
  }
  if (waiting?.requestId && input.requestId !== waiting.requestId) {
    throw new Error(`input request mismatch for task: ${input.taskId}`);
  }
  if (waiting?.attemptId && !input.attemptId) {
    throw new Error(`input request attemptId required for task: ${input.taskId}`);
  }
  if (waiting?.attemptId && input.attemptId !== waiting.attemptId) {
    throw new Error(`input request attempt mismatch for task: ${input.taskId}`);
  }
  const requestedAt = (waiting as { requestedAt?: unknown } | undefined)?.requestedAt;
  if (typeof requestedAt !== "string" || !requestedAt.trim()) {
    throw new Error(`input request metadata invalid for task: ${input.taskId}: requestedAt`);
  }
  const requestedAtMs = Date.parse(requestedAt);
  if (!Number.isFinite(requestedAtMs)) {
    throw new Error(`input request metadata invalid for task: ${input.taskId}: requestedAt`);
  }
  if (resumeAtMs < requestedAtMs) {
    throw new Error(`input request at must not be before requestedAt for task: ${input.taskId}`);
  }
  if (waiting && Object.prototype.hasOwnProperty.call(waiting, "expiresAt")) {
    const expiresAt = (waiting as { expiresAt?: unknown }).expiresAt;
    if (typeof expiresAt !== "string" || !expiresAt.trim()) {
      throw new Error(`input request metadata invalid for task: ${input.taskId}: expiresAt`);
    }
    const expiresAtMs = Date.parse(expiresAt);
    if (!Number.isFinite(expiresAtMs)) {
      throw new Error(`input request metadata invalid for task: ${input.taskId}: expiresAt`);
    }
    if (resumeAtMs >= expiresAtMs) {
      throw new Error(`input request expired for task: ${input.taskId}`);
    }
  }
  validateResumePayloadAgainstSchema(waiting?.resumePayloadSchema, resumePayload);

  let nextState = appendTaskStatusChange(state, {
    taskId: input.taskId,
    from: "waiting_for_input",
    to: "ready",
    at,
  });
  nextState = appendEvent(nextState, {
    taskId: input.taskId,
    type: "task_resumed",
    at,
    payload: {
      actor: input.actor,
      requestId: waiting?.requestId ?? null,
      attemptId: waiting?.attemptId ?? null,
      resumePayload,
    },
  });

  return {
    ...nextState,
    updatedAt: at,
    tasks: upsertTask(nextState.tasks, {
      ...task,
      status: "ready",
      assignedWorkerId: null,
      waitingForInput: null,
      resumePayload,
      ...(waiting?.requestId ? {
        lastResolvedInput: {
          requestId: waiting.requestId,
          ...(waiting.attemptId ? { attemptId: waiting.attemptId } : {}),
          resolvedBy: input.actor,
          resolvedAt: at,
          resumePayload,
        },
      } : {}),
    }),
    assignments: upsertAssignment(nextState.assignments, {
      ...assignment,
      workerId: null,
      status: "pending",
      assignment: {
        ...assignment.assignment,
        workerId: null,
        status: "pending",
        resumePayload,
      },
      assignedAt: null,
      claimedAt: null,
    }),
  };
}

export function cancelTask(state: RuntimeState, input: CancelTaskInput): RuntimeState {
  const task = state.tasks.find((candidate) => candidate.id === input.taskId);
  if (!task) {
    throw new Error(`task not found: ${input.taskId}`);
  }

  if (task.status === "cancelled") {
    return state;
  }
  if (task.status === "merged" || task.status === "failed") {
    throw new Error(`task not cancellable from state: ${task.status}`);
  }

  const assignment = state.assignments.find((candidate) => candidate.taskId === input.taskId);
  if (!assignment) {
    throw new Error(`assignment not found for task: ${input.taskId}`);
  }

  const at = input.at ?? nowIso();
  const fromStatus = task.status;
  let nextState = appendEvent(state, {
    taskId: input.taskId,
    type: "status_changed",
    at,
    payload: {
      from: fromStatus,
      to: "cancelled",
    },
  });
  nextState = appendEvent(nextState, {
    taskId: input.taskId,
    type: "task_cancelled",
    at,
    payload: {
      actor: input.actor,
      reason: input.reason ?? "",
    },
  });

  nextState = {
    ...nextState,
    updatedAt: at,
    tasks: upsertTask(nextState.tasks, {
      ...task,
      status: "cancelled",
    }),
    assignments: upsertAssignment(nextState.assignments, {
      ...assignment,
      status: "cancelled",
      assignment: {
        ...assignment.assignment,
        status: "cancelled",
      },
    }),
  };

  const affectedWorkers: Worker[] = nextState.workers.map((worker) => {
    if (worker.currentTaskId !== input.taskId) {
      return worker;
    }
    return {
      ...worker,
      status: (worker.disabledAt ? "disabled" : "idle") as WorkerStatus,
      currentTaskId: undefined,
      lastHeartbeatAt: at,
    };
  });

  const releasedState = task.assignedWorkerId
    ? releaseTaskResourceLeases(nextState, task.id, task.assignedWorkerId, at, "cancelled")
    : nextState;

  const attemptedState = updateActiveTaskAttempt(releasedState, task.id, (attempt) => ({
    ...attempt,
    status: "cancelled",
    heartbeatAt: at,
    endedAt: at,
  }));

  return {
    ...attemptedState,
    workers: affectedWorkers,
  };
}

export function recordWorkerEvent(state: RuntimeState, input: RecordWorkerEventInput): RuntimeState {
  const taskId = input.taskId ?? state.workers.find((candidate) => candidate.id === input.workerId)?.currentTaskId ?? "system";
  const task = state.tasks.find((candidate) => candidate.id === taskId);
  const traceId = resolveTaskTraceId(task);
  const payload = isRecord(input.payload)
    ? {
        workerId: input.workerId,
        ...(traceId ? { traceId } : {}),
        ...(typeof input.payload.message === "string" ? { message: input.payload.message } : {}),
        ...(typeof input.payload.sessionId === "string" ? { sessionId: input.payload.sessionId } : {}),
        ...(typeof input.payload.failureCode === "string" ? { failureCode: input.payload.failureCode } : {}),
        data: clone(input.payload),
      }
    : {
        workerId: input.workerId,
        ...(traceId ? { traceId } : {}),
        ...(input.payload === undefined ? {} : { data: clone(input.payload) }),
      };

  const worker = state.workers.find((candidate) => candidate.id === input.workerId);
  if (!worker) {
    if (!input.type.startsWith("register_")) {
      throw new Error(`worker not found: ${input.workerId}`);
    }

    const at = input.at ?? nowIso();
    return appendEvent(state, {
      taskId: input.taskId ?? "system",
      type: input.type,
      at,
      payload,
    });
  }
  const at = input.at ?? nowIso();
  return appendEvent(state, {
    taskId,
    type: input.type,
    at,
    payload,
  });
}

function resolveWorkerStatuses(workers: Worker[], options: ReconcileOptions = {}): Worker[] {
  return clone(workers).map((worker) => {
    const resolvedStatus = resolveWorkerStatus(worker, options);
    return resolvedStatus === worker.status
      ? worker
      : {
          ...worker,
          status: resolvedStatus,
        };
  });
}

function computeAssignmentLagMetrics(tasks: Task[], assignments: Assignment[]): {
  avgAssignmentLagMs: number;
  maxAssignmentLagMs: number;
} {
  const lags = assignments.flatMap((assignment) => {
    if (!assignment.assignedAt) {
      return [];
    }
    const task = tasks.find((candidate) => candidate.id === assignment.taskId);
    const createdAt = Date.parse(task?.createdAt ?? "");
    const assignedAt = Date.parse(assignment.assignedAt);
    if (!Number.isFinite(createdAt) || !Number.isFinite(assignedAt)) {
      return [];
    }
    return [Math.max(0, assignedAt - createdAt)];
  });

  if (lags.length === 0) {
    return {
      avgAssignmentLagMs: 0,
      maxAssignmentLagMs: 0,
    };
  }

  const total = lags.reduce((sum, value) => sum + value, 0);
  return {
    avgAssignmentLagMs: Math.round(total / lags.length),
    maxAssignmentLagMs: Math.max(...lags),
  };
}

export function buildDashboardSnapshot(state: RuntimeState, options: ReconcileOptions = {}): DashboardSnapshot {
  const reconciledState = reconcileRuntimeState(state, options);
  const workers = resolveWorkerStatuses(reconciledState.workers, options);
  const assignmentLag = computeAssignmentLagMetrics(reconciledState.tasks, reconciledState.assignments);
  const failureCodes = countFailureCodes(reconciledState.reviews);
  const reviewReasonCodes = countReviewReasonCodes(reconciledState.reviews);
  const repoConcurrencySaturation = computeRepoConcurrencySaturation(workers);
  const activeLeasesByResourceType = countActiveLeasesByResourceType(
    reconciledState.leases ?? [],
    options.now ?? reconciledState.updatedAt,
  );
  const activeLeaseTotal = Object.values(activeLeasesByResourceType).reduce((sum, value) => sum + value, 0);

  return {
    updatedAt: reconciledState.updatedAt,
    stats: {
      workers: {
        total: workers.length,
        idle: workers.filter((worker) => worker.status === "idle" && !worker.disabledAt).length,
        busy: workers.filter((worker) => worker.status === "busy" && !worker.disabledAt).length,
        offline: workers.filter((worker) => worker.status === "offline" && !worker.disabledAt).length,
        disabled: workers.filter((worker) => Boolean(worker.disabledAt)).length,
      },
      tasks: {
        total: reconciledState.tasks.length,
        ready: reconciledState.tasks.filter((task) => task.status === "ready").length,
        assigned: reconciledState.tasks.filter((task) => task.status === "assigned").length,
        inProgress: reconciledState.tasks.filter((task) => task.status === "in_progress").length,
        review: reconciledState.tasks.filter((task) => task.status === "review").length,
        merged: reconciledState.tasks.filter((task) => task.status === "merged").length,
        failed: reconciledState.tasks.filter((task) => task.status === "failed").length,
        cancelled: reconciledState.tasks.filter((task) => task.status === "cancelled").length,
      },
    },
    metrics: {
      queueDepth: reconciledState.tasks.filter((task) => task.status === "ready").length,
      plannedTasks: reconciledState.tasks.filter((task) => task.status === "planned").length,
      reviewBacklog: reconciledState.tasks.filter((task) => task.status === "review").length,
      avgAssignmentLagMs: assignmentLag.avgAssignmentLagMs,
      maxAssignmentLagMs: assignmentLag.maxAssignmentLagMs,
      submitResultRetryCount: countEventsByType(reconciledState.events, "submit_result_retry_failed"),
      retryRatePct: computeRetryRatePct(reconciledState.tasks, reconciledState.events),
      deliveryFailedCount: countEventsByType(reconciledState.events, "delivery_failed"),
      cleanupFailureCount: countEventsByType(reconciledState.events, "worktree_cleanup_failed"),
      sessionInterruptionCount: countEventsByType(reconciledState.events, "session_interrupted"),
      stateLockTimeoutCount: countEventsByType(reconciledState.events, "state_lock_timeout"),
      shadowWriteFailureCount: countEventsByType(reconciledState.events, "shadow_write_failed"),
      branchProtectionHitCount: failureCodes.branch_protection_hit ?? 0,
      leaseConflictCount: countEventsByType(reconciledState.events, "lease_conflict"),
      leaseReclaimCount: countEventsByType(reconciledState.events, "lease_reclaimed"),
      activeLeases: {
        total: activeLeaseTotal,
        byResourceType: activeLeasesByResourceType,
      },
      repoConcurrencySaturation,
      failureCodes,
      reviewReasonCodes,
      eventWindow: describeRuntimeEventWindow(reconciledState.events),
    },
    workers,
    tasks: clone([...reconciledState.tasks].reverse().map((task) => ({
      ...task,
      redriveEligibility: resolveTaskRedriveEligibility(reconciledState, task),
    }))),
    taskAttempts: clone(reconciledState.taskAttempts ?? []),
    artifactBundles: clone(reconciledState.artifactBundles ?? []),
    assignments: clone(reconciledState.assignments),
    reviews: clone(reconciledState.reviews),
    pullRequests: clone(reconciledState.pullRequests),
    events: clone(reconciledState.events.slice(-50).reverse()),
    dispatches: clone(reconciledState.dispatches),
    leases: clone(reconciledState.leases ?? []),
  };
}

export interface ControlContextTask {
  taskId: string;
  externalTaskId: string;
  traceId: string | null;
  title: string;
  pool: string;
  repo: string;
  status: TaskStatus;
  assignedWorkerId: string | null;
}

export interface ControlContextReviewItem extends ControlContextTask {
  riskLevel: ReviewRiskAssessment["level"] | null;
  riskReasons: string[];
  changedFileCount: number | null;
}

export interface ControlContextBlockedItem extends ControlContextTask {
  decision: ReviewDecision | null;
  canRedrive: boolean;
  reasonCode: string | null;
}

export interface ControlContext {
  updatedAt: string;
  stats: DashboardSnapshot["stats"];
  metrics: {
    queueDepth: number;
    plannedTasks: number;
    reviewBacklog: number;
    failureCodes: Record<string, number>;
    reviewReasonCodes: Record<string, number>;
  };
  activeTasks: ControlContextTask[];
  reviewBacklog: ControlContextReviewItem[];
  blocked: ControlContextBlockedItem[];
  recentEvents: Event[];
}

const CONTROL_CONTEXT_ACTIVE_STATUSES: TaskStatus[] = [
  "planned",
  "ready",
  "assigned",
  "in_progress",
];

function toControlContextTask(task: Task): ControlContextTask {
  return {
    taskId: task.id,
    externalTaskId: task.externalTaskId,
    traceId: resolveTaskTraceId(task),
    title: task.title,
    pool: task.pool,
    repo: task.repo,
    status: task.status,
    assignedWorkerId: task.assignedWorkerId ?? null,
  };
}

// One-call control-layer context view. Reuses the reconciled dashboard snapshot
// (already structured-read aware at the call site) and folds it into the focused
// slices a planner / reviewer actually acts on: active work, the review backlog
// with deterministic risk grades, redriveable blocked tasks, and recent events
// for trace correlation. `since` filters recent events by timestamp.
export function buildControlContext(
  snapshot: DashboardSnapshot,
  options: { since?: string; eventLimit?: number } = {},
): ControlContext {
  const reviewByTask = new Map(snapshot.reviews.map((review) => [review.taskId, review]));

  const activeTasks = snapshot.tasks
    .filter((task) => CONTROL_CONTEXT_ACTIVE_STATUSES.includes(task.status))
    .map(toControlContextTask);

  const reviewBacklog: ControlContextReviewItem[] = snapshot.tasks
    .filter((task) => task.status === "review")
    .map((task) => {
      const review = reviewByTask.get(task.id);
      const risk = review?.riskAssessment ?? null;
      return {
        ...toControlContextTask(task),
        riskLevel: risk?.level ?? null,
        riskReasons: risk?.reasons ?? [],
        changedFileCount: risk?.changedFileCount ?? null,
      };
    });

  const blocked: ControlContextBlockedItem[] = snapshot.tasks
    .filter((task) => task.status === "blocked")
    .map((task) => {
      const review = reviewByTask.get(task.id);
      const decision = review?.decision ?? null;
      const evidence = review?.evidence ?? null;
      const isReworkDecision = decision === "rework" || decision === "changes_requested";
      const canRedrive = isReworkDecision && evidence?.canRedrive !== false;
      return {
        ...toControlContextTask(task),
        decision,
        canRedrive,
        reasonCode: evidence?.reasonCode ?? null,
      };
    });

  let recentEvents = snapshot.events;
  if (options.since) {
    const sinceMs = Date.parse(options.since);
    if (Number.isFinite(sinceMs)) {
      recentEvents = recentEvents.filter((event) => {
        const at = Date.parse(event.at);
        return Number.isFinite(at) && at >= sinceMs;
      });
    }
  }
  if (typeof options.eventLimit === "number" && options.eventLimit >= 0) {
    recentEvents = recentEvents.slice(0, options.eventLimit);
  }

  return {
    updatedAt: snapshot.updatedAt,
    stats: snapshot.stats,
    metrics: {
      queueDepth: snapshot.metrics.queueDepth,
      plannedTasks: snapshot.metrics.plannedTasks,
      reviewBacklog: snapshot.metrics.reviewBacklog,
      failureCodes: snapshot.metrics.failureCodes,
      reviewReasonCodes: snapshot.metrics.reviewReasonCodes,
    },
    activeTasks,
    reviewBacklog,
    blocked,
    recentEvents: clone(recentEvents),
  };
}

export interface DisableWorkerInput {
  workerId: string;
  disabledBy?: string | null;
  at?: string;
}

export function disableWorker(state: RuntimeState, input: DisableWorkerInput): RuntimeState {
  const worker = state.workers.find((candidate) => candidate.id === input.workerId);
  if (!worker) {
    throw new Error(`worker not found: ${input.workerId}`);
  }

  const at = input.at ?? nowIso();
  const nextState = appendEvent(state, {
    taskId: worker.currentTaskId ?? "system",
    type: "worker_disabled",
    at,
    payload: {
      workerId: input.workerId,
      disabledBy: input.disabledBy ?? null,
    },
  });

  return {
    ...nextState,
    updatedAt: at,
    workers: upsertWorker(nextState.workers, {
      ...worker,
      status: "disabled",
      disabledAt: at,
      disabledBy: input.disabledBy ?? null,
    }),
  };
}

export interface EnableWorkerInput {
  workerId: string;
  at?: string;
}

export interface MarkWorkerOfflineInput {
  workerId: string;
  at?: string;
  reason?: string | null;
}

export function enableWorker(state: RuntimeState, input: EnableWorkerInput): RuntimeState {
  const worker = state.workers.find((candidate) => candidate.id === input.workerId);
  if (!worker) {
    throw new Error(`worker not found: ${input.workerId}`);
  }

  const at = input.at ?? nowIso();
  const nextState = appendEvent(state, {
    taskId: worker.currentTaskId ?? "system",
    type: "worker_enabled",
    at,
    payload: {
      workerId: input.workerId,
    },
  });

  return {
    ...nextState,
    updatedAt: at,
    workers: upsertWorker(nextState.workers, {
      ...worker,
      status: "idle",
      disabledAt: null,
      disabledBy: null,
      lastHeartbeatAt: at,
    }),
  };
}

export function markWorkerOffline(state: RuntimeState, input: MarkWorkerOfflineInput): RuntimeState {
  const worker = state.workers.find((candidate) => candidate.id === input.workerId);
  if (!worker) {
    throw new Error(`worker not found: ${input.workerId}`);
  }

  const at = input.at ?? nowIso();
  let nextState = appendEvent(state, {
    taskId: worker.currentTaskId ?? "system",
    type: "worker_offline",
    at,
    payload: {
      workerId: input.workerId,
      reason: input.reason ?? null,
    },
  });

  if (worker.currentTaskId) {
    nextState = releaseTaskResourceLeases(nextState, worker.currentTaskId, input.workerId, at, input.reason ?? "worker_offline");
  }

  return {
    ...nextState,
    updatedAt: at,
    workers: upsertWorker(nextState.workers, {
      ...worker,
      status: "offline",
      lastHeartbeatAt: at,
    }),
  };
}
