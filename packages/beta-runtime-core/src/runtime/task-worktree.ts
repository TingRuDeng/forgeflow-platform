import fs from "node:fs";
import path from "node:path";
import { execFile, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { promisify } from "node:util";

import { createAbortError, throwIfAborted } from "./abort-signal.js";

const execFileAsync = promisify(execFile);

export const DEFAULT_WORKTREE_COMMAND_TIMEOUT_MS = 60_000;

interface GitResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

export interface TaskWorktreeInfo {
  taskId?: string;
  task_id?: string;
  branchName?: string;
  branch?: string;
  defaultBranch?: string;
  default_branch?: string;
}

export interface PrepareOptions {
  allowReuse?: boolean;
  resetOnReuse?: boolean;
  commandTimeoutMs?: number;
  signal?: AbortSignal;
}

export interface RemoveOptions {
  force?: boolean;
  commandTimeoutMs?: number;
  signal?: AbortSignal;
  worktreeDir?: string;
  branchName?: string;
}

export interface PreparedTaskWorktree {
  action: "created" | "reused";
  taskId: string;
  branchName: string;
  baseRef: string | null;
  worktreeDir: string;
}

export interface RemovedTaskWorktree {
  action: "removed" | "absent";
  taskId: string;
  worktreeDir: string;
}

interface NormalizedTaskWorktree {
  taskId: string;
  branchName: string;
  defaultBranch: string;
  worktreeDir: string;
}

interface WorktreeRegistration {
  path: string;
  branch: string | null;
}

function resolveCommandTimeoutMs(value: number | undefined): number {
  return Number.isSafeInteger(value) && (value ?? 0) > 0
    ? value as number
    : DEFAULT_WORKTREE_COMMAND_TIMEOUT_MS;
}

function ensureSuccess(result: GitResult, message: string): void {
  if ((result.status ?? 1) !== 0) {
    const details = String(result.stderr || result.stdout || "").trim();
    throw new Error(details ? `${message}: ${details}` : message);
  }
}

function legacySafeTaskDirName(taskId: unknown): string {
  const rawTaskId = String(taskId || "").trim();
  return rawTaskId
    .replace(/[^\p{L}\p{N}._-]+/gu, "-")
    .replace(/^-+|-+$/g, "");
}

export function safeTaskDirName(taskId: unknown): string {
  const rawTaskId = String(taskId || "").trim();
  const readableName = legacySafeTaskDirName(rawTaskId);
  if (!readableName || readableName === "." || readableName === "..") {
    return readableName;
  }
  if (rawTaskId === readableName && [...readableName].length <= 48) {
    return readableName;
  }
  const readablePrefix = [...readableName].slice(0, 48).join("");
  const identityHash = createHash("sha256").update(rawTaskId).digest("hex").slice(0, 12);
  return `${readablePrefix}-${identityHash}`;
}

function requireSafeTaskDirName(taskId: string): string {
  const directoryName = safeTaskDirName(taskId);
  if (!directoryName || directoryName === "." || directoryName === "..") {
    throw new Error(`taskId does not produce a safe worktree directory: ${taskId}`);
  }
  return directoryName;
}

function canonicalPath(value: string): string {
  try {
    return fs.realpathSync.native(value);
  } catch {
    const resolved = path.resolve(value);
    const missingSegments: string[] = [];
    let ancestor = resolved;
    while (!fs.existsSync(ancestor)) {
      const parent = path.dirname(ancestor);
      if (parent === ancestor) {
        return resolved;
      }
      missingSegments.unshift(path.basename(ancestor));
      ancestor = parent;
    }
    try {
      return path.join(fs.realpathSync.native(ancestor), ...missingSegments);
    } catch {
      return resolved;
    }
  }
}

function legacyTaskWorktreeDir(repoDir: string, taskId: string): string {
  return path.join(repoDir, ".worktrees", legacySafeTaskDirName(taskId));
}

function resolveCompatibleWorktreeDir(
  repoDir: string,
  normalized: NormalizedTaskWorktree,
  registrations: WorktreeRegistration[],
): string {
  const branchRegistration = registrations.find((entry) => entry.branch === normalized.branchName);
  if (!branchRegistration || branchRegistration.path === canonicalPath(normalized.worktreeDir)) {
    return normalized.worktreeDir;
  }

  const legacyDir = legacyTaskWorktreeDir(repoDir, normalized.taskId);
  if (
    canonicalPath(legacyDir) !== canonicalPath(normalized.worktreeDir)
    && branchRegistration.path === canonicalPath(legacyDir)
  ) {
    return legacyDir;
  }
  throw new Error(`branch ${normalized.branchName} is already checked out at ${branchRegistration.path}`);
}

function resolveRemovalWorktreeDir(
  repoDir: string,
  taskId: string,
  options: RemoveOptions,
  registrations: WorktreeRegistration[],
): string {
  const preferredDir = path.join(repoDir, ".worktrees", requireSafeTaskDirName(taskId));
  const legacyDir = legacyTaskWorktreeDir(repoDir, taskId);
  const candidateDirs = [...new Set([preferredDir, legacyDir].map((candidate) => path.resolve(candidate)))];
  const registeredDirs = candidateDirs.filter((candidate) =>
    registrations.some((entry) => entry.path === canonicalPath(candidate))
  );
  if (registeredDirs.length > 1 && !options.worktreeDir) {
    throw new Error(`multiple registered worktree paths found for ${taskId}; exact worktreeDir required`);
  }

  const requestedPath = options.worktreeDir ? path.resolve(options.worktreeDir) : null;
  const selectedDir = requestedPath
    ? candidateDirs.find((candidate) => candidate === requestedPath)
    : registeredDirs[0]
      ?? candidateDirs.find((candidate) => fs.existsSync(candidate))
      ?? path.resolve(preferredDir);
  if (!selectedDir) {
    throw new Error(`refusing to remove unexpected worktree path for ${taskId}: ${options.worktreeDir}`);
  }
  if (fs.existsSync(selectedDir) && fs.lstatSync(selectedDir).isSymbolicLink()) {
    throw new Error(`refusing to remove symbolic-link worktree path: ${selectedDir}`);
  }
  if (
    path.resolve(legacyDir) !== path.resolve(preferredDir)
    && selectedDir === path.resolve(legacyDir)
    && !options.branchName
  ) {
    throw new Error(`legacy worktree cleanup requires branchName for task: ${taskId}`);
  }
  return selectedDir;
}

function normalizeTaskWorktree(repoDir: string, task: TaskWorktreeInfo): NormalizedTaskWorktree {
  const taskId = String(task?.taskId || task?.task_id || "").trim();
  if (!taskId) {
    throw new Error("taskId is required");
  }

  const branchName = String(task?.branchName || task?.branch || "").trim();
  if (!branchName) {
    throw new Error(`branchName is required for ${taskId}`);
  }

  const defaultBranch = String(task?.defaultBranch || task?.default_branch || "main").trim() || "main";
  if (branchName === defaultBranch) {
    throw new Error(`refusing to use default branch as task worktree branch: ${defaultBranch}`);
  }
  const directoryName = requireSafeTaskDirName(taskId);

  return {
    taskId,
    branchName,
    defaultBranch,
    worktreeDir: path.join(repoDir, ".worktrees", directoryName),
  };
}

function runGit(args: string[], cwd: string, options: PrepareOptions | RemoveOptions = {}): GitResult {
  throwIfAborted(options.signal, `git ${args.join(" ")} aborted`);
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    timeout: resolveCommandTimeoutMs(options.commandTimeoutMs),
  });
  throwIfAborted(options.signal, `git ${args.join(" ")} aborted`);
  if ((result.error as NodeJS.ErrnoException | undefined)?.code === "ETIMEDOUT") {
    throw new Error(`git ${args.join(" ")} timed out after ${resolveCommandTimeoutMs(options.commandTimeoutMs)}ms`);
  }
  return {
    status: result.status ?? 1,
    stdout: (result.stdout || "").trim(),
    stderr: (result.stderr || result.error?.message || "").trim(),
  };
}

async function runGitAsync(
  args: string[],
  cwd: string,
  options: PrepareOptions | RemoveOptions = {},
): Promise<GitResult> {
  const timeoutMs = resolveCommandTimeoutMs(options.commandTimeoutMs);
  throwIfAborted(options.signal, `git ${args.join(" ")} aborted`);
  try {
    const result = await execFileAsync("git", args, {
      cwd,
      encoding: "utf8",
      timeout: timeoutMs,
      signal: options.signal,
      maxBuffer: 4 * 1024 * 1024,
    });
    return {
      status: 0,
      stdout: String(result.stdout || "").trim(),
      stderr: String(result.stderr || "").trim(),
    };
  } catch (error) {
    if (options.signal?.aborted || (error instanceof Error && error.name === "AbortError")) {
      throw createAbortError(`git ${args.join(" ")} aborted`);
    }
    const failure = error as Error & {
      code?: string | number;
      killed?: boolean;
      stdout?: string | Buffer;
      stderr?: string | Buffer;
    };
    if (failure.killed || failure.code === "ETIMEDOUT") {
      throw new Error(`git ${args.join(" ")} timed out after ${timeoutMs}ms`);
    }
    return {
      status: typeof failure.code === "number" ? failure.code : 1,
      stdout: String(failure.stdout || "").trim(),
      stderr: String(failure.stderr || failure.message || "").trim(),
    };
  }
}

function parseWorktreeRegistrations(stdout: string): WorktreeRegistration[] {
  const registrations: WorktreeRegistration[] = [];
  let currentPath = "";
  let currentBranch: string | null = null;

  const flush = () => {
    if (currentPath) {
      registrations.push({ path: canonicalPath(currentPath), branch: currentBranch });
    }
    currentPath = "";
    currentBranch = null;
  };

  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim()) {
      flush();
    } else if (line.startsWith("worktree ")) {
      currentPath = line.slice("worktree ".length).trim();
    } else if (line.startsWith("branch refs/heads/")) {
      currentBranch = line.slice("branch refs/heads/".length).trim();
    }
  }
  flush();
  return registrations;
}

function validateReuse(
  normalized: NormalizedTaskWorktree,
  registrations: WorktreeRegistration[],
  options: PrepareOptions,
): "reused" | "create" {
  const expectedPath = canonicalPath(normalized.worktreeDir);
  const branchRegistration = registrations.find((entry) => entry.branch === normalized.branchName);
  const pathRegistration = registrations.find((entry) => entry.path === expectedPath);

  if (branchRegistration && branchRegistration.path !== expectedPath) {
    throw new Error(`branch ${normalized.branchName} is already checked out at ${branchRegistration.path}`);
  }
  if (fs.existsSync(normalized.worktreeDir) && !pathRegistration) {
    throw new Error(`existing worktree path is not registered with git: ${normalized.worktreeDir}`);
  }
  if (pathRegistration && pathRegistration.branch !== normalized.branchName) {
    throw new Error(
      `worktree path ${normalized.worktreeDir} is registered for ${pathRegistration.branch ?? "a detached HEAD"}, not ${normalized.branchName}`,
    );
  }
  if (pathRegistration && !fs.existsSync(normalized.worktreeDir)) {
    throw new Error(`registered worktree path is missing from disk: ${normalized.worktreeDir}`);
  }
  if (!pathRegistration) {
    return "create";
  }
  if (!options.allowReuse) {
    throw new Error(`existing worktree already present for ${normalized.taskId}`);
  }
  return "reused";
}

function resolveBaseRef(repoDir: string, defaultBranch: string, options: PrepareOptions): string {
  const originRef = `origin/${defaultBranch}`;
  const originCheck = runGit(["rev-parse", "--verify", originRef], repoDir, options);
  if ((originCheck.status ?? 1) === 0) {
    return originRef;
  }
  throw new Error(`default branch ref ${originRef} is unavailable after fetch`);
}

async function resolveBaseRefAsync(
  repoDir: string,
  defaultBranch: string,
  options: PrepareOptions,
): Promise<string> {
  const originRef = `origin/${defaultBranch}`;
  const originCheck = await runGitAsync(["rev-parse", "--verify", originRef], repoDir, options);
  if ((originCheck.status ?? 1) === 0) {
    return originRef;
  }
  throw new Error(`default branch ref ${originRef} is unavailable after fetch`);
}

function resetExistingWorktree(worktreeDir: string, taskId: string, options: PrepareOptions): void {
  ensureSuccess(
    runGit(["reset", "--hard", "HEAD"], worktreeDir, options),
    `failed to reset existing worktree for ${taskId}`,
  );
  ensureSuccess(
    runGit(["clean", "-fd"], worktreeDir, options),
    `failed to clean existing worktree for ${taskId}`,
  );
}

async function resetExistingWorktreeAsync(
  worktreeDir: string,
  taskId: string,
  options: PrepareOptions,
): Promise<void> {
  ensureSuccess(
    await runGitAsync(["reset", "--hard", "HEAD"], worktreeDir, options),
    `failed to reset existing worktree for ${taskId}`,
  );
  ensureSuccess(
    await runGitAsync(["clean", "-fd"], worktreeDir, options),
    `failed to clean existing worktree for ${taskId}`,
  );
}

export function prepareTaskWorktree(repoDir: string, task: TaskWorktreeInfo, options: PrepareOptions = {}): string {
  const normalized = normalizeTaskWorktree(repoDir, task);
  ensureSuccess(
    runGit(["check-ref-format", "--branch", normalized.branchName], repoDir, options),
    `invalid task branch name: ${normalized.branchName}`,
  );
  const worktreeRoot = path.dirname(normalized.worktreeDir);
  fs.mkdirSync(worktreeRoot, { recursive: true });

  const listResult = runGit(["worktree", "list", "--porcelain"], repoDir, options);
  ensureSuccess(listResult, "failed to list git worktrees");
  const registrations = parseWorktreeRegistrations(listResult.stdout);
  const effectiveNormalized = {
    ...normalized,
    worktreeDir: resolveCompatibleWorktreeDir(repoDir, normalized, registrations),
  };
  const action = validateReuse(effectiveNormalized, registrations, options);
  if (action === "reused") {
    if (options.resetOnReuse) {
      resetExistingWorktree(effectiveNormalized.worktreeDir, normalized.taskId, options);
    }
    return effectiveNormalized.worktreeDir;
  }

  ensureSuccess(
    runGit(["fetch", "origin", normalized.defaultBranch], repoDir, options),
    `failed to fetch origin/${normalized.defaultBranch}`,
  );
  const baseRef = resolveBaseRef(repoDir, normalized.defaultBranch, options);
  ensureSuccess(
    runGit([
      "worktree",
      "add",
      effectiveNormalized.worktreeDir,
      "-B",
      normalized.branchName,
      baseRef,
    ], repoDir, options),
    `failed to create worktree for ${normalized.taskId}`,
  );
  return effectiveNormalized.worktreeDir;
}

export async function prepareTaskWorktreeLifecycle(
  repoDir: string,
  task: TaskWorktreeInfo,
  options: PrepareOptions = {},
): Promise<PreparedTaskWorktree> {
  const normalized = normalizeTaskWorktree(repoDir, task);
  ensureSuccess(
    await runGitAsync(["check-ref-format", "--branch", normalized.branchName], repoDir, options),
    `invalid task branch name: ${normalized.branchName}`,
  );
  const worktreeRoot = path.dirname(normalized.worktreeDir);
  fs.mkdirSync(worktreeRoot, { recursive: true });

  const listResult = await runGitAsync(["worktree", "list", "--porcelain"], repoDir, options);
  ensureSuccess(listResult, "failed to list git worktrees");
  const registrations = parseWorktreeRegistrations(listResult.stdout);
  const effectiveNormalized = {
    ...normalized,
    worktreeDir: resolveCompatibleWorktreeDir(repoDir, normalized, registrations),
  };
  const action = validateReuse(effectiveNormalized, registrations, options);
  if (action === "reused") {
    if (options.resetOnReuse) {
      await resetExistingWorktreeAsync(effectiveNormalized.worktreeDir, normalized.taskId, options);
    }
    return {
      action,
      taskId: normalized.taskId,
      branchName: normalized.branchName,
      baseRef: null,
      worktreeDir: effectiveNormalized.worktreeDir,
    };
  }

  ensureSuccess(
    await runGitAsync(["fetch", "origin", normalized.defaultBranch], repoDir, options),
    `failed to fetch origin/${normalized.defaultBranch}`,
  );
  const baseRef = await resolveBaseRefAsync(repoDir, normalized.defaultBranch, options);
  ensureSuccess(
    await runGitAsync([
      "worktree",
      "add",
      effectiveNormalized.worktreeDir,
      "-B",
      normalized.branchName,
      baseRef,
    ], repoDir, options),
    `failed to create worktree for ${normalized.taskId}`,
  );
  return {
    action: "created",
    taskId: normalized.taskId,
    branchName: normalized.branchName,
    baseRef,
    worktreeDir: effectiveNormalized.worktreeDir,
  };
}

export function removeTaskWorktree(repoDir: string, taskId: unknown, options: RemoveOptions = {}): void {
  const normalizedTaskId = String(taskId || "").trim();
  if (!normalizedTaskId) {
    throw new Error("taskId is required");
  }
  requireSafeTaskDirName(normalizedTaskId);
  const listResult = runGit(["worktree", "list", "--porcelain"], repoDir, options);
  ensureSuccess(listResult, "failed to list git worktrees");
  const registrations = parseWorktreeRegistrations(listResult.stdout);
  const worktreeDir = resolveRemovalWorktreeDir(repoDir, normalizedTaskId, options, registrations);
  const registration = registrations.find((entry) => entry.path === canonicalPath(worktreeDir));
  if (!registration && !fs.existsSync(worktreeDir)) {
    return;
  }
  if (!registration) {
    throw new Error(`refusing to remove unregistered worktree path: ${worktreeDir}`);
  }
  if (!fs.existsSync(worktreeDir)) {
    throw new Error(`registered worktree path is missing from disk: ${worktreeDir}`);
  }
  if (options.branchName && registration.branch !== options.branchName) {
    throw new Error(`refusing to remove worktree not registered for ${options.branchName}: ${worktreeDir}`);
  }
  const force = options.force ?? false;
  const args = ["worktree", "remove", ...(force ? ["--force"] : []), worktreeDir];
  ensureSuccess(
    runGit(args, repoDir, options),
    force
      ? `failed to force-remove worktree for ${normalizedTaskId}`
      : `failed to remove worktree for ${normalizedTaskId}; preserve dirty worktree or retry with force`,
  );
}

export async function removeTaskWorktreeLifecycle(
  repoDir: string,
  taskId: unknown,
  options: RemoveOptions = {},
): Promise<RemovedTaskWorktree> {
  const normalizedTaskId = String(taskId || "").trim();
  if (!normalizedTaskId) {
    throw new Error("taskId is required");
  }
  requireSafeTaskDirName(normalizedTaskId);
  const listResult = await runGitAsync(["worktree", "list", "--porcelain"], repoDir, options);
  ensureSuccess(listResult, "failed to list git worktrees");
  const registrations = parseWorktreeRegistrations(listResult.stdout);
  const worktreeDir = resolveRemovalWorktreeDir(repoDir, normalizedTaskId, options, registrations);
  const registration = registrations
    .find((entry) => entry.path === canonicalPath(worktreeDir));
  if (!registration && !fs.existsSync(worktreeDir)) {
    return { action: "absent", taskId: normalizedTaskId, worktreeDir };
  }
  if (!registration) {
    throw new Error(`refusing to remove unregistered worktree path: ${worktreeDir}`);
  }
  if (!fs.existsSync(worktreeDir)) {
    throw new Error(`registered worktree path is missing from disk: ${worktreeDir}`);
  }
  if (options.branchName && registration.branch !== options.branchName) {
    throw new Error(`refusing to remove worktree not registered for ${options.branchName}: ${worktreeDir}`);
  }

  const args = ["worktree", "remove", ...(options.force ? ["--force"] : []), worktreeDir];
  ensureSuccess(
    await runGitAsync(args, repoDir, options),
    options.force
      ? `failed to force-remove worktree for ${normalizedTaskId}`
      : `failed to remove worktree for ${normalizedTaskId}; preserve dirty worktree or retry with force`,
  );
  return { action: "removed", taskId: normalizedTaskId, worktreeDir };
}
