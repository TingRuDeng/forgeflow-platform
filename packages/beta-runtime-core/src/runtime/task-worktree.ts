import fs from "node:fs";
import path from "node:path";
import { execFile, spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { promisify } from "node:util";

import { createAbortError, sleepUntilAborted, throwIfAborted } from "./abort-signal.js";

const execFileAsync = promisify(execFile);

export const DEFAULT_WORKTREE_COMMAND_TIMEOUT_MS = 60_000;
export const DEFAULT_WORKTREE_LOCK_TIMEOUT_MS = 2_000;
export const DEFAULT_WORKTREE_LOCK_RETRY_MS = 25;
export const DEFAULT_WORKTREE_LOCK_STALE_MS = 30_000;

const WORKTREE_OWNER_LOCK_FILE = "forgeflow-worktree-owner.lock";

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
  lockTimeoutMs?: number;
  lockRetryMs?: number;
  lockStaleMs?: number;
  signal?: AbortSignal;
}

export interface RemoveOptions {
  force?: boolean;
  commandTimeoutMs?: number;
  lockTimeoutMs?: number;
  lockRetryMs?: number;
  lockStaleMs?: number;
  signal?: AbortSignal;
  worktreeDir?: string;
  branchName?: string;
  ownership?: TaskWorktreeOwnership;
}

export interface PreparedTaskWorktree {
  action: "created" | "reused";
  taskId: string;
  branchName: string;
  baseRef: string | null;
  worktreeDir: string;
}

export interface TaskWorktreeOwnership {
  readonly taskId: string;
  readonly branchName: string;
  readonly worktreeDir: string;
  readonly lockPath: string;
  readonly ownerToken: string;
}

export interface OwnedPreparedTaskWorktree extends PreparedTaskWorktree {
  ownership: TaskWorktreeOwnership;
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

interface WorktreeLockMetadata {
  pid: number;
  ownerToken: string;
  createdAt: string;
  taskId: string;
  branchName: string;
}

interface WorktreeLockSnapshot {
  dev: number;
  ino: number;
  mtimeMs: number;
  metadata: WorktreeLockMetadata | null;
}

interface AcquiredWorktreeLock {
  lockPath: string;
  ownerToken: string;
  snapshot: WorktreeLockSnapshot;
}

interface WorktreeOwnershipState {
  released: boolean;
  snapshot: WorktreeLockSnapshot;
}

const ownershipStates = new WeakMap<TaskWorktreeOwnership, WorktreeOwnershipState>();

export class TaskWorktreeLockTimeoutError extends Error {
  constructor(lockPath: string, timeoutMs: number) {
    super(`task worktree lock timeout after ${timeoutMs}ms: ${lockPath}`);
    this.name = "TaskWorktreeLockTimeoutError";
  }
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

function resolveRemovalBranchName(options: RemoveOptions): string | undefined {
  return options.branchName || options.ownership?.branchName;
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
    && !resolveRemovalBranchName(options)
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

function resolvePositiveInteger(value: number | undefined, fallback: number): number {
  return Number.isSafeInteger(value) && (value ?? 0) > 0 ? value as number : fallback;
}

function resolveWorktreeLockOptions(options: PrepareOptions | RemoveOptions) {
  return {
    timeoutMs: resolvePositiveInteger(options.lockTimeoutMs, DEFAULT_WORKTREE_LOCK_TIMEOUT_MS),
    retryMs: resolvePositiveInteger(options.lockRetryMs, DEFAULT_WORKTREE_LOCK_RETRY_MS),
    staleMs: resolvePositiveInteger(options.lockStaleMs, DEFAULT_WORKTREE_LOCK_STALE_MS),
  };
}

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function readWorktreeLockSnapshot(lockPath: string): WorktreeLockSnapshot | null {
  try {
    const stats = fs.statSync(lockPath);
    let metadata: WorktreeLockMetadata | null = null;
    try {
      const parsed = JSON.parse(fs.readFileSync(lockPath, "utf8")) as Partial<WorktreeLockMetadata>;
      if (
        Number.isInteger(parsed.pid)
        && Number(parsed.pid) > 0
        && typeof parsed.ownerToken === "string"
        && parsed.ownerToken.length > 0
        && typeof parsed.createdAt === "string"
        && typeof parsed.taskId === "string"
        && typeof parsed.branchName === "string"
      ) {
        metadata = {
          pid: Number(parsed.pid),
          ownerToken: parsed.ownerToken,
          createdAt: parsed.createdAt,
          taskId: parsed.taskId,
          branchName: parsed.branchName,
        };
      }
    } catch {
      metadata = null;
    }
    return {
      dev: stats.dev,
      ino: stats.ino,
      mtimeMs: stats.mtimeMs,
      metadata,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function unlinkMatchingWorktreeLock(
  lockPath: string,
  expected: WorktreeLockSnapshot,
  requireOwnerToken: boolean,
): boolean {
  const current = readWorktreeLockSnapshot(lockPath);
  if (
    !current
    || current.dev !== expected.dev
    || current.ino !== expected.ino
    || (
      requireOwnerToken
      && current.metadata?.ownerToken !== expected.metadata?.ownerToken
    )
  ) {
    return false;
  }
  fs.unlinkSync(lockPath);
  return true;
}

function tryReclaimStaleWorktreeLock(lockPath: string, staleMs: number): boolean {
  const snapshot = readWorktreeLockSnapshot(lockPath);
  if (!snapshot) {
    return true;
  }
  const createdAtMs = snapshot.metadata ? Date.parse(snapshot.metadata.createdAt) : Number.NaN;
  const ageMs = Date.now() - (Number.isNaN(createdAtMs) ? snapshot.mtimeMs : createdAtMs);
  if (ageMs < staleMs) {
    return false;
  }
  if (snapshot.metadata && isProcessAlive(snapshot.metadata.pid)) {
    return false;
  }
  return unlinkMatchingWorktreeLock(lockPath, snapshot, Boolean(snapshot.metadata));
}

function resolveGitCommonDir(repoDir: string, options: PrepareOptions | RemoveOptions): string {
  const result = runGit(["rev-parse", "--git-common-dir"], repoDir, options);
  ensureSuccess(result, `failed to resolve git common directory for ${repoDir}`);
  return canonicalPath(path.isAbsolute(result.stdout) ? result.stdout : path.resolve(repoDir, result.stdout));
}

async function resolveGitCommonDirAsync(
  repoDir: string,
  options: PrepareOptions | RemoveOptions,
): Promise<string> {
  const result = await runGitAsync(["rev-parse", "--git-common-dir"], repoDir, options);
  ensureSuccess(result, `failed to resolve git common directory for ${repoDir}`);
  return canonicalPath(path.isAbsolute(result.stdout) ? result.stdout : path.resolve(repoDir, result.stdout));
}

function createWorktreeLockMetadata(normalized: NormalizedTaskWorktree): WorktreeLockMetadata {
  return {
    pid: process.pid,
    ownerToken: randomUUID(),
    createdAt: new Date().toISOString(),
    taskId: normalized.taskId,
    branchName: normalized.branchName,
  };
}

function tryCreateWorktreeLock(
  lockPath: string,
  metadata: WorktreeLockMetadata,
): AcquiredWorktreeLock | null {
  let fd: number | null = null;
  let createdSnapshot: WorktreeLockSnapshot | null = null;
  try {
    fd = fs.openSync(lockPath, "wx");
    const stats = fs.fstatSync(fd);
    createdSnapshot = {
      dev: stats.dev,
      ino: stats.ino,
      mtimeMs: stats.mtimeMs,
      metadata,
    };
    fs.writeFileSync(fd, JSON.stringify(metadata), "utf8");
    fs.closeSync(fd);
    fd = null;
    return {
      lockPath,
      ownerToken: metadata.ownerToken,
      snapshot: createdSnapshot,
    };
  } catch (error) {
    if (fd !== null) {
      fs.closeSync(fd);
    }
    if (createdSnapshot) {
      try {
        unlinkMatchingWorktreeLock(lockPath, createdSnapshot, false);
      } catch {
        // Preserve the acquisition error.
      }
    }
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      return null;
    }
    throw error;
  }
}

function acquireWorktreeLock(
  repoDir: string,
  normalized: NormalizedTaskWorktree,
  options: PrepareOptions | RemoveOptions,
): AcquiredWorktreeLock {
  const lockPath = path.join(resolveGitCommonDir(repoDir, options), WORKTREE_OWNER_LOCK_FILE);
  const lockOptions = resolveWorktreeLockOptions(options);
  const startedAt = Date.now();

  while (true) {
    throwIfAborted(options.signal, `task worktree lock acquisition aborted: ${lockPath}`);
    const acquired = tryCreateWorktreeLock(lockPath, createWorktreeLockMetadata(normalized));
    if (acquired) {
      return acquired;
    }
    if (readWorktreeLockSnapshot(lockPath)?.metadata?.pid === process.pid) {
      throw new TaskWorktreeLockTimeoutError(lockPath, 0);
    }
    if (tryReclaimStaleWorktreeLock(lockPath, lockOptions.staleMs)) {
      continue;
    }
    if (Date.now() - startedAt >= lockOptions.timeoutMs) {
      throw new TaskWorktreeLockTimeoutError(lockPath, lockOptions.timeoutMs);
    }
    sleepSync(lockOptions.retryMs);
  }
}

async function acquireWorktreeLockAsync(
  repoDir: string,
  normalized: NormalizedTaskWorktree,
  options: PrepareOptions | RemoveOptions,
): Promise<AcquiredWorktreeLock> {
  const lockPath = path.join(await resolveGitCommonDirAsync(repoDir, options), WORKTREE_OWNER_LOCK_FILE);
  const lockOptions = resolveWorktreeLockOptions(options);
  const startedAt = Date.now();

  while (true) {
    throwIfAborted(options.signal, `task worktree lock acquisition aborted: ${lockPath}`);
    const acquired = tryCreateWorktreeLock(lockPath, createWorktreeLockMetadata(normalized));
    if (acquired) {
      return acquired;
    }
    if (tryReclaimStaleWorktreeLock(lockPath, lockOptions.staleMs)) {
      continue;
    }
    if (Date.now() - startedAt >= lockOptions.timeoutMs) {
      throw new TaskWorktreeLockTimeoutError(lockPath, lockOptions.timeoutMs);
    }
    await sleepUntilAborted(
      lockOptions.retryMs,
      options.signal,
      `task worktree lock acquisition aborted: ${lockPath}`,
    );
  }
}

function releaseAcquiredWorktreeLock(lock: AcquiredWorktreeLock): void {
  if (!unlinkMatchingWorktreeLock(lock.lockPath, lock.snapshot, true)) {
    throw new Error(`task worktree lock ownership changed before release: ${lock.lockPath}`);
  }
}

function releaseAcquiredWorktreeLockAfterFailure(lock: AcquiredWorktreeLock): void {
  try {
    releaseAcquiredWorktreeLock(lock);
  } catch {
    // Preserve the worktree operation error.
  }
}

function createTaskWorktreeOwnership(
  lock: AcquiredWorktreeLock,
  prepared: PreparedTaskWorktree,
): TaskWorktreeOwnership {
  const ownership: TaskWorktreeOwnership = Object.freeze({
    taskId: prepared.taskId,
    branchName: prepared.branchName,
    worktreeDir: prepared.worktreeDir,
    lockPath: lock.lockPath,
    ownerToken: lock.ownerToken,
  });
  ownershipStates.set(ownership, { released: false, snapshot: lock.snapshot });
  return ownership;
}

function assertActiveTaskWorktreeOwnership(
  ownership: TaskWorktreeOwnership,
  expectedLockPath: string,
  taskId: string,
  branchName: string | undefined,
): void {
  const state = ownershipStates.get(ownership);
  if (!state || state.released) {
    throw new Error(`task worktree ownership is not active for ${taskId}`);
  }
  if (
    ownership.lockPath !== expectedLockPath
    || ownership.taskId !== taskId
    || (branchName && ownership.branchName !== branchName)
  ) {
    throw new Error(`task worktree ownership does not match ${taskId}`);
  }
  const current = readWorktreeLockSnapshot(expectedLockPath);
  if (
    !current
    || current.dev !== state.snapshot.dev
    || current.ino !== state.snapshot.ino
    || current.metadata?.ownerToken !== ownership.ownerToken
  ) {
    throw new Error(`task worktree lock ownership changed before operation: ${expectedLockPath}`);
  }
}

export function releaseTaskWorktreeOwnership(ownership: TaskWorktreeOwnership): void {
  const state = ownershipStates.get(ownership);
  if (!state) {
    throw new Error("unknown task worktree ownership");
  }
  if (state.released) {
    return;
  }
  if (!unlinkMatchingWorktreeLock(ownership.lockPath, state.snapshot, true)) {
    throw new Error(`task worktree lock ownership changed before release: ${ownership.lockPath}`);
  }
  state.released = true;
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

function prepareTaskWorktreeUnlocked(
  repoDir: string,
  normalized: NormalizedTaskWorktree,
  options: PrepareOptions,
): PreparedTaskWorktree {
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
    return {
      action,
      taskId: normalized.taskId,
      branchName: normalized.branchName,
      baseRef: null,
      worktreeDir: effectiveNormalized.worktreeDir,
    };
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
  return {
    action: "created",
    taskId: normalized.taskId,
    branchName: normalized.branchName,
    baseRef,
    worktreeDir: effectiveNormalized.worktreeDir,
  };
}

async function prepareTaskWorktreeUnlockedAsync(
  repoDir: string,
  normalized: NormalizedTaskWorktree,
  options: PrepareOptions,
): Promise<PreparedTaskWorktree> {
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

export function prepareTaskWorktreeWithOwnership(
  repoDir: string,
  task: TaskWorktreeInfo,
  options: PrepareOptions = {},
): OwnedPreparedTaskWorktree {
  const normalized = normalizeTaskWorktree(repoDir, task);
  ensureSuccess(
    runGit(["check-ref-format", "--branch", normalized.branchName], repoDir, options),
    `invalid task branch name: ${normalized.branchName}`,
  );
  const lock = acquireWorktreeLock(repoDir, normalized, options);
  try {
    const prepared = prepareTaskWorktreeUnlocked(repoDir, normalized, options);
    return {
      ...prepared,
      ownership: createTaskWorktreeOwnership(lock, prepared),
    };
  } catch (error) {
    releaseAcquiredWorktreeLockAfterFailure(lock);
    throw error;
  }
}

export async function prepareTaskWorktreeLifecycleWithOwnership(
  repoDir: string,
  task: TaskWorktreeInfo,
  options: PrepareOptions = {},
): Promise<OwnedPreparedTaskWorktree> {
  const normalized = normalizeTaskWorktree(repoDir, task);
  ensureSuccess(
    await runGitAsync(["check-ref-format", "--branch", normalized.branchName], repoDir, options),
    `invalid task branch name: ${normalized.branchName}`,
  );
  const lock = await acquireWorktreeLockAsync(repoDir, normalized, options);
  try {
    const prepared = await prepareTaskWorktreeUnlockedAsync(repoDir, normalized, options);
    return {
      ...prepared,
      ownership: createTaskWorktreeOwnership(lock, prepared),
    };
  } catch (error) {
    releaseAcquiredWorktreeLockAfterFailure(lock);
    throw error;
  }
}

export function prepareTaskWorktree(repoDir: string, task: TaskWorktreeInfo, options: PrepareOptions = {}): string {
  const prepared = prepareTaskWorktreeWithOwnership(repoDir, task, options);
  try {
    return prepared.worktreeDir;
  } finally {
    releaseTaskWorktreeOwnership(prepared.ownership);
  }
}

export async function prepareTaskWorktreeLifecycle(
  repoDir: string,
  task: TaskWorktreeInfo,
  options: PrepareOptions = {},
): Promise<PreparedTaskWorktree> {
  const prepared = await prepareTaskWorktreeLifecycleWithOwnership(repoDir, task, options);
  try {
    const { ownership: _ownership, ...result } = prepared;
    return result;
  } finally {
    releaseTaskWorktreeOwnership(prepared.ownership);
  }
}

function normalizeRemovalWorktree(
  repoDir: string,
  taskId: unknown,
  options: RemoveOptions,
): NormalizedTaskWorktree {
  const normalizedTaskId = String(taskId || "").trim();
  if (!normalizedTaskId) {
    throw new Error("taskId is required");
  }
  const directoryName = requireSafeTaskDirName(normalizedTaskId);
  return {
    taskId: normalizedTaskId,
    branchName: String(options.branchName || ""),
    defaultBranch: "",
    worktreeDir: options.worktreeDir
      ? path.resolve(options.worktreeDir)
      : path.join(repoDir, ".worktrees", directoryName),
  };
}

function removeTaskWorktreeUnlocked(
  repoDir: string,
  normalizedTaskId: string,
  options: RemoveOptions,
): RemovedTaskWorktree {
  const listResult = runGit(["worktree", "list", "--porcelain"], repoDir, options);
  ensureSuccess(listResult, "failed to list git worktrees");
  const registrations = parseWorktreeRegistrations(listResult.stdout);
  const worktreeDir = resolveRemovalWorktreeDir(repoDir, normalizedTaskId, options, registrations);
  assertOwnedWorktreePath(options.ownership, worktreeDir);
  const registration = registrations.find((entry) => entry.path === canonicalPath(worktreeDir));
  if (!registration && !fs.existsSync(worktreeDir)) {
    return { action: "absent", taskId: normalizedTaskId, worktreeDir };
  }
  if (!registration) {
    throw new Error(`refusing to remove unregistered worktree path: ${worktreeDir}`);
  }
  if (!fs.existsSync(worktreeDir)) {
    throw new Error(`registered worktree path is missing from disk: ${worktreeDir}`);
  }
  const expectedBranchName = resolveRemovalBranchName(options);
  if (expectedBranchName && registration.branch !== expectedBranchName) {
    throw new Error(`refusing to remove worktree not registered for ${expectedBranchName}: ${worktreeDir}`);
  }
  const force = options.force ?? false;
  const args = ["worktree", "remove", ...(force ? ["--force"] : []), worktreeDir];
  ensureSuccess(
    runGit(args, repoDir, options),
    force
      ? `failed to force-remove worktree for ${normalizedTaskId}`
      : `failed to remove worktree for ${normalizedTaskId}; preserve dirty worktree or retry with force`,
  );
  return { action: "removed", taskId: normalizedTaskId, worktreeDir };
}

async function removeTaskWorktreeUnlockedAsync(
  repoDir: string,
  normalizedTaskId: string,
  options: RemoveOptions,
): Promise<RemovedTaskWorktree> {
  const listResult = await runGitAsync(["worktree", "list", "--porcelain"], repoDir, options);
  ensureSuccess(listResult, "failed to list git worktrees");
  const registrations = parseWorktreeRegistrations(listResult.stdout);
  const worktreeDir = resolveRemovalWorktreeDir(repoDir, normalizedTaskId, options, registrations);
  assertOwnedWorktreePath(options.ownership, worktreeDir);
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
  const expectedBranchName = resolveRemovalBranchName(options);
  if (expectedBranchName && registration.branch !== expectedBranchName) {
    throw new Error(`refusing to remove worktree not registered for ${expectedBranchName}: ${worktreeDir}`);
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

function assertOwnedWorktreePath(
  ownership: TaskWorktreeOwnership | undefined,
  worktreeDir: string,
): void {
  if (ownership && canonicalPath(ownership.worktreeDir) !== canonicalPath(worktreeDir)) {
    throw new Error(`task worktree ownership does not match worktree path: ${worktreeDir}`);
  }
}

function assertRemovalOwnership(
  repoDir: string,
  normalized: NormalizedTaskWorktree,
  options: RemoveOptions,
): void {
  if (!options.ownership) {
    return;
  }
  const expectedLockPath = path.join(resolveGitCommonDir(repoDir, options), WORKTREE_OWNER_LOCK_FILE);
  assertActiveTaskWorktreeOwnership(
    options.ownership,
    expectedLockPath,
    normalized.taskId,
    resolveRemovalBranchName(options),
  );
}

async function assertRemovalOwnershipAsync(
  repoDir: string,
  normalized: NormalizedTaskWorktree,
  options: RemoveOptions,
): Promise<void> {
  if (!options.ownership) {
    return;
  }
  const expectedLockPath = path.join(await resolveGitCommonDirAsync(repoDir, options), WORKTREE_OWNER_LOCK_FILE);
  assertActiveTaskWorktreeOwnership(
    options.ownership,
    expectedLockPath,
    normalized.taskId,
    resolveRemovalBranchName(options),
  );
}

export function removeTaskWorktree(repoDir: string, taskId: unknown, options: RemoveOptions = {}): void {
  const normalized = normalizeRemovalWorktree(repoDir, taskId, options);
  if (options.ownership) {
    assertRemovalOwnership(repoDir, normalized, options);
    removeTaskWorktreeUnlocked(repoDir, normalized.taskId, options);
    return;
  }

  const lock = acquireWorktreeLock(repoDir, normalized, options);
  try {
    removeTaskWorktreeUnlocked(repoDir, normalized.taskId, options);
    releaseAcquiredWorktreeLock(lock);
  } catch (error) {
    releaseAcquiredWorktreeLockAfterFailure(lock);
    throw error;
  }
}

export async function removeTaskWorktreeLifecycle(
  repoDir: string,
  taskId: unknown,
  options: RemoveOptions = {},
): Promise<RemovedTaskWorktree> {
  const normalized = normalizeRemovalWorktree(repoDir, taskId, options);
  if (options.ownership) {
    await assertRemovalOwnershipAsync(repoDir, normalized, options);
    return removeTaskWorktreeUnlockedAsync(repoDir, normalized.taskId, options);
  }

  const lock = await acquireWorktreeLockAsync(repoDir, normalized, options);
  try {
    const removed = await removeTaskWorktreeUnlockedAsync(repoDir, normalized.taskId, options);
    releaseAcquiredWorktreeLock(lock);
    return removed;
  } catch (error) {
    releaseAcquiredWorktreeLockAfterFailure(lock);
    throw error;
  }
}
