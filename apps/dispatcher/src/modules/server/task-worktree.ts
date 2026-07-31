import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";

interface GitResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

export interface TaskInfo {
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
}

export interface RemoveOptions {
  force?: boolean;
  commandTimeoutMs?: number;
  worktreeDir?: string;
  branchName?: string;
}

interface WorktreeRegistration {
  path: string;
  branch: string | null;
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

function resolveCompatibleWorktreeDir(
  repoDir: string,
  taskId: string,
  branchName: string,
  preferredDir: string,
  registrations: WorktreeRegistration[],
): string {
  const branchRegistration = registrations.find((entry) => entry.branch === branchName);
  if (!branchRegistration || branchRegistration.path === canonicalPath(preferredDir)) {
    return preferredDir;
  }

  const legacyDir = path.join(repoDir, ".worktrees", legacySafeTaskDirName(taskId));
  if (
    canonicalPath(legacyDir) !== canonicalPath(preferredDir)
    && branchRegistration.path === canonicalPath(legacyDir)
  ) {
    return legacyDir;
  }
  throw new Error(`branch ${branchName} is already checked out at ${branchRegistration.path}`);
}

function resolveRemovalWorktreeDir(
  repoDir: string,
  taskId: string,
  options: RemoveOptions,
  registrations: WorktreeRegistration[],
): string {
  const preferredDir = path.join(repoDir, ".worktrees", requireSafeTaskDirName(taskId));
  const legacyDir = path.join(repoDir, ".worktrees", legacySafeTaskDirName(taskId));
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

function runGit(args: string[], cwd: string, timeoutMs = 60_000): GitResult {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    timeout: timeoutMs,
  });
  return {
    status: result.status ?? 1,
    stdout: (result.stdout || "").trim(),
    stderr: (result.stderr || result.error?.message || "").trim(),
  };
}

function resolveBaseRef(repoDir: string, defaultBranch: string, timeoutMs: number): string {
  const originRef = `origin/${defaultBranch}`;
  const originCheck = runGit(["rev-parse", "--verify", originRef], repoDir, timeoutMs);
  if ((originCheck.status ?? 1) === 0) {
    return originRef;
  }
  throw new Error(`default branch ref ${originRef} is unavailable after fetch`);
}

function resetExistingWorktree(worktreeDir: string, timeoutMs: number): void {
  ensureSuccess(runGit(["reset", "--hard", "HEAD"], worktreeDir, timeoutMs), `failed to reset worktree ${worktreeDir}`);
  ensureSuccess(runGit(["clean", "-fd"], worktreeDir, timeoutMs), `failed to clean worktree ${worktreeDir}`);
}

function listWorktreeRegistrations(repoDir: string, timeoutMs: number): WorktreeRegistration[] {
  const result = runGit(["worktree", "list", "--porcelain"], repoDir, timeoutMs);
  ensureSuccess(result, "failed to list git worktrees");
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
  for (const line of result.stdout.split(/\r?\n/)) {
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

export function prepareTaskWorktree(repoDir: string, task: TaskInfo, options: PrepareOptions = {}): string {
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
  const commandTimeoutMs = Number.isSafeInteger(options.commandTimeoutMs) && (options.commandTimeoutMs ?? 0) > 0
    ? options.commandTimeoutMs!
    : 60_000;
  const worktreeRoot = path.join(repoDir, ".worktrees");
  const preferredWorktreeDir = path.join(worktreeRoot, requireSafeTaskDirName(taskId));
  ensureSuccess(
    runGit(["check-ref-format", "--branch", branchName], repoDir, commandTimeoutMs),
    `invalid task branch name: ${branchName}`,
  );
  fs.mkdirSync(worktreeRoot, { recursive: true });

  const registrations = listWorktreeRegistrations(repoDir, commandTimeoutMs);
  const worktreeDir = resolveCompatibleWorktreeDir(
    repoDir,
    taskId,
    branchName,
    preferredWorktreeDir,
    registrations,
  );
  const expectedPath = canonicalPath(worktreeDir);
  const branchRegistration = registrations.find((entry) => entry.branch === branchName);
  const pathRegistration = registrations.find((entry) => entry.path === expectedPath);
  if (branchRegistration && branchRegistration.path !== expectedPath) {
    throw new Error(`branch ${branchName} is already checked out at ${branchRegistration.path}`);
  }
  if (fs.existsSync(worktreeDir)) {
    if (!pathRegistration) {
      throw new Error(`existing worktree path is not registered with git: ${worktreeDir}`);
    }
    if (pathRegistration.branch !== branchName) {
      throw new Error(
        `worktree path ${worktreeDir} is registered for ${pathRegistration.branch ?? "a detached HEAD"}, not ${branchName}`,
      );
    }
    if (options.allowReuse) {
      if (options.resetOnReuse) {
        resetExistingWorktree(worktreeDir, commandTimeoutMs);
      }
      return worktreeDir;
    }
    throw new Error(`existing worktree already present for ${taskId}`);
  }
  if (pathRegistration) {
    throw new Error(`registered worktree path is missing from disk: ${worktreeDir}`);
  }

  const fetchResult = runGit(["fetch", "origin", defaultBranch], repoDir, commandTimeoutMs);
  ensureSuccess(fetchResult, `failed to fetch origin/${defaultBranch}`);

  const baseRef = resolveBaseRef(repoDir, defaultBranch, commandTimeoutMs);
  const addResult = runGit([
    "worktree",
    "add",
    worktreeDir,
    "-B",
    branchName,
    baseRef,
  ], repoDir, commandTimeoutMs);
  ensureSuccess(addResult, `failed to create worktree for ${taskId}`);
  return worktreeDir;
}

export function removeTaskWorktree(repoDir: string, taskId: string, options: RemoveOptions = {}): void {
  const normalizedTaskId = String(taskId || "").trim();
  if (!normalizedTaskId) {
    throw new Error("taskId is required");
  }
  const commandTimeoutMs = Number.isSafeInteger(options.commandTimeoutMs) && (options.commandTimeoutMs ?? 0) > 0
    ? options.commandTimeoutMs!
    : 60_000;
  requireSafeTaskDirName(normalizedTaskId);
  const registrations = listWorktreeRegistrations(repoDir, commandTimeoutMs);
  const worktreeDir = resolveRemovalWorktreeDir(repoDir, normalizedTaskId, options, registrations);
  const registration = registrations
    .find((entry) => entry.path === canonicalPath(worktreeDir));
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

  const args = ["worktree", "remove", ...(options.force ? ["--force"] : []), worktreeDir];
  ensureSuccess(
    runGit(args, repoDir, commandTimeoutMs),
    options.force
      ? `failed to force-remove worktree for ${normalizedTaskId}`
      : `failed to remove worktree for ${normalizedTaskId}; preserve dirty worktree or retry with force`,
  );
}
