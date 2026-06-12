import type {
  RuntimeState,
  Worker,
  Task,
  Assignment,
  Event,
  Review,
} from "./runtime-state.js";
import {
  beginTaskForWorker,
  claimAssignedTaskForWorker,
  heartbeatWorker as heartbeatWorkerFn,
  registerWorker as registerWorkerFn,
  recordWorkerResult as recordWorkerResultFn,
  reconcileRuntimeState as reconcileRuntimeStateFn,
} from "./runtime-state.js";

import type {
  JsonResponse,
  TraeFetchTaskRequest,
  TraeSubmitResultRequest,
  TraeHeartbeatRequest,
  TraeReportProgressRequest,
  TraeRegisterRequest,
  TraeStartTaskRequest,
  ArtifactBundle,
  WorkerEvidence,
} from "./runtime-glue-types.js";
import { formatLocalTimestamp } from "../time.js";

function nowIso(): string {
  return formatLocalTimestamp();
}

const RUNTIME_EVENTS_RETENTION_LIMIT = 500;
const TERMINAL_ATTEMPT_STATUSES = new Set(["succeeded", "failed", "expired", "cancelled", "superseded"]);

function findActiveTaskAttempt(state: RuntimeState, taskId: string) {
  return (state.taskAttempts ?? []).find((attempt) =>
    attempt.taskId === taskId && !TERMINAL_ATTEMPT_STATUSES.has(attempt.status)
  ) ?? null;
}

function appendRuntimeEvent(state: RuntimeState, event: Event): void {
  state.events.push(event);
  if (state.events.length > RUNTIME_EVENTS_RETENTION_LIMIT) {
    state.events.splice(0, state.events.length - RUNTIME_EVENTS_RETENTION_LIMIT);
  }
}

function isSessionInterrupted(input: {
  summary?: string;
  testOutput?: string;
  evidence?: WorkerEvidence;
}): boolean {
  const text = [
    input.summary,
    input.testOutput,
    input.evidence?.failureSummary,
    ...(input.evidence?.blockers ?? []).map((blocker) => blocker.message),
  ]
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .join("\n")
    .toLowerCase();

  return text.includes("interrupted") || text.includes("session interrupted");
}

function classifyTraeMutationError(error?: string): number {
  if (error === "task_not_found" || error === "worker_not_found") {
    return 404;
  }
  if (
    error?.startsWith("unsupported worker protocol version:")
    || error?.startsWith("worker protocol v1 envelope incomplete:")
  ) {
    return 400;
  }
  return 409;
}

interface WorkerProtocolEnvelopeInput {
  attemptId?: string;
  leaseToken?: string;
  protocolVersion?: string;
  traceId?: string;
  idempotencyKey?: string;
}

function upsertWorkerRepoDir(
  state: RuntimeState,
  workerId: string,
  repoDir: string,
): RuntimeState {
  const worker = state.workers.find((candidate) => candidate.id === workerId);
  if (!worker || worker.repoDir === repoDir) {
    return state;
  }

  return {
    ...state,
    updatedAt: nowIso(),
    workers: state.workers.map((candidate) => candidate.id === workerId
      ? {
          ...candidate,
          repoDir,
        }
      : candidate),
  };
}

function overwriteRuntimeState(target: RuntimeState, source: RuntimeState): void {
  target.version = source.version;
  target.updatedAt = source.updatedAt;
  target.sequence = source.sequence;
  target.workers = source.workers;
  target.tasks = source.tasks;
  target.taskAttempts = source.taskAttempts;
  target.artifactBundles = source.artifactBundles;
  target.events = source.events;
  target.assignments = source.assignments;
  target.reviews = source.reviews;
  target.pullRequests = source.pullRequests;
  target.dispatches = source.dispatches;
  target.leases = source.leases;
}

export type { WorkerStatus } from "./runtime-glue-types.js";

export interface BuildTraeWorktreeDirsResult {
  worktree_dir: string;
  assignment_dir: string;
}

export function buildTraeWorktreeAndAssignmentDirs(
  stateDir: string,
  repoDir: string,
  task: Task
): BuildTraeWorktreeDirsResult {
  const baseWorktreeRoot = repoDir
    ? `${repoDir}/.worktrees`
    : `${stateDir}/../worktrees`;
  const worktreeDir = `${baseWorktreeRoot}/${safeTaskDirName(task.id)}`;
  const assignmentDir = `${worktreeDir}/.orchestrator/assignments/${safeTaskDirName(task.id)}`;
  return { worktree_dir: worktreeDir, assignment_dir: assignmentDir };
}

export function safeTaskDirName(taskId: string): string {
  return taskId.replace(/[^a-zA-Z0-9_-]/g, "-");
}

export function buildTraeConstraints(task: Task): string[] {
  return [
    `allowedPaths: ${(task.allowedPaths ?? []).join(", ") || "all"}`,
    "do not expand the scope beyond allowedPaths",
    `must run acceptance: ${(task.acceptance ?? []).join(", ") || "none"}`,
    "do not modify .orchestrator files",
    "commit and push changes before submitting result",
  ];
}

export interface FindTraeTaskResult {
  task: Task | null;
  assignment: Assignment | null;
  workerPrompt: string;
  contextMarkdown: string;
  workerPromptMode?: "auto" | "custom";
  reportSchemaVersion?: "trae-v1";
  constraints: string[];
  dirs: BuildTraeWorktreeDirsResult;
  chatMode: string;
  continuationMode?: string;
  continueFromTaskId?: string | null;
}

export function findTraeTaskForWorker(
  state: RuntimeState,
  workerId: string,
  repoDirInput?: string
): FindTraeTaskResult {
  let nextState = state;
  let worker = nextState.workers.find((candidate) => candidate.id === workerId);
  if (!worker) {
    nextState = registerWorkerFn(nextState, {
      workerId,
      pool: "trae",
      hostname: "",
      labels: [],
      repoDir: repoDirInput ?? "",
      at: nowIso(),
    });
  } else if (repoDirInput) {
    nextState = upsertWorkerRepoDir(nextState, workerId, repoDirInput);
  }

  overwriteRuntimeState(state, nextState);

  const claimed = claimAssignedTaskForWorker(state, {
    workerId,
    at: nowIso(),
  });
  overwriteRuntimeState(state, claimed.state);

  worker = state.workers.find((candidate) => candidate.id === workerId);
  const repoDir = worker?.repoDir || repoDirInput || "";
  let resolvedAssignment = claimed.assignment;
  if (!resolvedAssignment) {
    const recoveryTask = state.tasks.find((candidate) =>
      candidate.pool === "trae"
      && candidate.assignedWorkerId === workerId
      && (candidate.status === "assigned" || candidate.status === "in_progress"));
    if (recoveryTask) {
      if (worker && worker.currentTaskId !== recoveryTask.id) {
        overwriteRuntimeState(state, {
          ...state,
          updatedAt: nowIso(),
          workers: state.workers.map((candidate) => candidate.id === workerId
            ? {
                ...candidate,
                status: "busy",
                currentTaskId: recoveryTask.id,
                lastHeartbeatAt: nowIso(),
              }
            : candidate),
        });
        worker = state.workers.find((candidate) => candidate.id === workerId);
      }

      const recoveryRecord = state.assignments.find((candidate) => candidate.taskId === recoveryTask.id);
      if (recoveryRecord) {
        resolvedAssignment = {
          task: recoveryTask,
          assignment: recoveryRecord.assignment,
          workerPrompt: recoveryRecord.workerPrompt,
          contextMarkdown: recoveryRecord.contextMarkdown,
          workerPromptMode: recoveryRecord.workerPromptMode,
          reportSchemaVersion: recoveryRecord.reportSchemaVersion,
          chatMode: (recoveryRecord as Assignment & { chatMode?: string }).chatMode ?? recoveryTask.chatMode ?? "new_chat",
          continuationMode: (recoveryRecord as Assignment & { continuationMode?: string }).continuationMode ?? recoveryTask.continuationMode,
          continueFromTaskId: (recoveryRecord as Assignment & { continueFromTaskId?: string | null }).continueFromTaskId ?? recoveryTask.continueFromTaskId ?? null,
          followUpOfTaskId: (recoveryRecord as Assignment & { followUpOfTaskId?: string | null }).followUpOfTaskId ?? recoveryTask.followUpOfTaskId ?? null,
          workerChangeReason: (recoveryRecord as Assignment & { workerChangeReason?: string | null }).workerChangeReason ?? recoveryTask.workerChangeReason ?? null,
        };
      }
    }
  }

  if (!resolvedAssignment) {
    return {
      task: null,
      assignment: null,
      workerPrompt: "",
      contextMarkdown: "",
      constraints: [],
      dirs: { worktree_dir: "", assignment_dir: "" },
      chatMode: "new_chat",
    };
  }

  const task = resolvedAssignment.task;
  const assignment = state.assignments.find((a) => a.taskId === task.id) ?? null;
  const workerPrompt = assignment?.workerPrompt ?? "";
  const contextMarkdown = assignment?.contextMarkdown ?? "";
  const workerPromptMode = assignment?.workerPromptMode;
  const reportSchemaVersion = assignment?.reportSchemaVersion;

  const constraints = buildTraeConstraints(task);

  const workerRepoDir = worker?.repoDir || "";
  const dirs = assignment
    ? buildTraeWorktreeAndAssignmentDirs(workerRepoDir, repoDir, task)
    : { worktree_dir: "", assignment_dir: "" };

  const chatMode = (assignment as Assignment & { chatMode?: string })?.chatMode
    ?? (task as Task & { chatMode?: string })?.chatMode
    ?? "new_chat";

  const continuationMode = (assignment as Assignment & { continuationMode?: string })?.continuationMode
    ?? (task as Task & { continuationMode?: string })?.continuationMode;

  const continueFromTaskId = (assignment as Assignment & { continueFromTaskId?: string | null })?.continueFromTaskId
    ?? (task as Task & { continueFromTaskId?: string | null })?.continueFromTaskId
    ?? null;

  return {
    task,
    assignment,
    workerPrompt,
    contextMarkdown,
    workerPromptMode,
    reportSchemaVersion,
    constraints,
    dirs,
    chatMode,
    continuationMode,
    continueFromTaskId,
  };
}

export function applyTraeSubmitResult(
  state: RuntimeState,
  input: {
    taskId: string;
    attemptId?: string;
    leaseToken?: string;
    protocolVersion?: string;
    traceId?: string;
    idempotencyKey?: string;
    status: "review_ready" | "failed";
    summary?: string;
    testOutput?: string;
    risks?: string[];
    filesChanged?: string[];
    branchName?: string;
    commitSha?: string;
    pushStatus?: string;
    pushError?: string;
    prNumber?: number;
    prUrl?: string;
    evidence?: WorkerEvidence;
    artifactBundle?: ArtifactBundle;
  }
): { state: RuntimeState; ok: boolean; error?: string } {
  const task = state.tasks.find((t) => t.id === input.taskId);
  if (!task) {
    return { state, ok: false, error: "task_not_found" };
  }

  const assignment = state.assignments.find((item) => item.taskId === input.taskId);
  const workerId = task.assignedWorkerId
    ?? assignment?.workerId
    ?? state.workers.find((candidate) => candidate.currentTaskId === input.taskId)?.id
    ?? null;
  if (!workerId) {
    return { state, ok: false, error: "worker_not_found" };
  }

  try {
    const nextState = recordWorkerResultFn(state, {
      workerId,
      attemptId: input.attemptId,
      leaseToken: input.leaseToken,
      protocolVersion: input.protocolVersion,
      traceId: input.traceId,
      idempotencyKey: input.idempotencyKey,
      result: {
        taskId: input.taskId,
        workerId,
        provider: "trae",
        pool: task.pool,
        branchName: input.branchName ?? task.branchName,
        repo: task.repo,
        defaultBranch: task.defaultBranch,
        mode: task.verification.mode,
        output: input.summary ?? "",
        generatedAt: nowIso(),
        verification: {
          allPassed: input.status === "review_ready",
          commands: input.testOutput
            ? [
                {
                  command: "trae:test_output",
                  exitCode: input.status === "review_ready" ? 0 : 1,
                  output: input.testOutput,
                },
              ]
            : [],
        },
        evidence: input.evidence,
      },
      artifactBundle: input.artifactBundle,
      changedFiles: input.filesChanged,
      pullRequest: input.prNumber && input.prUrl
        ? {
            number: input.prNumber,
            url: input.prUrl,
            headBranch: input.branchName ?? task.branchName,
            baseBranch: task.defaultBranch,
          }
        : null,
    });
    if (input.status === "failed" && isSessionInterrupted(input)) {
      appendRuntimeEvent(nextState, {
        taskId: input.taskId,
        type: "session_interrupted",
        at: nowIso(),
        payload: {
          workerId,
        },
      });
    }
    overwriteRuntimeState(state, nextState);
    return { state, ok: true };
  } catch (error) {
    return {
      state,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function applyTraeHeartbeat(
  state: RuntimeState,
  workerId: string
): { state: RuntimeState; worker: Worker | null } {
  let nextState = state;
  const existingWorker = nextState.workers.find((candidate) => candidate.id === workerId);
  if (!existingWorker) {
    nextState = registerWorkerFn(nextState, {
      workerId,
      pool: "trae",
      hostname: "",
      labels: [],
      repoDir: "",
      at: nowIso(),
    });
  }

  nextState = reconcileRuntimeStateFn(heartbeatWorkerFn(nextState, {
    workerId,
    at: nowIso(),
  }));
  overwriteRuntimeState(state, nextState);
  return {
    state,
    worker: state.workers.find((candidate) => candidate.id === workerId) ?? null,
  };
}

export function applyTraeReportProgress(
  state: RuntimeState,
  taskId: string,
  message: string,
  workerId?: string
): RuntimeState {
  appendRuntimeEvent(state, {
    taskId,
    type: "progress_reported",
    at: nowIso(),
    payload: { message, worker_id: workerId },
  });
  return state;
}

export function applyTraeStartTask(
  state: RuntimeState,
  workerId: string,
  taskId: string,
  attemptLease: WorkerProtocolEnvelopeInput = {},
): { state: RuntimeState; worker: Worker | null; ok: boolean; error?: string } {
  const worker = state.workers.find((candidate) => candidate.id === workerId);
  if (!worker) {
    return { state, worker: null, ok: false, error: "worker_not_found" };
  }

  const task = state.tasks.find((candidate) => candidate.id === taskId);
  if (!task) {
    return { state, worker, ok: false, error: "task_not_found" };
  }

  const claimed = claimAssignedTaskForWorker(state, {
    workerId,
    at: nowIso(),
  });
  overwriteRuntimeState(state, claimed.state);
  if (!claimed.assignment) {
    return {
      state,
      worker: state.workers.find((candidate) => candidate.id === workerId) ?? null,
      ok: false,
      error: "no_assigned_task",
    };
  }

  if (claimed.assignment.task.id !== taskId) {
    return {
      state,
      worker: state.workers.find((candidate) => candidate.id === workerId) ?? null,
      ok: false,
      error: "assigned_task_mismatch",
    };
  }

  try {
    const resolvedAttemptLease = {
      attemptId: attemptLease.attemptId ?? claimed.assignment.attemptId,
      leaseToken: attemptLease.leaseToken ?? claimed.assignment.leaseToken,
      protocolVersion: attemptLease.protocolVersion ?? claimed.assignment.protocolVersion,
      traceId: attemptLease.traceId ?? claimed.assignment.traceId,
      idempotencyKey: attemptLease.idempotencyKey ?? claimed.assignment.idempotencyKey,
    };
    const nextState = beginTaskForWorker(state, {
      workerId,
      taskId,
      attemptId: resolvedAttemptLease.attemptId,
      leaseToken: resolvedAttemptLease.leaseToken,
      protocolVersion: resolvedAttemptLease.protocolVersion,
      traceId: resolvedAttemptLease.traceId,
      idempotencyKey: resolvedAttemptLease.idempotencyKey,
      at: nowIso(),
    });
    overwriteRuntimeState(state, nextState);
    return {
      state,
      worker: state.workers.find((candidate) => candidate.id === workerId) ?? null,
      ok: true,
    };
  } catch (error) {
    return {
      state,
      worker: state.workers.find((candidate) => candidate.id === workerId) ?? null,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export type TraeRouteInput = {
  method: "GET" | "POST";
  pathname: string;
  body?: Record<string, unknown>;
};

export function handleTraeRoute(
  state: RuntimeState,
  input: TraeRouteInput
): JsonResponse<unknown> {
  try {
    return handleTraeRouteImpl(state, input);
  } catch (error) {
    return {
      status: 500,
      headers: { "content-type": "application/json" },
      json: { error: error instanceof Error ? error.message : String(error) },
      text: JSON.stringify({ error: error instanceof Error ? error.message : String(error) }),
    };
  }
}

function handleTraeRouteImpl(
  state: RuntimeState,
  input: TraeRouteInput
): JsonResponse<unknown> {
  const { method, pathname, body = {} } = input;

  if (method === "POST" && pathname === "/api/trae/register") {
    const reqBody = body as unknown as TraeRegisterRequest;
    const { worker_id: workerId, pool = "trae", repo_dir: repoDir, labels = [], hostname = "" } = reqBody;
    if (!workerId || !repoDir) {
      return {
        status: 400,
        headers: { "content-type": "application/json" },
        json: { error: "worker_id and repo_dir required" },
        text: JSON.stringify({ error: "worker_id and repo_dir required" }),
      };
    }

    const nextState = reconcileRuntimeStateFn(registerWorkerFn(state, {
      workerId,
      pool,
      hostname,
      labels: labels as string[],
      repoDir,
      at: nowIso(),
    }));
    overwriteRuntimeState(state, nextState);

    return {
      status: 200,
      headers: { "content-type": "application/json" },
      json: {
        ok: true,
        worker: state.workers.find((worker) => worker.id === workerId) ?? null,
      },
      text: JSON.stringify({
        ok: true,
        worker: state.workers.find((worker) => worker.id === workerId) ?? null,
      }),
    };
  }

  if (method === "POST" && pathname === "/api/trae/fetch-task") {
    const reqBody = body as unknown as TraeFetchTaskRequest;
    const { worker_id: workerId, repo_dir: repoDirInput } = reqBody;
    if (!workerId) {
      return {
        status: 400,
        headers: { "content-type": "application/json" },
        json: { error: "worker_id required" },
        text: JSON.stringify({ error: "worker_id required" }),
      };
    }

    const result = findTraeTaskForWorker(state, workerId, repoDirInput);

    if (!result.task) {
      return {
        status: 200,
        headers: { "content-type": "application/json" },
        json: { status: "no_task" },
        text: JSON.stringify({ status: "no_task" }),
      };
    }
    const attempt = findActiveTaskAttempt(state, result.task.id);

    return {
      status: 200,
      headers: { "content-type": "application/json" },
      json: {
        status: "ok",
        task: {
          task_id: result.task.id,
          attempt_id: attempt?.attemptId,
          lease_token: attempt?.leaseToken,
          protocol_version: attempt?.protocolVersion,
          trace_id: attempt?.traceId,
          idempotency_key: attempt?.idempotencyKey,
          repo: result.task.repo,
          branch: result.task.branchName,
          default_branch: result.task.defaultBranch,
          goal: result.task.title,
          scope: result.task.allowedPaths,
          constraints: result.constraints,
          acceptance: result.task.acceptance,
          prompt: result.workerPrompt || result.contextMarkdown || result.task.title,
          worktree_dir: result.dirs.worktree_dir,
          assignment_dir: result.dirs.assignment_dir,
          chat_mode: result.chatMode,
          continuation_mode: result.continuationMode,
          continue_from_task_id: result.continueFromTaskId,
          worker_prompt_mode: result.workerPromptMode,
          report_schema_version: result.reportSchemaVersion,
        },
      },
      text: JSON.stringify({
        status: "ok",
        task: {
          task_id: result.task.id,
          attempt_id: attempt?.attemptId,
          lease_token: attempt?.leaseToken,
          protocol_version: attempt?.protocolVersion,
          trace_id: attempt?.traceId,
          idempotency_key: attempt?.idempotencyKey,
          repo: result.task.repo,
          branch: result.task.branchName,
          default_branch: result.task.defaultBranch,
          goal: result.task.title,
          scope: result.task.allowedPaths,
          constraints: result.constraints,
          acceptance: result.task.acceptance,
          prompt: result.workerPrompt || result.contextMarkdown || result.task.title,
          worktree_dir: result.dirs.worktree_dir,
          assignment_dir: result.dirs.assignment_dir,
          chat_mode: result.chatMode,
          continuation_mode: result.continuationMode,
          continue_from_task_id: result.continueFromTaskId,
          worker_prompt_mode: result.workerPromptMode,
          report_schema_version: result.reportSchemaVersion,
        },
      }),
    };
  }

  if (method === "POST" && pathname === "/api/trae/start-task") {
    const reqBody = body as unknown as TraeStartTaskRequest;
    const {
      worker_id: workerId,
      task_id: taskId,
      attempt_id: attemptId,
      lease_token: leaseToken,
      protocol_version: protocolVersion,
      trace_id: traceId,
      idempotency_key: idempotencyKey,
    } = reqBody;
    if (!workerId || !taskId) {
      return {
        status: 400,
        headers: { "content-type": "application/json" },
        json: { error: "worker_id and task_id required" },
        text: JSON.stringify({ error: "worker_id and task_id required" }),
      };
    }

    const result = applyTraeStartTask(state, workerId, taskId, {
      attemptId,
      leaseToken,
      protocolVersion,
      traceId,
      idempotencyKey,
    });
    if (!result.ok) {
      return {
        status: classifyTraeMutationError(result.error),
        headers: { "content-type": "application/json" },
        json: { ok: false, error: result.error },
        text: JSON.stringify({ ok: false, error: result.error }),
      };
    }

    return {
      status: 200,
      headers: { "content-type": "application/json" },
      json: {
        ok: true,
        status: "started",
        worker: result.worker,
      },
      text: JSON.stringify({
        ok: true,
        status: "started",
        worker: result.worker,
      }),
    };
  }

  if (method === "POST" && pathname === "/api/trae/report-progress") {
    const reqBody = body as unknown as TraeReportProgressRequest;
    const { task_id: taskId, message, worker_id: workerId } = reqBody;
    if (!taskId || !message) {
      return {
        status: 400,
        headers: { "content-type": "application/json" },
        json: { error: "task_id and message required" },
        text: JSON.stringify({ error: "task_id and message required" }),
      };
    }

    applyTraeReportProgress(state, taskId, message, workerId);

    return {
      status: 200,
      headers: { "content-type": "application/json" },
      json: { ok: true },
      text: JSON.stringify({ ok: true }),
    };
  }

  if (method === "POST" && pathname === "/api/trae/submit-result") {
    const {
      task_id: taskId,
      status,
      summary,
      test_output: testOutput,
      risks,
      files_changed: filesChanged,
      branch_name: branchName,
      commit_sha: commitSha,
      push_status: pushStatus,
      push_error: pushError,
      pr_number: prNumber,
      pr_url: prUrl,
      evidence,
      artifact_bundle: artifactBundle,
      attempt_id: attemptId,
      lease_token: leaseToken,
      protocol_version: protocolVersion,
      trace_id: traceId,
      idempotency_key: idempotencyKey,
    } = body as unknown as TraeSubmitResultRequest;

    if (!taskId || !status) {
      return {
        status: 400,
        headers: { "content-type": "application/json" },
        json: { error: "task_id and status required" },
        text: JSON.stringify({ error: "task_id and status required" }),
      };
    }

    if (status !== "review_ready" && status !== "failed") {
      return {
        status: 400,
        headers: { "content-type": "application/json" },
        json: { error: "status must be review_ready or failed" },
        text: JSON.stringify({ error: "status must be review_ready or failed" }),
      };
    }

    const result = applyTraeSubmitResult(state, {
      taskId,
      attemptId,
      leaseToken,
      protocolVersion,
      traceId,
      idempotencyKey,
      status,
      summary,
      testOutput,
      risks,
      filesChanged,
      branchName,
      commitSha,
      pushStatus,
      pushError,
      prNumber,
      prUrl,
      evidence,
      artifactBundle,
    });

    if (!result.ok) {
      return {
        status: classifyTraeMutationError(result.error),
        headers: { "content-type": "application/json" },
        json: { ok: false, error: result.error },
        text: JSON.stringify({ ok: false, error: result.error }),
      };
    }

    return {
      status: 200,
      headers: { "content-type": "application/json" },
      json: { ok: true },
      text: JSON.stringify({ ok: true }),
    };
  }

  if (method === "POST" && pathname === "/api/trae/heartbeat") {
    const reqBody = body as unknown as TraeHeartbeatRequest;
    const { worker_id: workerId } = reqBody;
    if (!workerId) {
      return {
        status: 400,
        headers: { "content-type": "application/json" },
        json: { error: "worker_id required" },
        text: JSON.stringify({ error: "worker_id required" }),
      };
    }

    const { state: nextState, worker } = applyTraeHeartbeat(state, workerId);

    return {
      status: 200,
      headers: { "content-type": "application/json" },
      json: {
        ok: true,
        worker,
      },
      text: JSON.stringify({
        ok: true,
        worker,
      }),
    };
  }

  return {
    status: 404,
    headers: { "content-type": "application/json" },
    json: { error: "not_found" },
    text: JSON.stringify({ error: "not_found" }),
  };
}
