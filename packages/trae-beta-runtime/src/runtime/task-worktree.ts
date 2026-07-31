import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";

const DEFAULT_GIT_TIMEOUT_MS = 60_000;

interface WorktreeRegistration {
  path: string;
  branch: string | null;
}

function ensureSuccess(result: ReturnType<typeof spawnSync>, message: string) {
  if ((result.status ?? 1) !== 0) {
    const details = String(result.stderr || result.stdout || result.error?.message || "").trim();
    throw new Error(details ? `${message}: ${details}` : message);
  }
}

function legacySafeTaskDirName(taskId: string) {
  const rawTaskId = String(taskId || "").trim();
  return rawTaskId
    .replace(/[^\p{L}\p{N}._-]+/gu, "-")
    .replace(/^-+|-+$/g, "");
}

export function safeTaskDirName(taskId: string) {
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
) {
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

function runGit(args: string[], cwd: string, timeoutMs = DEFAULT_GIT_TIMEOUT_MS) {
  return spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    timeout: timeoutMs,
  });
}

function listWorktreeRegistrations(repoDir: string, timeoutMs: number): WorktreeRegistration[] {
  const result = runGit(["worktree", "list", "--porcelain"], repoDir, timeoutMs);
  ensureSuccess(result, "failed to list git worktrees");
  const stdout = String(result.stdout || "");
  if (!stdout.trim()) {
    return [];
  }

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
      continue;
    }

    if (line.startsWith("worktree ")) {
      currentPath = line.slice("worktree ".length).trim();
      continue;
    }

    if (line.startsWith("branch refs/heads/")) {
      currentBranch = line.slice("branch refs/heads/".length).trim();
      continue;
    }
  }
  flush();
  return registrations;
}

function resolveBaseRef(repoDir: string, defaultBranch: string, timeoutMs: number) {
  const originRef = `origin/${defaultBranch}`;
  const originCheck = runGit(["rev-parse", "--verify", originRef], repoDir, timeoutMs);
  if ((originCheck.status ?? 1) === 0) {
    return originRef;
  }
  throw new Error(`default branch ref ${originRef} is unavailable after fetch`);
}

export interface PrepareTaskWorktreeOptions {
  allowReuse?: boolean;
  commandTimeoutMs?: number;
}

export interface TaskWorktreeInput {
  taskId?: string;
  task_id?: string;
  branchName?: string;
  branch?: string;
  defaultBranch?: string;
  default_branch?: string;
}

export function prepareTaskWorktree(
  repoDir: string,
  task: TaskWorktreeInput,
  options: PrepareTaskWorktreeOptions = {},
) {
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
    : DEFAULT_GIT_TIMEOUT_MS;
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
  const addResult = runGit(
    [
      "worktree",
      "add",
      worktreeDir,
      "-B",
      branchName,
      baseRef,
    ],
    repoDir,
    commandTimeoutMs,
  );
  ensureSuccess(addResult, `failed to create worktree for ${taskId}`);
  return worktreeDir;
}
