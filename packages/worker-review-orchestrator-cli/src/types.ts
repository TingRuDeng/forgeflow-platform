export type ReviewDecisionKind = "merge" | "block" | "rework";

export interface DispatchInput {
  repo: string;
  defaultBranch: string;
  requestedBy?: string;
  tasks: Array<Record<string, unknown>>;
  packages: Array<Record<string, unknown>>;
}

export interface DispatchResult {
  dispatchId: string;
  taskIds: string[];
  assignments: Array<Record<string, unknown>>;
}

export interface DispatchTaskInputOptions {
  repo: string;
  defaultBranch: string;
  taskId: string;
  title: string;
  pool: string;
  branchName: string;
  requestedBy?: string;
  allowedPaths?: string;
  acceptance?: string;
  dependsOn?: string;
  targetWorkerId?: string;
  verificationMode?: string;
  workerPrompt?: string;
  contextMarkdown?: string;
  workerPromptFile?: string;
  contextMarkdownFile?: string;
  continuationMode?: string;
  continueFromTaskId?: string;
}

export interface WatchOptions {
  dispatcherUrl: string;
  taskId: string;
  intervalMs?: number;
  timeoutMs?: number;
  summary?: boolean;
}

export interface WatchResult {
  taskId: string;
  status: string;
  attempts: number;
  elapsedMs: number;
  task: Record<string, unknown> | null;
  snapshot: Record<string, unknown>;
}

export interface WatchSummaryResult {
  taskId: string;
  status: string;
  attempts: number;
  elapsedMs: number;
}

export interface DecideOptions {
  taskId: string;
  decision: ReviewDecisionKind;
  actor?: string;
  notes?: string;
  at?: string;
  dispatcherUrl?: string;
  stateDir?: string;
}

export interface DecideResult {
  taskId: string;
  decision: "merge" | "block";
  status: "merged" | "blocked";
  source: "dispatcher" | "state-dir";
  payload: Record<string, unknown>;
}

export interface JsonHttpClientOptions {
  fetchImpl?: typeof globalThis.fetch;
  requestTimeoutMs?: number;
}

export interface JsonHttpRequestOptions {
  method?: string;
  body?: unknown;
  timeoutMs?: number;
}

export interface LocalRuntimeState {
  version: number;
  updatedAt: string;
  sequence: number;
  workers: Array<Record<string, unknown>>;
  tasks: Array<Record<string, unknown>>;
  events: Array<Record<string, unknown>>;
  assignments: Array<Record<string, unknown>>;
  reviews: Array<Record<string, unknown>>;
  pullRequests: Array<Record<string, unknown>>;
  dispatches: Array<Record<string, unknown>>;
}

export interface InspectOptions {
  dispatcherUrl?: string;
  taskId: string;
  summary?: boolean;
  stateDir?: string;
}

export interface InspectResult {
  taskId: string;
  task: Record<string, unknown> | null;
  assignment: Record<string, unknown> | null;
  reviews: Array<Record<string, unknown>>;
  pullRequest: Record<string, unknown> | null;
  events: Array<Record<string, unknown>>;
  snapshot: Record<string, unknown>;
}

export interface InspectSummaryResult {
  taskId: string;
  status: string | null;
  branch: string | null;
  repo: string | null;
  workerId: string | null;
  latestResultEvidence: {
    commit: string | null;
    pushStatus: string | null;
    testOutput: string | null;
  };
  recentEvents: Array<{
    type: string;
    at: string | null;
    summary: string | null;
  }>;
  reviewState: {
    decision: string | null;
    actor: string | null;
    at: string | null;
  } | null;
  pullRequestState: {
    url: string | null;
    status: string | null;
    number: number | null;
  } | null;
}

export type RedriveFailureType = "worktree_mismatch" | "branch_mismatch" | "preflight_workspace_mismatch";

export interface RedriveOptions {
  dispatcherUrl: string;
  taskId: string;
  fetchImpl?: typeof globalThis.fetch;
}

export interface RedriveResult {
  originalTaskId: string;
  newTaskId: string;
  targetWorkerId: string | null;
  failureSummary: string;
  continuationMode: string;
  continueFromTaskId: string | null;
}
