export interface TaskAssignment {
  taskId: string;
  branchName: string;
  defaultBranch: string;
  pool: string;
  repo: string;
  commands?: Record<string, string>;
}

export interface TaskInfo {
  id: string;
  title: string;
  repo: string;
}

export interface TaskPayload {
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

export interface WorkerResult {
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

export interface PullRequestInfo {
  number: number;
  url: string;
  headBranch: string;
  baseBranch: string;
}

export function buildWorkerProtocolEnvelope(
  payload: Pick<TaskPayload, "attemptId" | "leaseToken" | "protocolVersion" | "traceId" | "idempotencyKey">,
) {
  return {
    attemptId: payload.attemptId,
    leaseToken: payload.leaseToken,
    protocolVersion: payload.protocolVersion,
    traceId: payload.traceId,
    idempotencyKey: payload.idempotencyKey,
  };
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

export interface ProcessTaskAssignmentInput {
  client: DispatcherClient;
  repoRoot: string;
  workerId: string;
  repoDir: string;
  payload: TaskPayload;
  dryRunExecution: boolean;
  at?: string;
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

export interface RunWorkerDaemonInput extends RunWorkerDaemonCycleInput {
  once?: boolean;
  pollIntervalMs?: number;
}
