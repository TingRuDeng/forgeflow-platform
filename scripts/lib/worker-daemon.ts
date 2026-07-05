import path from "node:path";

import { handleDispatcherHttpRequest } from "./dispatcher-server.js";
import {
  importDispatcherRuntimeBridge,
  importWorkerDaemonRuntime,
} from "./runtime-bootstrap.js";
import {
  buildFailedResultCallbacks,
  buildManagedTaskCallbacks,
  logCleanupError,
  reportWorkerEventBestEffort,
} from "./worker-daemon-hooks.js";

interface DispatcherClientBridge {
  createDispatcherHttpClient: (options: { dispatcherUrl: string }) => DispatcherClient;
  createDispatcherStateDirClientFactory: (options: {
    handleRequest: (input: {
      stateDir: string;
      method: string;
      pathname: string;
      body?: unknown;
      internalCall?: boolean;
    }) => Promise<{ status: number; json: unknown }>;
  }) => (stateDir: string) => DispatcherClient;
  runWorkerDaemonCycle: (input: {
    client: DispatcherClient;
    workerId: string;
    pool: string;
    hostname?: string;
    labels?: string[];
    repoDir: string;
    dryRunExecution?: boolean;
    at?: string;
    taskExecutor: {
      executeTask: (task: unknown, assignment: unknown, assigned: unknown) => Promise<{
        result: WorkerResult;
        changedFiles: string[];
        pullRequest: PullRequestInfo | null;
        worktreeDir?: string;
        outputDir?: string;
      }>;
    };
  }) => Promise<RunWorkerDaemonCycleSummary>;
}

async function bootstrapDispatcherBridge(): Promise<DispatcherClientBridge> {
  return importDispatcherRuntimeBridge<DispatcherClientBridge>();
}

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
  executeLiveWorkerTask: (input: {
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

async function bootstrapBetaRuntimeCore(): Promise<BetaRuntimeCoreBridge> {
  return importWorkerDaemonRuntime<BetaRuntimeCoreBridge>();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface TaskAssignment {
  taskId: string;
  branchName: string;
  defaultBranch: string;
  pool: string;
  repo: string;
  commands?: Record<string, string>;
}

interface TaskInfo {
  id: string;
  title: string;
  repo: string;
}

interface TaskPayload {
  assignment: TaskAssignment;
  task: TaskInfo;
  attemptId?: string;
  leaseToken?: string;
  protocolVersion?: string;
  traceId?: string;
  idempotencyKey?: string;
  workerPrompt?: string;
  contextMarkdown?: string;
}

interface WorkerResult {
  taskId: string;
  workerId: string;
  provider: string;
  pool: string;
  branchName: string;
  repo: string;
  defaultBranch: string;
  mode: string;
  output: string;
  generatedAt: string;
  verification: {
    allPassed: boolean;
    commands: Array<{
      command: string;
      exitCode: number;
      output: string;
    }>;
  };
  evidence?: {
    failureType?: "preflight" | "execution" | "verification" | "unknown";
    failureSummary?: string;
    blockers?: Array<{
      kind: "preflight" | "execution" | "verification" | "unknown";
      code: string;
      message: string;
      details?: Record<string, unknown>;
    }>;
    findings?: unknown[];
    artifacts?: Record<string, string>;
  };
}

interface PullRequestInfo {
  number: number;
  url: string;
  headBranch: string;
  baseBranch: string;
}

const SUBMIT_RESULT_MAX_RETRIES = 3;
const SUBMIT_RESULT_RETRY_DELAY_MS = 2_000;

function getSubmitResultMaxRetries(): number {
  return Number(process.env.WORKER_DAEMON_SUBMIT_RESULT_MAX_RETRIES || SUBMIT_RESULT_MAX_RETRIES);
}

function getSubmitResultRetryDelayMs(): number {
  return Number(process.env.WORKER_DAEMON_SUBMIT_RESULT_RETRY_DELAY_MS || SUBMIT_RESULT_RETRY_DELAY_MS);
}

interface ProcessTaskAssignmentInput {
  client: DispatcherClient;
  repoRoot: string;
  workerId: string;
  repoDir: string;
  payload: TaskPayload;
  dryRunExecution: boolean;
  at?: string;
}

function buildWorkerProtocolEnvelope(payload: Pick<TaskPayload, "attemptId" | "leaseToken" | "protocolVersion" | "traceId" | "idempotencyKey">) {
  return {
    attemptId: payload.attemptId,
    leaseToken: payload.leaseToken,
    protocolVersion: payload.protocolVersion,
    traceId: payload.traceId,
    idempotencyKey: payload.idempotencyKey,
  };
}

type ExecuteClaimedTaskInput = ProcessTaskAssignmentInput;

async function executeClaimedTask(input: ExecuteClaimedTaskInput): Promise<{
  result: WorkerResult;
  changedFiles: string[];
  pullRequest: PullRequestInfo | null;
  worktreeDir: string;
  outputDir: string;
}> {
  const betaRuntime = await bootstrapBetaRuntimeCore();
  const taskId = input.payload.task.id;
  const workerId = input.workerId;
  return betaRuntime.executeManagedWorkerTask({
    client: input.client,
    packageRoot: input.repoRoot,
    workerId,
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

async function submitFailedClaimedTaskResult(input: ProcessTaskAssignmentInput, errorMessage: string): Promise<void> {
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

export interface DispatcherClient {
  registerWorker: (worker: { workerId: string; pool: string; hostname: string; labels: string[]; repoDir: string; at: string }) => Promise<unknown>;
  heartbeat: (workerId: string, payload: { at: string }) => Promise<unknown>;
  getAssignedTask: (workerId: string) => Promise<TaskPayload | null>;
  claimTask: (workerId: string, payload?: { at?: string }) => Promise<TaskPayload | null>;
  startTask: (workerId: string, payload: ReturnType<typeof buildWorkerProtocolEnvelope> & { taskId: string; at: string }) => Promise<unknown>;
  submitResult: (workerId: string, payload: ReturnType<typeof buildWorkerProtocolEnvelope> & { result: WorkerResult; changedFiles: string[]; pullRequest: PullRequestInfo | null }) => Promise<unknown>;
  reportEvent?: (workerId: string, payload: { type: string; taskId?: string; payload?: unknown; at?: string }) => Promise<unknown>;
}

export function createDispatcherClient(dispatcherUrl: string): DispatcherClient {
  let clientPromise: Promise<DispatcherClient> | null = null;
  return createLazyDispatcherClient(() => {
    clientPromise ??= bootstrapDispatcherBridge()
      .then((bridge) => bridge.createDispatcherHttpClient({ dispatcherUrl }));
    return clientPromise;
  });
}

export function createStateDirDispatcherClient(stateDir: string): DispatcherClient {
  let clientPromise: Promise<DispatcherClient> | null = null;
  return createLazyDispatcherClient(() => {
    clientPromise ??= bootstrapDispatcherBridge().then((bridge) => {
      const createClient = bridge.createDispatcherStateDirClientFactory({
        handleRequest: (input) => handleDispatcherHttpRequest({
          stateDir: input.stateDir,
          method: input.method,
          pathname: input.pathname,
          body: input.body,
          clientAddress: "127.0.0.1",
          internalCall: input.internalCall ?? true,
        }),
      });
      return createClient(stateDir);
    });
    return clientPromise;
  });
}

function createLazyDispatcherClient(resolveClient: () => Promise<DispatcherClient>): DispatcherClient {
  return {
    async registerWorker(worker) {
      return (await resolveClient()).registerWorker(worker);
    },
    async heartbeat(workerId, payload) {
      return (await resolveClient()).heartbeat(workerId, payload);
    },
    async getAssignedTask(workerId) {
      return (await resolveClient()).getAssignedTask(workerId);
    },
    async claimTask(workerId, payload = {}) {
      return (await resolveClient()).claimTask(workerId, payload);
    },
    async startTask(workerId, payload) {
      return (await resolveClient()).startTask(workerId, payload);
    },
    async submitResult(workerId, payload) {
      return (await resolveClient()).submitResult(workerId, payload);
    },
    async reportEvent(workerId, payload) {
      return (await resolveClient()).reportEvent?.(workerId, payload);
    },
  };
}

export interface RunWorkerDaemonCycleInput {
  client?: DispatcherClient;
  dispatcherUrl?: string;
  workerId: string;
  pool: string;
  hostname?: string;
  labels?: string[];
  repoDir: string;
  repoRoot?: string;
  dryRunExecution?: boolean;
  at?: string;
}

export type RunWorkerDaemonCycleSummary =
  | { status: string; workerId: string }
  | {
    status: string;
    taskId: string;
    workerId: string;
    worktreeDir?: string;
    outputDir?: string;
    changedFiles: string[];
    pullRequest: PullRequestInfo | null;
  };

function buildClaimedTaskPayload(task: unknown, assignment: unknown, assigned: unknown): TaskPayload {
  return {
    task,
    assignment,
    ...buildWorkerProtocolEnvelope(assigned as Pick<TaskPayload, "attemptId" | "leaseToken" | "protocolVersion" | "traceId" | "idempotencyKey">),
  } as TaskPayload;
}

export async function runWorkerDaemonCycle(input: RunWorkerDaemonCycleInput): Promise<RunWorkerDaemonCycleSummary> {
  const client = input.client ?? createDispatcherClient(input.dispatcherUrl || "");
  const bridge = await bootstrapDispatcherBridge();
  let claimedPayload: TaskPayload | null = null;
  try {
    return await bridge.runWorkerDaemonCycle({
      client,
      workerId: input.workerId,
      pool: input.pool,
      hostname: input.hostname,
      labels: input.labels,
      repoDir: input.repoDir,
      dryRunExecution: input.dryRunExecution,
      at: input.at,
      taskExecutor: {
        executeTask: (task, assignment, assigned) => {
          claimedPayload = buildClaimedTaskPayload(task, assignment, assigned);
          return executeClaimedTask({
            client,
            repoRoot: input.repoRoot ?? path.resolve(path.dirname(new URL(import.meta.url).pathname), "../.."),
            workerId: input.workerId,
            repoDir: input.repoDir,
            payload: claimedPayload,
            dryRunExecution: Boolean(input.dryRunExecution),
            at: input.at,
          });
        },
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (claimedPayload && message.startsWith("submitResult failed after")) {
      await submitFailedClaimedTaskResult({
        client,
        repoRoot: input.repoRoot ?? path.resolve(path.dirname(new URL(import.meta.url).pathname), "../.."),
        workerId: input.workerId,
        repoDir: input.repoDir,
        payload: claimedPayload,
        dryRunExecution: Boolean(input.dryRunExecution),
        at: input.at,
      }, message);
    }
    throw error;
  }
}

export interface RunWorkerDaemonInput extends RunWorkerDaemonCycleInput {
  once?: boolean;
  pollIntervalMs?: number;
}

export async function runWorkerDaemon(input: RunWorkerDaemonInput): Promise<ReturnType<typeof runWorkerDaemonCycle>> {
  while (true) {
    const summary = await runWorkerDaemonCycle(input);
    if (input.once) {
      return summary;
    }
    await sleep(input.pollIntervalMs ?? 5000);
  }
}
