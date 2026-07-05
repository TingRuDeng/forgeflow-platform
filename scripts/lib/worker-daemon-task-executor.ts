import path from "node:path";

import { importWorkerDaemonRuntime } from "./runtime-bootstrap.js";
import {
  buildFailedResultCallbacks,
  buildManagedTaskCallbacks,
  logCleanupError,
  reportWorkerEventBestEffort,
} from "./worker-daemon-hooks.js";
import {
  buildWorkerProtocolEnvelope,
  type DispatcherClient,
  type ProcessTaskAssignmentInput,
  type PullRequestInfo,
  type TaskPayload,
  type WorkerResult,
} from "./worker-daemon-types.js";

interface BetaRuntimeCoreBridge {
  executeManagedWorkerTask: (input: {
    client: DispatcherClient;
    packageRoot: string;
    workerId: string;
    repoDir: string;
    payload: TaskPayload;
    dryRunExecution: boolean;
    at?: string;
    createPullRequest?: boolean;
    removeWorktreeOnExit?: boolean;
    resetWorktreeOnReuse?: boolean;
    runtimeScriptPath?: string;
    runtimeScriptCwd?: string;
    reportEvent?: (event: { type: string; taskId?: string; payload?: unknown }) => Promise<void>;
    onCleanupError?: (error: unknown) => void;
    maxFailedResultRetries?: number;
    failedResultRetryDelayMs?: number;
    callbacks?: {
      onHeartbeatFailed?: (event: { taskId: string; error: string }) => void | Promise<void>;
      onCompleted?: (event: { taskId: string; workerId: string; durationMs: number }) => void | Promise<void>;
      onFailed?: (event: {
        taskId: string;
        workerId: string;
        error: string;
        durationMs: number;
        startedAt: string;
      }) => void | Promise<void>;
    };
    failedResultCallbacks?: ReturnType<typeof buildFailedResultCallbacks>;
  }) => Promise<{
    result: WorkerResult;
    changedFiles: string[];
    pullRequest: PullRequestInfo | null;
    worktreeDir: string;
    outputDir: string;
  }>;
  submitFailedWorkerResult: (request: {
    input: ProcessTaskAssignmentInput;
    taskId?: string;
    error: unknown;
    maxRetries?: number;
    retryDelayMs?: number;
    onSubmitted?: (event: { taskId: string }) => void | Promise<void>;
    onSubmitAttemptFailed?: (event: {
      taskId: string;
      attempt: number;
      maxRetries: number;
      error: string;
    }) => void | Promise<void>;
    onFallbackFailed?: (event: { taskId: string; error: string }) => void | Promise<void>;
  }) => Promise<void>;
}

const SUBMIT_RESULT_MAX_RETRIES = 3;
const SUBMIT_RESULT_RETRY_DELAY_MS = 2_000;

async function bootstrapBetaRuntimeCore(): Promise<BetaRuntimeCoreBridge> {
  return importWorkerDaemonRuntime<BetaRuntimeCoreBridge>();
}

function getSubmitResultMaxRetries(): number {
  return Number(process.env.WORKER_DAEMON_SUBMIT_RESULT_MAX_RETRIES || SUBMIT_RESULT_MAX_RETRIES);
}

function getSubmitResultRetryDelayMs(): number {
  return Number(process.env.WORKER_DAEMON_SUBMIT_RESULT_RETRY_DELAY_MS || SUBMIT_RESULT_RETRY_DELAY_MS);
}

export function buildClaimedTaskPayload(task: unknown, assignment: unknown, assigned: unknown): TaskPayload {
  return {
    task,
    assignment,
    ...buildWorkerProtocolEnvelope(assigned as Pick<TaskPayload, "attemptId" | "leaseToken" | "protocolVersion" | "traceId" | "idempotencyKey">),
  } as TaskPayload;
}

export async function executeClaimedTask(input: ProcessTaskAssignmentInput): Promise<{
  result: WorkerResult;
  changedFiles: string[];
  pullRequest: PullRequestInfo | null;
  worktreeDir: string;
  outputDir: string;
}> {
  const betaRuntime = await bootstrapBetaRuntimeCore();
  const taskId = input.payload.task.id;
  return betaRuntime.executeManagedWorkerTask({
    client: input.client,
    packageRoot: input.repoRoot,
    workerId: input.workerId,
    repoDir: input.repoDir,
    payload: input.payload,
    dryRunExecution: input.dryRunExecution,
    at: input.at,
    createPullRequest: process.env.FORGEFLOW_WORKER_CREATE_PR === "1",
    removeWorktreeOnExit: process.env.FORGEFLOW_WORKER_REMOVE_WORKTREE_ON_EXIT === "1",
    resetWorktreeOnReuse: true,
    runtimeScriptPath: path.join(input.repoRoot, "scripts/run-worker-assignment.js"),
    runtimeScriptCwd: input.repoRoot,
    reportEvent: (event) => reportWorkerEventBestEffort(input.client, input.workerId, event),
    onCleanupError: (cleanupError) => logCleanupError(taskId, cleanupError),
    maxFailedResultRetries: getSubmitResultMaxRetries(),
    failedResultRetryDelayMs: getSubmitResultRetryDelayMs(),
    callbacks: buildManagedTaskCallbacks(input),
    failedResultCallbacks: buildFailedResultCallbacks(input, taskId),
  });
}

export async function submitFailedClaimedTaskResult(input: ProcessTaskAssignmentInput, errorMessage: string): Promise<void> {
  const taskId = input.payload.task.id;
  const betaRuntime = await bootstrapBetaRuntimeCore();
  await betaRuntime.submitFailedWorkerResult({
    input,
    taskId,
    error: errorMessage,
    maxRetries: getSubmitResultMaxRetries(),
    retryDelayMs: getSubmitResultRetryDelayMs(),
    ...buildFailedResultCallbacks(input, taskId),
  });
}
