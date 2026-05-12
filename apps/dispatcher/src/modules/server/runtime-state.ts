import { jsonStore } from "./runtime-state-json.js";
import {
  DEFAULT_LEASE_TTL_MS,
  acquireLease,
  listActiveLeases,
  reclaimExpiredLeases,
  releaseLease,
} from "./leases.js";
import { sqliteStore } from "./runtime-state-sqlite.js";
import type { RuntimeStateStore } from "./runtime-state-store.js";
import type { LeaseResourceType, RuntimeLease } from "./leases.js";
import {
  ArtifactBundleSchema,
  type ArtifactBundle,
} from "@forgeflow/result-contracts";
import type {
  ReviewDecisionEvidence,
  WorkerEvidence,
} from "./runtime-glue-types.js";
import { compareTimestampAsc, formatLocalTimestamp } from "../time.js";

const defaultStore: RuntimeStateStore = sqliteStore;

const RUNTIME_STATE_BACKEND_ENV = "RUNTIME_STATE_BACKEND";
const RUNTIME_EVENTS_RETENTION_LIMIT = 500;

function resolveStore(): RuntimeStateStore {
  if (process.env[RUNTIME_STATE_BACKEND_ENV] === "json") {
    return jsonStore;
  }
  return defaultStore;
}

export function createEmptyRuntimeState(): RuntimeState {
  return resolveStore().createEmpty();
}

export function loadRuntimeState(stateDir: string): RuntimeState {
  return resolveStore().load(stateDir);
}

export function saveRuntimeState(stateDir: string, state: RuntimeState): void {
  return resolveStore().save(stateDir, state);
}

export type WorkerStatus = "idle" | "busy" | "offline" | "disabled";

export type TaskStatus = "planned" | "ready" | "assigned" | "in_progress" | "review" | "merged" | "blocked" | "failed" | "cancelled";

export type AssignmentStatus = "pending" | "assigned" | "in_progress" | "review" | "merged" | "blocked" | "failed" | "cancelled";

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
  chatMode?: string;
  continuationMode?: string;
  continueFromTaskId?: string | null;
  followUpOfTaskId?: string | null;
  workerChangeReason?: string | null;
  status: TaskStatus;
  assignedWorkerId?: string | null;
  lastAssignedWorkerId?: string | null;
  requestedBy: string;
  createdAt: string;
}

export interface Event {
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

export interface GetAssignedTaskResult {
  task: Task;
  assignment: AssignmentPayload;
  workerPrompt?: string;
  contextMarkdown?: string;
  workerPromptMode?: "auto" | "custom";
  reportSchemaVersion?: "trae-v1";
  chatMode?: string;
  continuationMode?: string;
  continueFromTaskId?: string | null;
  followUpOfTaskId?: string | null;
  workerChangeReason?: string | null;
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
}

export interface RecordWorkerResultInput {
  workerId: string;
  attemptId?: string;
  leaseToken?: string;
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
}

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
    branchProtectionHitCount: number;
    leaseConflictCount: number;
    leaseReclaimCount: number;
    activeLeases: {
      total: number;
      byResourceType: Record<LeaseResourceType, number>;
    };
    repoConcurrencySaturation: Record<string, {
      activeWorkers: number;
      busyWorkers: number;
      saturationPct: number;
    }>;
    failureCodes: Record<string, number>;
    reviewReasonCodes: Record<string, number>;
  };
  workers: Worker[];
  tasks: Task[];
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
  };
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
  const nextEvents = [...state.events, nextEvent];
  return {
    ...state,
    events: nextEvents.length > RUNTIME_EVENTS_RETENTION_LIMIT
      ? nextEvents.slice(-RUNTIME_EVENTS_RETENTION_LIMIT)
      : nextEvents,
  };
}

function countEventsByType(events: Event[], type: string): number {
  return events.filter((event) => event.type === type).length;
}

function countActiveLeasesByResourceType(leases: RuntimeLease[], at: string): Record<LeaseResourceType, number> {
  const counts: Record<LeaseResourceType, number> = {
    assignment: 0,
  };

  for (const lease of listActiveLeases(leases, at)) {
    counts[lease.resourceType] += 1;
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
  if (activeAttempt) {
    return {
      ...state,
      taskAttempts: upsertTaskAttempt(state.taskAttempts ?? [], {
        ...activeAttempt,
        workerId,
        leaseToken: `assignment:${workerId}`,
        status: activeAttempt.status === "created" ? "leased" : activeAttempt.status,
        heartbeatAt: at,
        leaseExpiresAt: new Date(Date.parse(at) + DEFAULT_LEASE_TTL_MS).toISOString(),
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
      leaseExpiresAt: new Date(Date.parse(at) + DEFAULT_LEASE_TTL_MS).toISOString(),
      idempotencyKey: `v0:${task.id}:attempt-${attemptNo}`,
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
    changedFiles: normalizeArtifactChangedFiles(input.changedFiles),
    refs: {
      structuredReport: `artifact://${input.attempt.attemptId}/result.json`,
    },
    ...rawBundle,
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

function assertActiveAttemptLease(
  state: RuntimeState,
  taskId: string,
  workerId: string,
  input: {
    attemptId?: string;
    leaseToken?: string;
  },
): void {
  if (!input.attemptId && !input.leaseToken) {
    return;
  }

  const activeAttempt = findActiveTaskAttempt(state, taskId);
  if (!activeAttempt) {
    throw new Error(`active attempt not found for task: ${taskId}`);
  }
  if (activeAttempt.workerId !== workerId) {
    throw new Error(`attempt owned by another worker: ${activeAttempt.workerId}`);
  }
  if (input.attemptId && input.attemptId !== activeAttempt.attemptId) {
    throw new Error(`attempt id mismatch: ${input.attemptId}`);
  }
  if (input.leaseToken && input.leaseToken !== activeAttempt.leaseToken) {
    throw new Error(`lease token mismatch: ${taskId}`);
  }
}

function acquireAssignmentLease(
  state: RuntimeState,
  taskId: string,
  workerId: string,
  at: string,
): {
  state: RuntimeState;
  acquired: boolean;
} {
  const result = acquireLease(state.leases ?? [], {
    resourceType: "assignment",
    resourceId: taskId,
    ownerId: workerId,
    ownerToken: `assignment:${workerId}`,
    at,
    ttlMs: DEFAULT_LEASE_TTL_MS,
    metadata: {
      taskId,
      workerId,
    },
  });

  let nextState: RuntimeState = {
    ...state,
    leases: result.leases,
  };

  nextState = appendEvent(nextState, {
    taskId,
    type: result.acquired ? "lease_acquired" : "lease_conflict",
    at,
    payload: {
      resourceType: "assignment",
      resourceId: taskId,
      ownerId: workerId,
      conflictingOwnerId: result.conflictedWith?.ownerId ?? null,
    },
  });

  return {
    state: nextState,
    acquired: result.acquired,
  };
}

function releaseAssignmentLease(
  state: RuntimeState,
  taskId: string,
  workerId: string,
  at: string,
  reclaimReason?: string | null,
): RuntimeState {
  const result = releaseLease(state.leases ?? [], {
    resourceType: "assignment",
    resourceId: taskId,
    ownerId: workerId,
    ownerToken: `assignment:${workerId}`,
    at,
    reclaimReason: reclaimReason ?? null,
  });
  if (!result.releasedLease) {
    return state;
  }

  return appendEvent({
    ...state,
    leases: result.leases,
  }, {
    taskId,
    type: reclaimReason ? "lease_reclaimed" : "lease_released",
    at,
    payload: {
      resourceType: "assignment",
      resourceId: taskId,
      ownerId: workerId,
      reclaimReason: reclaimReason ?? null,
    },
  });
}

function resolveHeartbeatTimeoutMs(options: ReconcileOptions = {}): number {
  return options.heartbeatTimeoutMs ?? 5 * 60_000;
}

function resolveAssignmentTimeoutMs(options: ReconcileOptions = {}): number {
  return options.assignmentTimeoutMs ?? 5 * 60_000;
}

function resolveWorkerStatus(worker: Worker, options: ReconcileOptions = {}): WorkerStatus {
  if (worker.disabledAt) {
    return "disabled";
  }

  const now = Date.parse(options.now ?? nowIso());
  const heartbeatTimeoutMs = resolveHeartbeatTimeoutMs(options);
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

function hasHealthyIdleAlternative(state: RuntimeState, pool: string, workerId: string, options: ReconcileOptions = {}): boolean {
  return state.workers.some((worker) =>
    worker.id !== workerId &&
    worker.pool === pool &&
    worker.status === "idle" &&
    !worker.disabledAt &&
    resolveWorkerStatus(worker, options) === "idle");
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

function isAssignmentTimedOut(assignment: Assignment | undefined, worker: Worker | undefined, options: ReconcileOptions = {}): boolean {
  if (!assignment?.assignedAt || assignmentWasClaimed(assignment)) {
    return false;
  }

  const now = Date.parse(options.now ?? nowIso());
  const assignedAt = Date.parse(assignment.assignedAt);
  if (!Number.isFinite(now) || !Number.isFinite(assignedAt)) {
    return false;
  }

  if (now - assignedAt <= resolveAssignmentTimeoutMs(options)) {
    return false;
  }

  return !didWorkerHeartbeatAfterAssignment(worker, assignment);
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

  for (const worker of state.workers) {
    const assignedTask = worker.currentTaskId
      ? nextState.tasks.find((candidate) => candidate.id === worker.currentTaskId)
      : null;
    const assignment = worker.currentTaskId
      ? nextState.assignments.find((candidate) => candidate.taskId === worker.currentTaskId)
      : null;
    const workerResolvedStatus = resolveWorkerStatus(worker, options);
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
      isAssignmentTimedOut(assignment, worker, options);

    if (
      shouldRequeueBecauseOffline ||
      shouldRequeueBecauseTimeout
    ) {
      nextState = releaseAssignmentLease(nextState, assignedTask.id, worker.id, at, shouldRequeueBecauseOffline ? "worker_offline" : "assignment_timeout");
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
        ...worker,
        status: shouldRequeueBecauseTimeout || workerResolvedStatus === "offline" ? "offline" : "idle",
        currentTaskId: shouldRequeueBecauseOffline || shouldRequeueBecauseTimeout
          ? undefined
          : worker.currentTaskId,
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

  return {
    ...state,
    updatedAt: input.at ?? nowIso(),
    workers: upsertWorker(state.workers, {
      ...worker,
      lastHeartbeatAt: input.at ?? nowIso(),
      status: hasActiveTask ? "busy" : (previousStatus === "offline" ? "idle" : previousStatus),
    }),
  };
}

export function createDispatch(state: RuntimeState, input: CreateDispatchInput): CreateDispatchResult {
  const dispatchSeed = nextDispatchId(state);
  let nextState = dispatchSeed.state;
  const dispatchId = dispatchSeed.dispatchId;
  const assignments: Assignment[] = [];
  const taskIds: string[] = [];
  const createdAt = input.createdAt ?? nowIso();

  for (const taskInput of input.tasks) {
    const taskId = `${dispatchId}:${taskInput.id}`;
    taskIds.push(taskId);
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

  return {
    task,
    assignment: assignment.assignment,
    workerPrompt: assignment.workerPrompt,
    contextMarkdown: assignment.contextMarkdown,
    workerPromptMode: assignment.workerPromptMode,
    reportSchemaVersion: assignment.reportSchemaVersion,
    chatMode: (assignment as { chatMode?: string }).chatMode ?? task.chatMode ?? "new_chat",
    continuationMode: (assignment as { continuationMode?: string }).continuationMode ?? task.continuationMode,
    continueFromTaskId: (assignment as { continueFromTaskId?: string | null }).continueFromTaskId ?? task.continueFromTaskId ?? null,
  };
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
    const leaseResult = acquireAssignmentLease(nextState, existingAssignment.task.id, input.workerId, at);
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
      assignment: existingAssignment,
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
    const leaseResult = acquireAssignmentLease(nextState, preAssignedTask.id, input.workerId, at);
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
      assignment: {
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
      },
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
      });
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

  const leaseResult = acquireAssignmentLease(nextState, readyTask.id, worker.id, at);
  nextState = leaseResult.state;
  if (!leaseResult.acquired) {
    return {
      state: nextState,
      assignment: null,
    };
  }

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
    assignment: {
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
    },
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

  if (task.status === "in_progress") {
    return state;
  }

  if (task.status !== "assigned" || assignment.status !== "assigned") {
    throw new Error(`task not ready to start: ${input.taskId}`);
  }

  const at = input.at ?? nowIso();
  assertActiveAttemptLease(state, input.taskId, input.workerId, input);
  const leaseResult = acquireAssignmentLease(state, input.taskId, input.workerId, at);
  if (!leaseResult.acquired) {
    throw new Error(`assignment lease not available: ${input.taskId}`);
  }
  let nextState = updateActiveTaskAttempt(leaseResult.state, input.taskId, (attempt) => ({
    ...attempt,
    status: "running",
    startedAt: attempt.startedAt ?? at,
    heartbeatAt: at,
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
  if (task.assignedWorkerId !== input.workerId) {
    throw new Error(`task not assigned to worker: ${input.workerId}`);
  }
  const activeAssignmentLease = listActiveLeases(state.leases ?? [], input.result.generatedAt ?? nowIso())
    .find((lease) => lease.resourceType === "assignment" && lease.resourceId === task.id);
  if (activeAssignmentLease && activeAssignmentLease.ownerId !== input.workerId) {
    throw new Error(`assignment lease owned by another worker: ${activeAssignmentLease.ownerId}`);
  }
  if (!["assigned", "in_progress"].includes(task.status)) {
    throw new Error(`task not executable: ${task.id}`);
  }
  assertActiveAttemptLease(state, task.id, input.workerId, input);
  const currentReview = state.reviews.find((candidate) => candidate.taskId === task.id);
  const canonicalResult = buildCanonicalWorkerResult(task, input.workerId, input.result);
  const canonicalPullRequest = canonicalizePullRequest(task, input.pullRequest);
  const activeAttempt = findActiveTaskAttempt(state, task.id);
  const hasExplicitArtifactBundle = Boolean(input.artifactBundle ?? input.result.artifactBundle);
  if (!activeAttempt && hasExplicitArtifactBundle) {
    throw new Error(`active attempt not found for task: ${task.id}`);
  }
  const artifactBundle = activeAttempt
    ? buildArtifactBundle({
        task,
        attempt: activeAttempt,
        result: canonicalResult,
        artifactBundle: input.artifactBundle ?? input.result.artifactBundle,
        changedFiles: input.changedFiles,
        pullRequest: canonicalPullRequest,
      })
    : null;

  const nextStatus = canonicalResult.verification.allPassed ? "review" : "failed";
  const reviewMaterial = canonicalResult.verification.allPassed
    ? {
        repo: task.repo,
        title: task.title,
        changedFiles: input.changedFiles ?? [],
        selfTestPassed: true,
        checks: canonicalResult.verification.commands.map((item) => item.command),
        pullRequest: canonicalPullRequest,
      }
    : null;

  let nextState = state;
  if (task.status === "assigned") {
    nextState = appendEvent(nextState, {
      taskId: task.id,
      type: "status_changed",
      at: canonicalResult.generatedAt,
      payload: {
        from: "assigned",
        to: "in_progress",
      },
    });
  }
  nextState = appendEvent(nextState, {
    taskId: task.id,
    type: "status_changed",
    at: canonicalResult.generatedAt,
    payload: {
      from: "in_progress",
      to: nextStatus,
    },
  });

  nextState = {
    ...nextState,
    updatedAt: canonicalResult.generatedAt,
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
      lastHeartbeatAt: canonicalResult.generatedAt,
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
    }),
  };

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
        createdAt: canonicalResult.generatedAt,
        updatedAt: canonicalResult.generatedAt,
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
      at: artifactBundle.createdAt ?? canonicalResult.generatedAt,
      payload: {
        attemptId: artifactBundle.attemptId,
        bundleId: artifactBundle.bundleId,
      },
    });
  }

  nextState = updateActiveTaskAttempt(nextState, task.id, (attempt) => ({
    ...attempt,
    status: canonicalResult.verification.allPassed ? "succeeded" : "failed",
    heartbeatAt: canonicalResult.generatedAt,
    endedAt: canonicalResult.generatedAt,
    failureCode: canonicalResult.verification.allPassed ? undefined : "verification_failed",
    failureMessage: canonicalResult.verification.allPassed ? undefined : canonicalResult.output,
    artifactBundleId: artifactBundle?.bundleId ?? attempt.artifactBundleId,
  }));

  return releaseAssignmentLease(nextState, task.id, input.workerId, canonicalResult.generatedAt);
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

  const nextStatus = input.decision === "merge" ? "merged" : "blocked";
  let nextState = appendEvent(state, {
    taskId: task.id,
    type: "status_changed",
    at: input.at ?? nowIso(),
    payload: {
      from: "review",
      to: nextStatus,
    },
  });
  nextState = appendEvent(nextState, {
    taskId: task.id,
    type: "review_decided",
    at: input.at ?? nowIso(),
    payload: {
      decision: input.decision,
      actor: input.actor,
      notes: input.notes ?? "",
      evidence: input.evidence ?? review?.evidence ?? null,
    },
  });

  nextState = {
    ...nextState,
    updatedAt: input.at ?? nowIso(),
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
      decidedAt: input.at ?? nowIso(),
      reviewMaterial: review?.reviewMaterial ?? null,
      latestWorkerResult: review?.latestWorkerResult ?? null,
      evidence: input.evidence ?? review?.evidence ?? null,
    }),
  };

  const pullRequest = nextState.pullRequests.find((candidate) => candidate.taskId === task.id);
  if (pullRequest) {
    nextState = {
      ...nextState,
      pullRequests: upsertPullRequest(nextState.pullRequests, {
        ...pullRequest,
        status: input.decision === "merge" ? "merged" : "changes_requested",
        updatedAt: input.at ?? nowIso(),
      }),
    };
  }

  if (!task.assignedWorkerId) {
    return nextState;
  }
  return releaseAssignmentLease(nextState, task.id, task.assignedWorkerId, input.at ?? nowIso());
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
    ? releaseAssignmentLease(nextState, task.id, task.assignedWorkerId, at, "cancelled")
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
    },
    workers,
    tasks: clone([...reconciledState.tasks].reverse()),
    assignments: clone(reconciledState.assignments),
    reviews: clone(reconciledState.reviews),
    pullRequests: clone(reconciledState.pullRequests),
    events: clone(reconciledState.events.slice(-50).reverse()),
    dispatches: clone(reconciledState.dispatches),
    leases: clone(reconciledState.leases ?? []),
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
    nextState = releaseAssignmentLease(nextState, worker.currentTaskId, input.workerId, at, input.reason ?? "worker_offline");
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
