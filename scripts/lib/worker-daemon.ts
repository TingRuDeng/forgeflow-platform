import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync, execSync, ChildProcess } from "node:child_process";

import { handleDispatcherHttpRequest } from "./dispatcher-server.js";
import { prepareTaskWorktree, removeTaskWorktree, safeTaskDirName } from "./task-worktree.js";
import { formatLocalTimestamp } from "./time.js";
import {
  logger,
  createChildLogger,
  logWorkerHeartbeat,
  logTaskCompleted,
  logTaskFailed,
} from "./logger.js";
import { recordTaskMetric } from "./metrics.js";
import { getDispatcherAuthHeader } from "./dispatcher-auth.js";
import {
  buildWorkerEnv,
  assertSafeBranchName,
  shouldCreatePullRequest,
  shouldRemoveWorktreeOnExit,
} from "./worker-daemon-helpers.js";

function resolveDispatcherDist(): { repoRoot: string; distPath: string } {
  const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
  const distPath = path.join(repoRoot, "apps/dispatcher/dist/modules/server/runtime-glue-dispatcher-client.js");
  return { repoRoot, distPath };
}

function ensureDispatcherDist(): void {
  const { repoRoot, distPath } = resolveDispatcherDist();
  if (fs.existsSync(distPath)) {
    return;
  }
  execSync("pnpm --dir apps/dispatcher run build", {
    cwd: repoRoot,
    stdio: "inherit",
  });
}

interface DispatcherClientBridge {
  createHttpDispatcherClient: (url: string) => DispatcherClient;
  createStateDirDispatcherClient: (handler: typeof handleDispatcherHttpRequest, stateDir: string) => DispatcherClient;
}

async function bootstrapDispatcherBridge(): Promise<DispatcherClientBridge> {
  const { repoRoot, distPath } = resolveDispatcherDist();
  if (!fs.existsSync(distPath)) {
    ensureDispatcherDist();
  }
  const distDir = path.join(repoRoot, "apps/dispatcher/dist");
  return import(path.join(distDir, "modules/server/runtime-glue-dispatcher-client.js")) as Promise<DispatcherClientBridge>;
}

function nowIso(): string {
  return formatLocalTimestamp();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function reportWorkerEventBestEffort(
  client: DispatcherClient,
  workerId: string,
  event: { type: string; taskId?: string; payload?: unknown; at?: string },
): Promise<void> {
  if (typeof client.reportEvent !== "function") {
    return;
  }
  try {
    await client.reportEvent(workerId, {
      type: event.type,
      taskId: event.taskId,
      payload: event.payload,
      at: event.at ?? nowIso(),
    });
  } catch (error) {
    logger.warn({
      operation: "reportWorkerEvent",
      workerId,
      taskId: event.taskId,
      eventType: event.type,
      error: error instanceof Error ? error.message : String(error),
      event: "worker_event_report_failed",
    });
  }
}

function readJson(filePath: string): unknown {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

interface GitResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

function ensureSuccess(result: GitResult, message: string): void {
  if ((result.status ?? 1) !== 0) {
    throw new Error(result.stderr || result.stdout || message);
  }
}

function runGit(args: string[], cwd: string): GitResult {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
  });
  return {
    status: result.status ?? 1,
    stdout: (result.stdout || "").trim(),
    stderr: (result.stderr || "").trim(),
  };
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

type WorkerFailureKind = "preflight" | "execution" | "verification" | "unknown";

function buildWorkerFailureBlocker(
  kind: WorkerFailureKind,
  code: string,
  message: string,
  details?: Record<string, unknown>,
) {
  return {
    kind,
    code,
    message,
    ...(details && Object.keys(details).length > 0 ? { details } : {}),
  };
}

function classifyWorkerDaemonFailure(error: Error | string): {
  failureType: WorkerFailureKind;
  blocker: ReturnType<typeof buildWorkerFailureBlocker>;
} {
  const message = error instanceof Error ? error.message : String(error);
  const lowerMessage = message.toLowerCase();

  if (/refusing to push to default branch|branchname not allowed by forgeflow_allowed_push_prefixes/.test(lowerMessage)) {
    return {
      failureType: "preflight",
      blocker: buildWorkerFailureBlocker("preflight", "branch_protection_hit", message),
    };
  }

  if (/existing worktree already present|already checked out|failed to create worktree|failed to fetch origin|default branch ref|invalid git branch ref|invalid branchname/.test(lowerMessage)) {
    return {
      failureType: "preflight",
      blocker: buildWorkerFailureBlocker("preflight", "workspace_prepare_failed", message),
    };
  }

  if (/operation not permitted|permission denied|sandbox|forbidden|not allowed|blocked by environment/.test(lowerMessage)) {
    return {
      failureType: "preflight",
      blocker: buildWorkerFailureBlocker("preflight", "environment_blocked", message),
    };
  }

  if (/vitest|jest|pnpm test|typecheck|verification/.test(lowerMessage)) {
    return {
      failureType: "verification",
      blocker: buildWorkerFailureBlocker("verification", "verification_failed", message),
    };
  }

  if (/submitresult failed after|failed to push changes|push failed|push failure|failed to create pull request|pr create failed|dispatcher unavailable/.test(lowerMessage)) {
    return {
      failureType: "execution",
      blocker: buildWorkerFailureBlocker("execution", "delivery_failed", message),
    };
  }

  return {
    failureType: "execution",
    blocker: buildWorkerFailureBlocker("execution", "execution_failed", message),
  };
}

function buildWorkerFailureEvidence(error: Error | string): NonNullable<WorkerResult["evidence"]> {
  const classified = classifyWorkerDaemonFailure(error);
  const message = error instanceof Error ? error.message : String(error);
  return {
    failureType: classified.failureType,
    failureSummary: message,
    blockers: [classified.blocker],
    findings: [],
  };
}

function materializeAssignmentPackage(worktreeDir: string, payload: TaskPayload): string {
  const assignmentDir = path.join(
    worktreeDir,
    ".orchestrator",
    "assignments",
    safeTaskDirName(payload.assignment.taskId)
  );
  writeJson(path.join(assignmentDir, "assignment.json"), payload.assignment);
  fs.writeFileSync(path.join(assignmentDir, "worker-prompt.md"), payload.workerPrompt || "");
  fs.writeFileSync(path.join(assignmentDir, "context.md"), payload.contextMarkdown || "");
  return assignmentDir;
}

function collectChangedFiles(repoDir: string): string[] {
  const result = runGit(["status", "--short"], repoDir);
  if ((result.status ?? 1) !== 0) {
    return [];
  }

  return (result.stdout ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/^[A-Z?]{1,2}\s+/, ""))
    .filter(Boolean)
    .filter((line) => !line.startsWith(".orchestrator/"))
    .filter((line) => !line.startsWith("node_modules"));
}

function maybeCommitAndPush(worktreeDir: string, payload: TaskPayload, changedFiles: string[]): void {
  if (changedFiles.length === 0) {
    return;
  }

  const addResult = runGit(["add", ...changedFiles], worktreeDir);
  ensureSuccess(addResult, `failed to stage changes for ${payload.assignment.taskId}`);

  const commitResult = runGit([
    "commit",
    "-m",
    `feat(${payload.assignment.taskId}): ${payload.task.title}`,
  ], worktreeDir);
  ensureSuccess(commitResult, `failed to commit changes for ${payload.assignment.taskId}`);

  const pushResult = runGit([
    "push",
    "-u",
    "origin",
    payload.assignment.branchName,
  ], worktreeDir);
  ensureSuccess(pushResult, `failed to push changes for ${payload.assignment.taskId}`);
}

async function maybeCreatePullRequest(payload: TaskPayload, changedFiles: string[]): Promise<PullRequestInfo | null> {
  if (!shouldCreatePullRequest() || !process.env.GITHUB_TOKEN || changedFiles.length === 0) {
    return null;
  }

  const response = await fetch(`https://api.github.com/repos/${payload.task.repo}/pulls`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      "content-type": "application/json",
      accept: "application/vnd.github+json",
      "user-agent": "forgeflow-worker-daemon",
    },
    body: JSON.stringify({
      title: payload.task.title,
      head: payload.assignment.branchName,
      base: payload.assignment.defaultBranch,
      body: [
        `Task: ${payload.task.id}`,
        "",
        "Changed Files:",
        ...changedFiles.map((item) => `- ${item}`),
      ].join("\n"),
    }),
  });

  const text = await response.text();
  const json = text ? JSON.parse(text) : {};
  if (!response.ok) {
    const message = (json as { message?: string; error?: string }).message
      || (json as { error?: string }).error
      || text
      || `failed to create pull request for ${payload.assignment.taskId}`;
    throw new Error(message);
  }

  return {
    number: (json as { number?: number }).number || 0,
    url: (json as { html_url?: string }).html_url || "",
    headBranch: payload.assignment.branchName,
    baseBranch: payload.assignment.defaultBranch,
  };
}

function buildDryRunWorkerResult(payload: TaskPayload, outputDir: string, generatedAt: string): WorkerResult {
  const workerResult: WorkerResult = {
    taskId: payload.assignment.taskId,
    workerId: "",
    provider: payload.assignment.pool,
    pool: payload.assignment.pool,
    branchName: payload.assignment.branchName,
    repo: payload.assignment.repo,
    defaultBranch: payload.assignment.defaultBranch,
    mode: "run",
    output: "dry-run worker execution completed",
    generatedAt,
    verification: {
      allPassed: true,
      commands: Object.values(payload.assignment.commands ?? {}).map((command) => ({
        command,
        exitCode: 0,
        output: "dry-run ok",
      })),
    },
  };

  writeJson(path.join(outputDir, "worker-result.json"), workerResult);
  writeJson(path.join(outputDir, "worker-verification.json"), workerResult.verification);
  fs.writeFileSync(path.join(outputDir, "worker-output.raw.txt"), "dry-run worker execution completed\n");
  return workerResult;
}

function runWorkerAssignmentScript(repoRoot: string, assignmentDir: string, worktreeDir: string, outputDir: string): Promise<WorkerResult> {
  return new Promise((resolve, reject) => {
    const scriptPath = path.join(repoRoot, "scripts/run-worker-assignment.js");
    const proc = spawn("node", [
      scriptPath,
      "--assignment-dir",
      assignmentDir,
      "--worktree-dir",
      worktreeDir,
      "--output-dir",
      outputDir,
    ], {
      cwd: repoRoot,
      env: buildWorkerEnv(),
    }) as ChildProcess & { stdout?: NodeJS.ReadableStream; stderr?: NodeJS.ReadableStream };

    let stdout = "";
    let stderr = "";

    proc.stdout?.on("data", (data) => {
      stdout += data.toString();
    });

    proc.stderr?.on("data", (data) => {
      stderr += data.toString();
    });

    proc.on("close", (code) => {
      if (code === 0) {
        try {
          const result = readJson(path.join(outputDir, "worker-result.json")) as WorkerResult;
          resolve(result);
        } catch (e) {
          reject(new Error(`failed to read worker-result.json: ${e instanceof Error ? e.message : String(e)}`));
        }
      } else {
        reject(new Error(`worker execution failed with code ${code}: ${stderr || stdout}`));
      }
    });

    proc.on("error", (error) => {
      reject(new Error(`worker execution error: ${error.message}`));
    });
  });
}

const HEARTBEAT_INTERVAL_MS = 10_000;
const HEARTBEAT_TIMEOUT_MS = 5_000;
const HEARTBEAT_MAX_RETRIES = 3;
const HEARTBEAT_RETRY_DELAY_MS = 1_000;
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

function buildWorkerProtocolEnvelope(payload: TaskPayload) {
  return {
    attemptId: payload.attemptId,
    leaseToken: payload.leaseToken,
    protocolVersion: payload.protocolVersion,
    traceId: payload.traceId,
    idempotencyKey: payload.idempotencyKey,
  };
}

async function processTaskAssignment(input: ProcessTaskAssignmentInput): Promise<{
  status: string;
  taskId: string;
  workerId: string;
  worktreeDir: string;
  outputDir: string;
  changedFiles: string[];
  pullRequest: PullRequestInfo | null;
}> {
  const heartbeatClient = input.client;
  const taskId = input.payload.task.id;
  const workerId = input.workerId;
  let worktreeDir: string | null = null;

  let heartbeatIntervalId: ReturnType<typeof setInterval> | null = null;

  const startHeartbeat = () => {
    heartbeatIntervalId = setInterval(async () => {
      try {
        await heartbeatClient.heartbeat(workerId, { at: nowIso() });
      } catch (error) {
        logger.error({ operation: "heartbeat", taskId, error: error instanceof Error ? error.message : String(error), event: "heartbeat_failed" });
      }
    }, HEARTBEAT_INTERVAL_MS);
  };

  const stopHeartbeat = () => {
    if (heartbeatIntervalId) {
      clearInterval(heartbeatIntervalId);
      heartbeatIntervalId = null;
    }
  };

  const startTime = Date.now();
  try {
    await input.client.startTask(input.workerId, {
      taskId: input.payload.task.id,
      ...buildWorkerProtocolEnvelope(input.payload),
      at: input.at ?? nowIso(),
    });

    startHeartbeat();

    assertSafeBranchName(input.repoDir, input.payload.assignment.branchName, input.payload.assignment.defaultBranch);
    worktreeDir = prepareTaskWorktree(input.repoDir, input.payload.assignment, {
      allowReuse: true,
      resetOnReuse: true,
    });
    const assignmentDir = materializeAssignmentPackage(worktreeDir, input.payload);
    const outputDir = path.join(assignmentDir, "execution");
    fs.mkdirSync(outputDir, { recursive: true });

    await reportWorkerEventBestEffort(input.client, input.workerId, {
      type: "progress_reported",
      taskId,
      payload: { stage: "worktree_prepared", message: "worktree prepared, running worker assignment" },
    });

    const workerResult = input.dryRunExecution
      ? buildDryRunWorkerResult(input.payload, outputDir, input.at ?? nowIso())
      : await runWorkerAssignmentScript(input.repoRoot, assignmentDir, worktreeDir, outputDir);

    const changedFiles = input.dryRunExecution ? [] : collectChangedFiles(worktreeDir);
    await reportWorkerEventBestEffort(input.client, input.workerId, {
      type: "progress_reported",
      taskId,
      payload: {
        stage: "execution_completed",
        message: `worker execution completed, ${changedFiles.length} changed file(s)`,
      },
    });
    if (!input.dryRunExecution) {
      maybeCommitAndPush(worktreeDir, input.payload, changedFiles);
    }
    const pullRequest = input.dryRunExecution ? null : await maybeCreatePullRequest(input.payload, changedFiles);

    stopHeartbeat();

    let lastError: string | null = null;
    const submitResultMaxRetries = getSubmitResultMaxRetries();
    const submitResultRetryDelayMs = getSubmitResultRetryDelayMs();
    for (let attempt = 1; attempt <= submitResultMaxRetries; attempt++) {
      try {
        await input.client.submitResult(input.workerId, {
          ...buildWorkerProtocolEnvelope(input.payload),
          result: workerResult,
          changedFiles,
          pullRequest,
        });
        lastError = null;
        break;
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
        logger.error({ operation: "submitResult", taskId, attempt, maxRetries: submitResultMaxRetries, error: lastError, event: "submitResult_retry_failed" });
        await reportWorkerEventBestEffort(input.client, input.workerId, {
          type: "submit_result_retry_failed",
          taskId,
          payload: {
            attempt,
            maxRetries: submitResultMaxRetries,
            error: lastError,
          },
        });
        if (attempt < submitResultMaxRetries) {
          await sleep(submitResultRetryDelayMs);
        }
      }
    }

    if (lastError) {
      logger.error({ operation: "submitResult", taskId, error: lastError, event: "submitResult_all_retries_failed" });
      await reportWorkerEventBestEffort(input.client, input.workerId, {
        type: "delivery_failed",
        taskId,
        payload: {
          stage: "submit_result",
          error: lastError,
          failureCode: "delivery_failed",
        },
      });
      throw new Error(`submitResult failed after ${submitResultMaxRetries} attempts: ${lastError}`);
    }

    const durationMs = Date.now() - startTime;
    logTaskCompleted(input.payload.task.id, input.workerId, durationMs, true);
    recordTaskMetric({
      taskId: input.payload.task.id,
      workerId: input.workerId,
      repo: input.payload.assignment.repo,
      status: "completed",
      durationMs,
      startedAt: new Date(Date.now() - durationMs).toISOString(),
    });

    return {
      status: "completed",
      taskId: input.payload.task.id,
      workerId: input.workerId,
      worktreeDir,
      outputDir,
      changedFiles,
      pullRequest,
    };
  } catch (error) {
    stopHeartbeat();

    const errorMessage = error instanceof Error ? error.message : String(error);
    logTaskFailed(input.payload.task.id, input.workerId, errorMessage);
    recordTaskMetric({
      taskId: input.payload.task.id,
      workerId: input.workerId,
      repo: input.payload.assignment.repo,
      status: "failed",
      durationMs: Date.now() - startTime,
      startedAt: new Date(startTime).toISOString(),
    });
    logger.error({ operation: "taskExecution", taskId, error: errorMessage, event: "task_execution_failed" });

    try {
      const failedResult: WorkerResult = {
        taskId: input.payload.task.id,
        workerId: input.workerId,
        provider: input.payload.assignment.pool,
        pool: input.payload.assignment.pool,
        branchName: input.payload.assignment.branchName,
        repo: input.payload.assignment.repo,
        defaultBranch: input.payload.assignment.defaultBranch,
        mode: "run",
        output: `ERROR: ${errorMessage}`,
        generatedAt: nowIso(),
        verification: {
          allPassed: false,
          commands: [],
        },
        evidence: buildWorkerFailureEvidence(errorMessage),
      };

      const failedOutputDir = path.join(input.repoDir, ".worktrees", "failed", safeTaskDirName(taskId));
      fs.mkdirSync(failedOutputDir, { recursive: true });
      writeJson(path.join(failedOutputDir, "worker-result.json"), failedResult);
      writeJson(path.join(failedOutputDir, "worker-verification.json"), failedResult.verification);
      fs.writeFileSync(path.join(failedOutputDir, "worker-output.raw.txt"), `ERROR: ${errorMessage}\n`);

      const submitResultMaxRetries = getSubmitResultMaxRetries();
      const submitResultRetryDelayMs = getSubmitResultRetryDelayMs();
      for (let attempt = 1; attempt <= submitResultMaxRetries; attempt++) {
        try {
          await input.client.submitResult(input.workerId, {
            ...buildWorkerProtocolEnvelope(input.payload),
            result: failedResult,
            changedFiles: [],
            pullRequest: null,
          });
          logger.warn({ operation: "submitResult", taskId, event: "failed_result_submitted" });
          break;
        } catch (submitError) {
          logger.error({ operation: "submitResult", taskId, attempt, error: submitError instanceof Error ? submitError.message : String(submitError), event: "submitResult_catch_failed" });
          await reportWorkerEventBestEffort(input.client, input.workerId, {
            type: "submit_result_retry_failed",
            taskId,
            payload: {
              attempt,
              maxRetries: submitResultMaxRetries,
              error: submitError instanceof Error ? submitError.message : String(submitError),
              fallback: true,
            },
          });
          if (attempt < submitResultMaxRetries) {
            await sleep(submitResultRetryDelayMs);
          }
        }
      }
    } catch (fallbackError) {
      logger.error({ operation: "submitResult", taskId, error: fallbackError instanceof Error ? fallbackError.message : String(fallbackError), event: "submitResult_fallback_failed" });
      await reportWorkerEventBestEffort(input.client, input.workerId, {
        type: "delivery_failed",
        taskId,
        payload: {
          stage: "failed_result_fallback",
          error: fallbackError instanceof Error ? fallbackError.message : String(fallbackError),
          failureCode: "delivery_failed",
        },
      });
    }

    throw error;
  } finally {
    if (worktreeDir && shouldRemoveWorktreeOnExit()) {
      try {
        removeTaskWorktree(input.repoDir, taskId);
      } catch (cleanupError) {
        logger.warn({
          operation: "cleanupWorktree",
          taskId,
          error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
          event: "worktree_cleanup_failed",
        });
        await reportWorkerEventBestEffort(input.client, input.workerId, {
          type: "worktree_cleanup_failed",
          taskId,
          payload: {
            error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
            failureCode: "cleanup_failed",
          },
        });
      }
    }
  }
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
  const baseUrl = dispatcherUrl.replace(/\/$/, "");

  async function call(method: string, pathname: string, body?: unknown, options: { timeout?: number } = {}): Promise<unknown> {
    const url = `${baseUrl}${pathname}`;
    const timeoutMs = options.timeout ?? 10_000;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    const authHeaders = getDispatcherAuthHeader();

    try {
      const response = await fetch(url, {
        method,
        headers: {
          "content-type": "application/json",
          ...authHeaders,
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      const text = await response.text();
      const json = text ? JSON.parse(text) : {};
      if (!response.ok) {
        throw new Error((json as { error?: string }).error || text || `dispatcher request failed: ${method} ${url} -> ${response.status}`);
      }
      return json;
    } catch (error) {
      clearTimeout(timeoutId);
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new Error(`dispatcher request failed: ${method} ${url} - ${errorMessage}`);
    }
  }

  async function callWithRetry(method: string, pathname: string, body?: unknown, options: { timeout?: number; maxRetries?: number; retryDelayMs?: number } = {}): Promise<unknown> {
    const maxRetries = options.maxRetries ?? 0;
    const retryDelayMs = options.retryDelayMs ?? 1_000;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await call(method, pathname, body, options);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        if (attempt < maxRetries) {
          await sleep(retryDelayMs);
        }
      }
    }
    throw lastError;
  }

  return {
    registerWorker(worker) {
      return call("POST", "/api/workers/register", worker);
    },
    heartbeat(workerId, payload) {
      return callWithRetry("POST", `/api/workers/${encodeURIComponent(workerId)}/heartbeat`, payload, {
        timeout: HEARTBEAT_TIMEOUT_MS,
        maxRetries: HEARTBEAT_MAX_RETRIES,
        retryDelayMs: HEARTBEAT_RETRY_DELAY_MS,
      });
    },
    getAssignedTask(workerId) {
      return call("GET", `/api/workers/${encodeURIComponent(workerId)}/assigned-task`) as Promise<TaskPayload | null>;
    },
    claimTask(workerId, payload = {}) {
      return call("POST", `/api/workers/${encodeURIComponent(workerId)}/claim-task`, payload) as Promise<TaskPayload | null>;
    },
    startTask(workerId, payload) {
      return call("POST", `/api/workers/${encodeURIComponent(workerId)}/start-task`, payload);
    },
    submitResult(workerId, payload) {
      return call("POST", `/api/workers/${encodeURIComponent(workerId)}/result`, payload);
    },
    reportEvent(workerId, payload) {
      return call("POST", `/api/workers/${encodeURIComponent(workerId)}/events`, payload);
    },
  };
}

function readStateDirResponseJson(response: { status: number; json: unknown }): unknown {
  if (response.status >= 400) {
    const error = response.json && typeof response.json === "object" && "error" in response.json
      ? String((response.json as { error?: unknown }).error)
      : `dispatcher state-dir request failed: ${response.status}`;
    throw new Error(error);
  }
  return response.json;
}

export function createStateDirDispatcherClient(stateDir: string): DispatcherClient {
  return {
    registerWorker(worker) {
      const response = handleDispatcherHttpRequest({
        stateDir,
        method: "POST",
        pathname: "/api/workers/register",
        body: worker,
        clientAddress: "127.0.0.1",
        internalCall: true,
      });
      return Promise.resolve(readStateDirResponseJson(response));
    },
    heartbeat(workerId, payload) {
      const response = handleDispatcherHttpRequest({
        stateDir,
        method: "POST",
        pathname: `/api/workers/${encodeURIComponent(workerId)}/heartbeat`,
        body: payload,
        clientAddress: "127.0.0.1",
        internalCall: true,
      });
      return Promise.resolve(readStateDirResponseJson(response));
    },
    getAssignedTask(workerId) {
      const response = handleDispatcherHttpRequest({
        stateDir,
        method: "GET",
        pathname: `/api/workers/${encodeURIComponent(workerId)}/assigned-task`,
        clientAddress: "127.0.0.1",
        internalCall: true,
      });
      return Promise.resolve(readStateDirResponseJson(response)) as Promise<TaskPayload | null>;
    },
    claimTask(workerId, payload = {}) {
      const response = handleDispatcherHttpRequest({
        stateDir,
        method: "POST",
        pathname: `/api/workers/${encodeURIComponent(workerId)}/claim-task`,
        body: payload,
        clientAddress: "127.0.0.1",
        internalCall: true,
      });
      return Promise.resolve(readStateDirResponseJson(response)) as Promise<TaskPayload | null>;
    },
    startTask(workerId, payload) {
      const response = handleDispatcherHttpRequest({
        stateDir,
        method: "POST",
        pathname: `/api/workers/${encodeURIComponent(workerId)}/start-task`,
        body: payload,
        clientAddress: "127.0.0.1",
        internalCall: true,
      });
      return Promise.resolve(readStateDirResponseJson(response));
    },
    submitResult(workerId, payload) {
      const response = handleDispatcherHttpRequest({
        stateDir,
        method: "POST",
        pathname: `/api/workers/${encodeURIComponent(workerId)}/result`,
        body: payload,
        clientAddress: "127.0.0.1",
        internalCall: true,
      });
      return Promise.resolve(readStateDirResponseJson(response));
    },
    reportEvent(workerId, payload) {
      const response = handleDispatcherHttpRequest({
        stateDir,
        method: "POST",
        pathname: `/api/workers/${encodeURIComponent(workerId)}/events`,
        body: payload,
        clientAddress: "127.0.0.1",
        internalCall: true,
      });
      return Promise.resolve(readStateDirResponseJson(response));
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

export async function runWorkerDaemonCycle(input: RunWorkerDaemonCycleInput): Promise<{ status: string; workerId: string } | { status: string; taskId: string; workerId: string; worktreeDir: string; outputDir: string; changedFiles: string[]; pullRequest: PullRequestInfo | null }> {
  const client = input.client ?? createDispatcherClient(input.dispatcherUrl || "");
  const at = input.at ?? nowIso();

  await client.registerWorker({
    workerId: input.workerId,
    pool: input.pool,
    hostname: input.hostname ?? os.hostname(),
    labels: input.labels ?? [],
    repoDir: input.repoDir,
    at,
  });
  await client.heartbeat(input.workerId, { at });

  const assigned = await client.claimTask(input.workerId, { at }) as TaskPayload | null;
  if (!assigned || !assigned.assignment || !assigned.task) {
    return {
      status: "idle",
      workerId: input.workerId,
    };
  }

  return processTaskAssignment({
    client,
    repoRoot: input.repoRoot ?? path.resolve(path.dirname(new URL(import.meta.url).pathname), "../.."),
    workerId: input.workerId,
    repoDir: input.repoDir,
    payload: {
      assignment: assigned.assignment,
      task: assigned.task,
      ...buildWorkerProtocolEnvelope(assigned),
    } as TaskPayload,
    dryRunExecution: Boolean(input.dryRunExecution),
    at,
  });
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
