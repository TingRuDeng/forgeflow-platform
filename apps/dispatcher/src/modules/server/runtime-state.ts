import { jsonStore } from "./runtime-state-json.js";
import { sqliteStore } from "./runtime-state-sqlite.js";
import type { RuntimeStateStore } from "./runtime-state-store.js";
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

export type TaskStatus = "planned" | "ready" | "assigned" | "in_progress" | "review" | "merged" | "blocked" | "failed";

export type AssignmentStatus = "pending" | "assigned" | "in_progress" | "review" | "merged" | "blocked" | "failed";

export type ReviewDecision = "pending" | "merge" | "block" | "rework" | "changes_requested";

export type PullRequestStatus = "opened" | "merged" | "changes_requested";

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
  payload?: unknown;
}

export interface AssignmentPayload {
  taskId: string;
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
  events: Event[];
  assignments: Assignment[];
  reviews: Review[];
  pullRequests: PullRequest[];
  dispatches: Dispatch[];
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
}

export interface RecordWorkerResultInput {
  workerId: string;
  result: WorkerResult;
  changedFiles?: string[];
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
    };
  };
  workers: Worker[];
  tasks: Task[];
  assignments: Assignment[];
  reviews: Review[];
  pullRequests: PullRequest[];
  events: Event[];
  dispatches: Dispatch[];
}

function nowIso(): string {
  return formatLocalTimestamp();
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
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
  const nextEvents = [...state.events, event];
  return {
    ...state,
    events: nextEvents.length > RUNTIME_EVENTS_RETENTION_LIMIT
      ? nextEvents.slice(-RUNTIME_EVENTS_RETENTION_LIMIT)
      : nextEvents,
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

function upsertReview(reviews: Review[], review: Review): Review[] {
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

function resolveHeartbeatTimeoutMs(options: ReconcileOptions = {}): number {
  return options.heartbeatTimeoutMs ?? 30_000;
}

function resolveAssignmentTimeoutMs(options: ReconcileOptions = {}): number {
  return options.assignmentTimeoutMs ?? 60_000;
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
  let nextState = state;

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
        status: workerResolvedStatus === "offline" ? "offline" : "idle",
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
  let nextState = reconcileRuntimeState(dispatchSeed.state, {
    now: input.createdAt ?? nowIso(),
  });
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
    let worker: Worker | null = null;
    let hasTargetWorkerConstraint = false;
    if (targetWorkerId) {
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
    if (!worker && !hasTargetWorkerConstraint) {
      worker = selectWorker(nextState, taskInput.pool, {
        now: createdAt,
      }) ?? null;
    }

    const task: Task = {
      id: taskId,
      externalTaskId: taskInput.id,
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
      status: worker ? "assigned" : "ready",
      assignedWorkerId: worker?.id ?? null,
      lastAssignedWorkerId: worker?.id ?? null,
      requestedBy: input.requestedBy ?? "unknown",
      createdAt,
    };

    nextState = appendEvent(nextState, {
      taskId,
      type: "created",
      at: createdAt,
      payload: { status: "planned" },
    });
    nextState = appendEvent(nextState, {
      taskId,
      type: "status_changed",
      at: createdAt,
      payload: {
        from: "planned",
        to: worker ? "assigned" : "ready",
      },
    });

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
    chatMode: (assignment as { chatMode?: string }).chatMode ?? task.chatMode ?? "new_chat",
    continuationMode: (assignment as { continuationMode?: string }).continuationMode ?? task.continuationMode,
    continueFromTaskId: (assignment as { continueFromTaskId?: string | null }).continueFromTaskId ?? task.continueFromTaskId ?? null,
  };
}

export function claimAssignedTaskForWorker(state: RuntimeState, input: ClaimAssignedTaskInput): ClaimAssignedTaskResult {
  const at = input.at ?? nowIso();
  const reconciledState = reconcileRuntimeState(state, {
    now: at,
    heartbeatTimeoutMs: input.heartbeatTimeoutMs,
    assignmentTimeoutMs: input.assignmentTimeoutMs,
  });
  const worker = reconciledState.workers.find((candidate) => candidate.id === input.workerId);
  if (!worker) {
    throw new Error(`worker not found: ${input.workerId}`);
  }

  if (worker.disabledAt) {
    return {
      state: reconciledState,
      assignment: null,
    };
  }

  const existingAssignment = getAssignedTaskForWorker(reconciledState, input.workerId);
  if (existingAssignment) {
    const assignedTask = reconciledState.tasks.find((candidate) => candidate.id === existingAssignment.task.id);
    const assignmentRecord = reconciledState.assignments.find((candidate) => candidate.taskId === existingAssignment.task.id);
    let nextState = reconciledState;
    if (assignedTask?.status === "assigned" && assignmentRecord?.status === "assigned" && !assignmentRecord.claimedAt) {
      nextState = {
        ...appendEvent(reconciledState, {
          taskId: assignedTask.id,
          type: "assignment_claimed",
          at,
          payload: {
            workerId: input.workerId,
          },
        }),
        updatedAt: at,
        assignments: upsertAssignment(reconciledState.assignments, {
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

  if (worker.status !== "idle") {
    return {
      state: reconciledState,
      assignment: null,
    };
  }

  const readyTask = [...reconciledState.tasks]
    .filter((task) => task.pool === worker.pool && task.status === "ready")
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
  let nextState = appendEvent(state, {
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
  const task = state.tasks.find((candidate) => candidate.id === input.result.taskId);
  if (!task) {
    throw new Error(`task not found: ${input.result.taskId}`);
  }
  const assignment = state.assignments.find((candidate) => candidate.taskId === input.result.taskId);
  if (!assignment) {
    throw new Error(`assignment not found for task: ${input.result.taskId}`);
  }

  const worker = state.workers.find((candidate) => candidate.id === input.workerId);
  if (!worker) {
    throw new Error(`worker not found: ${input.workerId}`);
  }
  if (task.assignedWorkerId !== input.workerId) {
    throw new Error(`task not assigned to worker: ${input.workerId}`);
  }
  if (!["assigned", "in_progress"].includes(task.status)) {
    throw new Error(`task not executable: ${input.result.taskId}`);
  }
  const currentReview = state.reviews.find((candidate) => candidate.taskId === input.result.taskId);

  const nextStatus = input.result.verification.allPassed ? "review" : "failed";
  const reviewMaterial = input.result.verification.allPassed
    ? {
        repo: task.repo,
        title: task.title,
        changedFiles: input.changedFiles ?? [],
        selfTestPassed: true,
        checks: input.result.verification.commands.map((item) => item.command),
        pullRequest: input.pullRequest ?? null,
      }
    : null;

  let nextState = state;
  if (task.status === "assigned") {
    nextState = appendEvent(nextState, {
      taskId: task.id,
      type: "status_changed",
      at: input.result.generatedAt,
      payload: {
        from: "assigned",
        to: "in_progress",
      },
    });
  }
  nextState = appendEvent(nextState, {
    taskId: task.id,
    type: "status_changed",
    at: input.result.generatedAt,
    payload: {
      from: "in_progress",
      to: nextStatus,
    },
  });

  nextState = {
    ...nextState,
    updatedAt: input.result.generatedAt,
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
      lastHeartbeatAt: input.result.generatedAt,
    }),
    reviews: upsertReview(nextState.reviews, {
      taskId: task.id,
      decision: "pending",
      actor: null,
      notes: "",
      decidedAt: null,
      reviewMaterial,
      latestWorkerResult: clone(input.result),
      evidence: currentReview?.evidence ?? null,
    }),
  };

  if (input.pullRequest) {
    nextState = {
      ...nextState,
      pullRequests: upsertPullRequest(nextState.pullRequests, {
        taskId: task.id,
        number: input.pullRequest.number,
        url: input.pullRequest.url,
        headBranch: input.pullRequest.headBranch,
        baseBranch: input.pullRequest.baseBranch,
        title: task.title,
        status: "opened",
        createdAt: input.result.generatedAt,
        updatedAt: input.result.generatedAt,
      }),
    };
  }

  return nextState;
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

  return nextState;
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

export function buildDashboardSnapshot(state: RuntimeState, options: ReconcileOptions = {}): DashboardSnapshot {
  const reconciledState = reconcileRuntimeState(state, options);
  const workers = resolveWorkerStatuses(reconciledState.workers, options);

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
      },
    },
    workers,
    tasks: clone([...reconciledState.tasks].reverse()),
    assignments: clone(reconciledState.assignments),
    reviews: clone(reconciledState.reviews),
    pullRequests: clone(reconciledState.pullRequests),
    events: clone(reconciledState.events.slice(-50).reverse()),
    dispatches: clone(reconciledState.dispatches),
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
