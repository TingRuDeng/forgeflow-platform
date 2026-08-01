export type ReviewDecisionKind = "merge" | "block" | "rework" | "changes_requested";

import type {
  ArtifactBundle,
  ReviewDecisionEvidence,
  ReviewFreshness,
  WorkerEvidence,
} from "@forgeflow/result-contracts";

export { ArtifactBundle, ReviewDecisionEvidence, ReviewFreshness, WorkerEvidence };

export interface ReviewDecisionPayload {
  actor?: string;
  decision: ReviewDecisionKind;
  notes?: string;
  at?: string;
  evidence?: ReviewDecisionEvidence;
  expectedFreshness: ReviewFreshness;
}

export interface ReviewSubmitResult {
  status: string;
  tasks: unknown[];
}

export interface HeartbeatPayload {
  at: string;
}

export interface StartTaskPayload {
  taskId: string;
  at?: string;
  attemptId?: string;
  leaseToken?: string;
  protocolVersion?: string;
  traceId?: string;
  idempotencyKey?: string;
}

export interface ProgressTaskPayload {
  taskId: string;
  attemptId?: string;
  leaseToken?: string;
  protocolVersion?: string;
  traceId?: string;
  idempotencyKey?: string;
  progressId: string;
  message: string;
  stage?: string;
}

export interface SubmitResultPayload {
  attemptId?: string;
  leaseToken?: string;
  protocolVersion?: string;
  traceId?: string;
  idempotencyKey?: string;
  result: unknown;
  changedFiles: string[];
  pullRequest: PullRequestInfo | null;
}

export interface PullRequestInfo {
  number: number;
  url: string;
  headBranch: string;
  baseBranch: string;
}

export interface WorkerRegistration {
  workerId: string;
  pool: string;
  hostname?: string;
  labels?: string[];
  repoDir?: string;
  at?: string;
}

export interface DispatcherRequestOptions {
  signal?: AbortSignal;
}

export interface DispatcherWorkerClient {
  registerWorker(worker: WorkerRegistration, options?: DispatcherRequestOptions): Promise<unknown>;
  heartbeat(workerId: string, payload: HeartbeatPayload, options?: DispatcherRequestOptions): Promise<unknown>;
  getAssignedTask(workerId: string, options?: DispatcherRequestOptions): Promise<AssignedTaskResponse>;
  claimTask(workerId: string, payload?: { at?: string }, options?: DispatcherRequestOptions): Promise<AssignedTaskResponse>;
  startTask(workerId: string, payload: StartTaskPayload, options?: DispatcherRequestOptions): Promise<unknown>;
  reportProgress(workerId: string, payload: ProgressTaskPayload, options?: DispatcherRequestOptions): Promise<unknown>;
  submitResult(workerId: string, payload: SubmitResultPayload, options?: DispatcherRequestOptions): Promise<unknown>;
  reportEvent?: (workerId: string, payload: { type: string; taskId?: string; payload?: unknown; at?: string }, options?: DispatcherRequestOptions) => Promise<unknown>;
}

export interface AssignedTaskResponse {
  assignment: unknown;
  task: unknown;
  attemptId?: string;
  leaseToken?: string;
  protocolVersion?: string;
  traceId?: string;
  idempotencyKey?: string;
}

export interface WorkerDaemonCycleInput {
  client?: DispatcherWorkerClient;
  dispatcherUrl?: string;
  workerId: string;
  pool: string;
  hostname?: string;
  labels?: string[];
  repoDir: string;
  repoRoot?: string;
  dryRunExecution?: boolean;
  at?: string;
  signal?: AbortSignal;
}

export interface WorkerDaemonCycleResult {
  status: "idle" | "completed" | "stopped";
  workerId: string;
  taskId?: string;
  worktreeDir?: string;
  outputDir?: string;
  changedFiles?: string[];
  pullRequest?: PullRequestInfo | null;
}

export interface HttpRequestOptions {
  method?: string;
  pathname?: string;
  body?: unknown;
  timeoutMs?: number;
  maxRetries?: number;
  retryDelayMs?: number;
}

export interface JsonResponse<T = unknown> {
  status: number;
  headers: Record<string, string>;
  json: T;
  text: string;
}

export interface TraeWorkerInfo {
  id: string;
  pool: string;
  hostname: string;
  labels: string[];
  repoDir: string;
  status: WorkerStatus;
  currentTaskId: string | null;
  registeredAt: string;
  lastHeartbeatAt: string;
}

export type WorkerStatus = "idle" | "busy" | "offline";

export interface TraeTaskInfo {
  task_id: string;
  attempt_id?: string;
  lease_token?: string;
  protocol_version?: string;
  trace_id?: string;
  idempotency_key?: string;
  repo: string;
  branch: string;
  default_branch: string;
  goal: string;
  scope: string[] | null;
  constraints: string[];
  acceptance: string[] | null;
  prompt: string;
  worktree_dir: string;
  assignment_dir: string;
  chat_mode: string;
}

export interface TraeFetchTaskRequest {
  worker_id: string;
  repo_dir?: string;
}

export interface TraeFetchTaskResponse {
  status: "ok" | "no_task";
  task?: TraeTaskInfo;
}

export interface TraeSubmitResultRequest {
  task_id: string;
  attempt_id?: string;
  lease_token?: string;
  protocol_version?: string;
  trace_id?: string;
  idempotency_key?: string;
  status: "review_ready" | "failed";
  summary?: string;
  test_output?: string;
  risks?: string[];
  files_changed?: string[];
  branch_name?: string;
  commit_sha?: string;
  push_status?: string;
  push_error?: string;
  pr_number?: number;
  pr_url?: string;
  evidence?: WorkerEvidence;
  artifact_bundle?: ArtifactBundle;
}

export interface TraeHeartbeatRequest {
  worker_id: string;
}

export interface TraeReportProgressRequest {
  task_id: string;
  attempt_id?: string;
  lease_token?: string;
  protocol_version?: string;
  trace_id?: string;
  idempotency_key?: string;
  progress_id: string;
  message: string;
  stage?: string;
  worker_id: string;
}

export interface TraeRegisterRequest {
  worker_id: string;
  pool?: string;
  repo_dir: string;
  labels?: string[];
  hostname?: string;
}

export interface TraeStartTaskRequest {
  worker_id: string;
  task_id: string;
  attempt_id?: string;
  lease_token?: string;
  protocol_version?: string;
  trace_id?: string;
  idempotency_key?: string;
}
