export interface TaskAssignment {
  taskId: string;
  workerId?: string | null;
  branchName: string;
  defaultBranch: string;
  pool: string;
  repo: string;
  commands?: Record<string, string>;
  resumePayload?: Record<string, unknown> | null;
}

export interface TaskInfo {
  id: string;
  title: string;
  repo: string;
}

export interface TaskPayload {
  assignment: TaskAssignment;
  task: TaskInfo;
  workerPrompt?: string;
  contextMarkdown?: string;
  attemptId?: string;
  leaseToken?: string;
  protocolVersion?: string;
  traceId?: string;
  idempotencyKey?: string;
  resumePayload?: Record<string, unknown> | null;
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
      timedOut?: boolean;
    }>;
  };
  waitingForInput?: {
    requestId?: string;
    sourceSessionId?: string;
    requestedBy?: string;
    reason?: string;
    prompt?: string;
    expiresAt?: string;
    resumePayloadSchema?: Record<string, unknown>;
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
  artifactBundle?: Record<string, unknown>;
}

export interface PullRequestInfo {
  number: number;
  url: string;
  headBranch: string;
  baseBranch: string;
}

export interface WorkerProtocolEnvelope {
  attemptId?: string;
  leaseToken?: string;
  protocolVersion?: string;
  traceId?: string;
  idempotencyKey?: string;
}

export interface WorkerProgressPayload extends WorkerProtocolEnvelope {
  taskId: string;
  progressId: string;
  message: string;
  stage?: string;
}

export interface DispatcherRequestOptions {
  signal?: AbortSignal;
}

export interface DispatcherClient {
  registerWorker: (worker: { workerId: string; pool: string; hostname: string; labels: string[]; repoDir: string; at: string }, options?: DispatcherRequestOptions) => Promise<unknown>;
  heartbeat: (workerId: string, payload: { at: string }, options?: DispatcherRequestOptions) => Promise<unknown>;
  getAssignedTask: (workerId: string, options?: DispatcherRequestOptions) => Promise<TaskPayload | null>;
  claimTask: (workerId: string, payload?: { at?: string }, options?: DispatcherRequestOptions) => Promise<TaskPayload | null>;
  startTask: (workerId: string, payload: WorkerProtocolEnvelope & { taskId: string; at: string }, options?: DispatcherRequestOptions) => Promise<unknown>;
  reportProgress: (workerId: string, payload: WorkerProgressPayload, options?: DispatcherRequestOptions) => Promise<unknown>;
  submitResult: (workerId: string, payload: WorkerProtocolEnvelope & { result: WorkerResult; changedFiles: string[]; pullRequest: PullRequestInfo | null }, options?: DispatcherRequestOptions) => Promise<unknown>;
  reportEvent?: (workerId: string, payload: { type: string; taskId?: string; payload?: unknown; at?: string }, options?: DispatcherRequestOptions) => Promise<unknown>;
}

export interface ProcessTaskAssignmentInput {
  client: DispatcherClient;
  packageRoot: string;
  workerId: string;
  repoDir: string;
  payload: TaskPayload;
  dryRunExecution: boolean;
  at?: string;
  signal?: AbortSignal;
}
