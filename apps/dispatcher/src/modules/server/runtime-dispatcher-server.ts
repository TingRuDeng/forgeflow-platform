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
  registerWorker as registerWorkerFn,
  reconcileRuntimeState as reconcileRuntimeStateFn,
  upsertReview,
} from "./runtime-state.js";

import type {
  JsonResponse,
  TraeFetchTaskRequest,
  TraeSubmitResultRequest,
  TraeHeartbeatRequest,
  TraeReportProgressRequest,
  TraeRegisterRequest,
  TraeStartTaskRequest,
  WorkerEvidence,
} from "./runtime-glue-types.js";
import { formatLocalTimestamp } from "../time.js";

function nowIso(): string {
  return formatLocalTimestamp();
}

const RUNTIME_EVENTS_RETENTION_LIMIT = 500;

function appendRuntimeEvent(state: RuntimeState, event: Event): void {
  state.events.push(event);
  if (state.events.length > RUNTIME_EVENTS_RETENTION_LIMIT) {
    state.events.splice(0, state.events.length - RUNTIME_EVENTS_RETENTION_LIMIT);
  }
}

function overwriteRuntimeState(target: RuntimeState, source: RuntimeState): void {
  target.version = source.version;
  target.updatedAt = source.updatedAt;
  target.sequence = source.sequence;
  target.workers = source.workers;
  target.tasks = source.tasks;
  target.events = source.events;
  target.assignments = source.assignments;
  target.reviews = source.reviews;
  target.pullRequests = source.pullRequests;
  target.dispatches = source.dispatches;
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
  let worker = state.workers.find((w) => w.id === workerId);
  if (!worker) {
    const newWorker: Worker = {
      id: workerId,
      pool: "trae",
      hostname: "",
      labels: [],
      repoDir: repoDirInput ?? "",
      status: "idle",
      lastHeartbeatAt: nowIso(),
    };
    state.workers.push(newWorker);
    worker = newWorker;
  } else if (repoDirInput) {
    worker.repoDir = repoDirInput;
  }

  const repoDir = worker.repoDir || repoDirInput || "";

  let task = state.tasks.find(
    (t) =>
      (t.status === "assigned" || t.status === "in_progress") &&
      t.assignedWorkerId === workerId
  );

  if (!task) {
    const readyTask = state.tasks.find(
      (t) =>
        (t.status === "ready" || (t.status as string) === "pending") &&
        t.pool === "trae" &&
        (!t.targetWorkerId || t.targetWorkerId === workerId)
    );
    if (readyTask) {
      readyTask.status = "assigned";
      readyTask.assignedWorkerId = workerId;
      task = readyTask;

      const assignment = state.assignments.find((a) => a.taskId === task!.id);
      if (assignment) {
        assignment.status = "assigned";
        assignment.workerId = workerId;
        assignment.assignedAt = nowIso();
      }

      appendRuntimeEvent(state, {
        taskId: task.id,
        type: "assigned",
        at: nowIso(),
        payload: { workerId, pool: "trae" },
      });
    }
  }

  if (!task) {
    worker.status = "idle";
    worker.currentTaskId = undefined;
    worker.lastHeartbeatAt = nowIso();
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

  const assignment = state.assignments.find((a) => a.taskId === task!.id) ?? null;
  const workerPrompt = assignment?.workerPrompt ?? "";
  const contextMarkdown = assignment?.contextMarkdown ?? "";

  const constraints = buildTraeConstraints(task);

  const dirs = assignment
    ? buildTraeWorktreeAndAssignmentDirs(worker.repoDir || "", repoDir, task)
    : { worktree_dir: "", assignment_dir: "" };

  const chatMode = (assignment as Assignment & { chatMode?: string })?.chatMode
    ?? (task as Task & { chatMode?: string })?.chatMode
    ?? "new_chat";

  const continuationMode = (assignment as Assignment & { continuationMode?: string })?.continuationMode
    ?? (task as Task & { continuationMode?: string })?.continuationMode;

  const continueFromTaskId = (assignment as Assignment & { continueFromTaskId?: string | null })?.continueFromTaskId
    ?? (task as Task & { continueFromTaskId?: string | null })?.continueFromTaskId
    ?? null;

  return { task, assignment, workerPrompt, contextMarkdown, constraints, dirs, chatMode, continuationMode, continueFromTaskId };
}

export function applyTraeSubmitResult(
  state: RuntimeState,
  input: {
    taskId: string;
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
  }
): { state: RuntimeState; ok: boolean; error?: string } {
  const task = state.tasks.find((t) => t.id === input.taskId);
  if (!task) {
    return { state, ok: false, error: "task_not_found" };
  }

  const assignment = state.assignments.find((item) => item.taskId === input.taskId);
  const worker = state.workers.find((w) => w.currentTaskId === input.taskId);
  const review = state.reviews.find((item) => item.taskId === input.taskId) ?? null;
  const newStatus = input.status === "review_ready" ? "review" : "failed";
  const now = nowIso();

  task.status = newStatus;
  if (assignment) {
    assignment.status = newStatus;
    if (assignment.assignment) {
      assignment.assignment.status = newStatus;
    }
  }
  if (worker) {
    worker.status = "idle";
    worker.currentTaskId = undefined;
    worker.lastHeartbeatAt = now;
  }

  const github =
    input.branchName || input.commitSha || input.pushStatus || input.prNumber || input.prUrl
      ? {
          branch_name: input.branchName || null,
          commit_sha: input.commitSha || null,
          push_status: input.pushStatus || null,
          push_error: input.pushError || null,
          pr_number: input.prNumber || null,
          pr_url: input.prUrl || null,
        }
      : null;

  const reviewMaterial = input.status === "review_ready"
    ? {
        repo: task.repo,
        title: task.title,
        changedFiles: input.filesChanged || [],
        selfTestPassed: true,
        checks: [],
        pullRequest: input.prNumber && input.prUrl && input.branchName
          ? {
              number: input.prNumber,
              url: input.prUrl,
              headBranch: input.branchName,
              baseBranch: task.defaultBranch,
            }
          : null,
      }
    : review?.reviewMaterial ?? null;

  const eventPayload: Record<string, unknown> = {
    from: "in_progress",
    to: newStatus,
    summary: input.summary,
    test_output: input.testOutput,
    risks: input.risks || [],
    files_changed: input.filesChanged || [],
    github,
  };

  if (input.status === "failed" && input.evidence) {
    eventPayload.failureType = input.evidence.failureType ?? null;
    eventPayload.failureSummary = input.evidence.failureSummary ?? input.summary ?? null;
  }

  appendRuntimeEvent(state, {
    taskId: input.taskId,
    type: "status_changed",
    at: now,
    payload: eventPayload,
  });

  state.reviews = upsertReview(state.reviews, {
    taskId: input.taskId,
    decision: review?.decision ?? "pending",
    actor: review?.actor ?? null,
    notes: review?.notes ?? "",
    decidedAt: review?.decidedAt ?? null,
    reviewMaterial,
    latestWorkerResult: {
      taskId: input.taskId,
      workerId: worker?.id ?? review?.latestWorkerResult?.workerId ?? "trae",
      provider: "trae",
      pool: "trae",
      branchName: input.branchName ?? review?.latestWorkerResult?.branchName ?? "",
      repo: task.repo,
      defaultBranch: task.defaultBranch,
      mode: "run",
      output: input.summary ?? "",
      generatedAt: now,
      verification: {
        allPassed: input.status === "review_ready",
        commands: [],
      },
      evidence: input.evidence,
    },
    evidence: review?.evidence ?? null,
  });

  return { state, ok: true };
}

export function applyTraeHeartbeat(
  state: RuntimeState,
  workerId: string
): { state: RuntimeState; worker: Worker | null } {
  let worker = state.workers.find((w) => w.id === workerId);
  if (!worker) {
    const newWorker: Worker = {
      id: workerId,
      pool: "trae",
      hostname: "",
      labels: [],
      repoDir: "",
      status: "idle",
      lastHeartbeatAt: nowIso(),
    };
    state.workers.push(newWorker);
    worker = newWorker;
  }
  const hasActiveTask = Boolean(worker.currentTaskId);
  const previousStatus = worker.status;
  worker.lastHeartbeatAt = nowIso();
  worker.status = hasActiveTask ? "busy" : (previousStatus === "offline" ? "idle" : previousStatus);
  return { state, worker };
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
  taskId: string
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
    const nextState = beginTaskForWorker(state, {
      workerId,
      taskId,
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

    return {
      status: 200,
      headers: { "content-type": "application/json" },
      json: {
        ok: true,
        worker: nextState.workers.find((worker) => worker.id === workerId) ?? null,
      },
      text: JSON.stringify({
        ok: true,
        worker: nextState.workers.find((worker) => worker.id === workerId) ?? null,
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

    return {
      status: 200,
      headers: { "content-type": "application/json" },
      json: {
        status: "ok",
        task: {
          task_id: result.task.id,
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
        },
      },
      text: JSON.stringify({
        status: "ok",
        task: {
          task_id: result.task.id,
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
        },
      }),
    };
  }

  if (method === "POST" && pathname === "/api/trae/start-task") {
    const reqBody = body as unknown as TraeStartTaskRequest;
    const { worker_id: workerId, task_id: taskId } = reqBody;
    if (!workerId || !taskId) {
      return {
        status: 400,
        headers: { "content-type": "application/json" },
        json: { error: "worker_id and task_id required" },
        text: JSON.stringify({ error: "worker_id and task_id required" }),
      };
    }

    const result = applyTraeStartTask(state, workerId, taskId);
    if (!result.ok) {
      const status = result.error === "worker_not_found" || result.error === "task_not_found" ? 404 : 409;
      return {
        status,
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
    });

    if (!result.ok) {
      return {
        status: 404,
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
