import fs from "node:fs";
import path from "node:path";
import { ChildProcess } from "node:child_process";

import { safeTaskDirName } from "./task-worktree.js";
import { ensureSuccess, runGit } from "./git.js";
import { buildWorkerEnv } from "./worker-env.js";
import { spawnProcessTree, terminateProcessTree } from "./process-tree.js";
import { readJson, writeJson } from "./utils.js";
import type { PullRequestInfo, TaskPayload, WorkerResult } from "./types.js";

export function materializeAssignmentPackage(worktreeDir: string, payload: TaskPayload): string {
  const assignmentDir = path.join(worktreeDir, ".orchestrator", "assignments", safeTaskDirName(payload.assignment.taskId));
  writeJson(path.join(assignmentDir, "assignment.json"), {
    ...payload.assignment,
    resumePayload: payload.resumePayload ?? payload.assignment.resumePayload ?? null,
  });
  fs.writeFileSync(path.join(assignmentDir, "worker-prompt.md"), payload.workerPrompt || "");
  fs.writeFileSync(path.join(assignmentDir, "context.md"), payload.contextMarkdown || "");
  return assignmentDir;
}

export function collectChangedFiles(repoDir: string): string[] {
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

export function maybeCommitAndPush(worktreeDir: string, payload: TaskPayload, changedFiles: string[]): void {
  if (changedFiles.length === 0) {
    return;
  }

  ensureSuccess(runGit(["add", ...changedFiles], worktreeDir), `failed to stage changes for ${payload.assignment.taskId}`);
  ensureSuccess(runGit(["commit", "-m", `feat(${payload.assignment.taskId}): ${payload.task.title}`], worktreeDir), `failed to commit changes for ${payload.assignment.taskId}`);
  ensureSuccess(runGit(["push", "-u", "origin", payload.assignment.branchName], worktreeDir), `failed to push changes for ${payload.assignment.taskId}`);
}

export function assertSafeBranchName(
  repoDir: string,
  branchName: string,
  defaultBranch: string,
  envSource: NodeJS.ProcessEnv = process.env,
): void {
  const normalizedBranch = branchName.trim();
  if (!normalizedBranch) {
    throw new Error("invalid branchName (empty)");
  }
  if (normalizedBranch !== branchName) {
    throw new Error("invalid branchName (surrounding whitespace)");
  }
  if (normalizedBranch === defaultBranch) {
    throw new Error(`refusing to push to default branch: ${defaultBranch}`);
  }
  const allowedPrefixes = String(envSource.FORGEFLOW_ALLOWED_PUSH_PREFIXES || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  if (allowedPrefixes.length > 0 && !allowedPrefixes.some((prefix) => normalizedBranch.startsWith(prefix))) {
    throw new Error(`branchName not allowed by FORGEFLOW_ALLOWED_PUSH_PREFIXES: ${normalizedBranch}`);
  }
  ensureSuccess(runGit(["check-ref-format", "--branch", normalizedBranch], repoDir), `invalid git branch ref: ${normalizedBranch}`);
}

export function shouldCreatePullRequest(envSource: NodeJS.ProcessEnv = process.env): boolean {
  return envSource.FORGEFLOW_WORKER_CREATE_PR === "1";
}

export async function maybeCreatePullRequest(
  payload: TaskPayload,
  changedFiles: string[],
  options: { createPullRequest?: boolean } = {},
): Promise<PullRequestInfo | null> {
  if (!options.createPullRequest || !process.env.GITHUB_TOKEN || changedFiles.length === 0) {
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
      body: [`Task: ${payload.task.id}`, "", "Changed Files:", ...changedFiles.map((item) => `- ${item}`)].join("\n"),
    }),
  });

  return parsePullRequestResponse(response, payload);
}

async function parsePullRequestResponse(response: Response, payload: TaskPayload): Promise<PullRequestInfo> {
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

export function buildDryRunWorkerResult(payload: TaskPayload, outputDir: string, generatedAt: string): WorkerResult {
  const workerResult = createWorkerResult({
    payload,
    workerId: "",
    output: "dry-run worker execution completed",
    allPassed: true,
    generatedAt,
  });
  workerResult.verification.commands = Object.values(payload.assignment.commands ?? {}).map((command) => ({
    command,
    exitCode: 0,
    output: "dry-run ok",
  }));
  writeWorkerResultFiles(outputDir, workerResult, "dry-run worker execution completed\n");
  return workerResult;
}

export function createFailedWorkerResult(input: { payload: TaskPayload; workerId: string; errorMessage: string; generatedAt: string }): WorkerResult {
  const workerResult = createWorkerResult({
    payload: input.payload,
    workerId: input.workerId,
    output: `ERROR: ${input.errorMessage}`,
    allPassed: false,
    generatedAt: input.generatedAt,
  });
  workerResult.evidence = buildWorkerFailureEvidence(input.errorMessage);
  return workerResult;
}

type WorkerFailureKind = "preflight" | "execution" | "verification" | "unknown";

function buildWorkerFailureEvidence(errorMessage: string): NonNullable<WorkerResult["evidence"]> {
  const classified = classifyWorkerFailure(errorMessage);
  return {
    failureType: classified.failureType,
    failureSummary: errorMessage,
    blockers: [{
      kind: classified.failureType,
      code: classified.code,
      message: errorMessage,
    }],
    findings: [],
  };
}

function classifyWorkerFailure(message: string): { failureType: WorkerFailureKind; code: string } {
  const lowerMessage = message.toLowerCase();
  if (/refusing to push to default branch|branchname not allowed by forgeflow_allowed_push_prefixes/.test(lowerMessage)) {
    return { failureType: "preflight", code: "branch_protection_hit" };
  }
  if (/existing worktree already present|already checked out|failed to create worktree|failed to fetch origin|default branch ref|invalid git branch ref|invalid branchname/.test(lowerMessage)) {
    return { failureType: "preflight", code: "workspace_prepare_failed" };
  }
  if (/operation not permitted|permission denied|sandbox|forbidden|not allowed|blocked by environment/.test(lowerMessage)) {
    return { failureType: "preflight", code: "environment_blocked" };
  }
  if (/vitest|jest|pnpm test|typecheck|verification/.test(lowerMessage)) {
    return { failureType: "verification", code: "verification_failed" };
  }
  if (/submitresult failed after|failed to push changes|push failed|push failure|could not read from remote repository|does not appear to be a git repository|failed to create pull request|pr create failed|dispatcher unavailable/.test(lowerMessage)) {
    return { failureType: "execution", code: "delivery_failed" };
  }
  return { failureType: "execution", code: "execution_failed" };
}

function createWorkerResult(input: WorkerResultInput): WorkerResult {
  return {
    taskId: input.payload.assignment.taskId,
    workerId: input.workerId,
    provider: input.payload.assignment.pool,
    pool: input.payload.assignment.pool,
    branchName: input.payload.assignment.branchName,
    repo: input.payload.assignment.repo,
    defaultBranch: input.payload.assignment.defaultBranch,
    mode: "run",
    output: input.output,
    generatedAt: input.generatedAt,
    verification: {
      allPassed: input.allPassed,
      commands: [],
    },
  };
}

export function writeWorkerResultFiles(outputDir: string, workerResult: WorkerResult, rawOutput: string): void {
  writeJson(path.join(outputDir, "worker-result.json"), workerResult);
  writeJson(path.join(outputDir, "worker-verification.json"), workerResult.verification);
  fs.writeFileSync(path.join(outputDir, "worker-output.raw.txt"), rawOutput);
}

export interface RunWorkerAssignmentScriptInput {
  packageRoot: string;
  assignmentDir: string;
  worktreeDir: string;
  outputDir: string;
  provider?: string;
  runtimeScriptPath?: string;
  runtimeScriptCwd?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}

interface WorkerProcessResultHandlers {
  outputDir: string;
  resolve: (value: WorkerResult) => void;
  reject: (reason?: unknown) => void;
}

interface WorkerResultInput {
  payload: TaskPayload;
  workerId: string;
  output: string;
  allPassed: boolean;
  generatedAt: string;
}

export function runWorkerAssignmentScript(input: RunWorkerAssignmentScriptInput): Promise<WorkerResult> {
  return new Promise((resolve, reject) => {
    const scriptPath = input.runtimeScriptPath ?? path.join(input.packageRoot, "dist/runtime/run-worker-assignment.js");
    if (!fs.existsSync(scriptPath)) {
      reject(new Error(`run-worker-assignment runtime script not found: ${scriptPath}`));
      return;
    }
    if (input.signal?.aborted) {
      reject(new Error("worker execution aborted before launch"));
      return;
    }
    const proc = spawnWorkerAssignmentProcess(input);
    collectWorkerAssignmentResult(proc, {
      outputDir: input.outputDir,
      resolve,
      reject,
    }, {
      signal: input.signal,
      timeoutMs: input.timeoutMs,
    });
  });
}

function spawnWorkerAssignmentProcess(input: RunWorkerAssignmentScriptInput) {
  const scriptPath = input.runtimeScriptPath ?? path.join(input.packageRoot, "dist/runtime/run-worker-assignment.js");
  return spawnProcessTree("node", [
    scriptPath,
    "--assignment-dir",
    input.assignmentDir,
    "--worktree-dir",
    input.worktreeDir,
    "--output-dir",
    input.outputDir,
  ], {
    cwd: input.runtimeScriptCwd ?? input.packageRoot,
    env: buildWorkerEnv(process.env, input.provider),
  }) as ChildProcess & { stdout?: NodeJS.ReadableStream; stderr?: NodeJS.ReadableStream };
}

function collectWorkerAssignmentResult(
  proc: ChildProcess & { stdout?: NodeJS.ReadableStream; stderr?: NodeJS.ReadableStream },
  handlers: WorkerProcessResultHandlers,
  lifecycle: { signal?: AbortSignal; timeoutMs?: number },
): void {
  let stdout = "";
  let stderr = "";
  let aborted = false;
  let timedOut = false;
  let settled = false;
  const timeoutId = Number.isSafeInteger(lifecycle.timeoutMs) && (lifecycle.timeoutMs ?? 0) > 0
    ? setTimeout(() => {
        timedOut = true;
        terminateProcessTree(proc);
      }, lifecycle.timeoutMs)
    : null;
  const onAbort = () => {
    aborted = true;
    terminateProcessTree(proc);
  };
  lifecycle.signal?.addEventListener("abort", onAbort, { once: true });
  const cleanup = () => {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    lifecycle.signal?.removeEventListener("abort", onAbort);
  };
  proc.stdout?.on("data", (data) => {
    stdout += data.toString();
  });
  proc.stderr?.on("data", (data) => {
    stderr += data.toString();
  });
  proc.on("close", (code) => {
    if (settled) return;
    settled = true;
    cleanup();
    if (aborted) {
      handlers.reject(new Error("worker execution aborted"));
      return;
    }
    if (timedOut) {
      handlers.reject(new Error(`worker execution timed out after ${lifecycle.timeoutMs}ms`));
      return;
    }
    resolveOrRejectWorkerResult({ code, stdout, stderr, ...handlers });
  });
  proc.on("error", (error) => {
    if (settled) return;
    settled = true;
    cleanup();
    handlers.reject(new Error(`worker execution error: ${error.message}`));
  });
}

function resolveOrRejectWorkerResult(input: WorkerProcessResultHandlers & { code: number | null; stdout: string; stderr: string }): void {
  if (input.code !== 0) {
    input.reject(new Error(`worker execution failed with code ${input.code}: ${input.stderr || input.stdout}`));
    return;
  }
  try {
    input.resolve(readJson(path.join(input.outputDir, "worker-result.json")) as WorkerResult);
  } catch (error) {
    input.reject(new Error(`failed to read worker-result.json: ${error instanceof Error ? error.message : String(error)}`));
  }
}
