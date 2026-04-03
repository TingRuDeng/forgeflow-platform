import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

interface GitResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

interface TaskInfo {
  taskId?: string;
  task_id?: string;
  branchName?: string;
  branch?: string;
  defaultBranch?: string;
  default_branch?: string;
}

interface PrepareOptions {
  allowReuse?: boolean;
}

function ensureSuccess(result: GitResult, message: string): void {
  if ((result.status ?? 1) !== 0) {
    const details = String(result.stderr || result.stdout || "").trim();
    throw new Error(details ? `${message}: ${details}` : message);
  }
}

export function safeTaskDirName(taskId: unknown): string {
  return String(taskId || "")
    .replace(/[^\p{L}\p{N}._-]+/gu, "-")
    .replace(/^-+|-+$/g, "");
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

function resolveBaseRef(repoDir: string, defaultBranch: string): string {
  const originRef = `origin/${defaultBranch}`;
  const originCheck = runGit(["rev-parse", "--verify", originRef], repoDir);
  if ((originCheck.status ?? 1) === 0) {
    return originRef;
  }
  throw new Error(`default branch ref ${originRef} is unavailable after fetch`);
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
  const worktreeRoot = path.join(repoDir, ".worktrees");
  const worktreeDir = path.join(worktreeRoot, safeTaskDirName(taskId));
  fs.mkdirSync(worktreeRoot, { recursive: true });

  if (fs.existsSync(worktreeDir)) {
    if (options.allowReuse) {
      return worktreeDir;
    }
    throw new Error(`existing worktree already present for ${taskId}`);
  }

  const fetchResult = runGit(["fetch", "origin", defaultBranch], repoDir);
  ensureSuccess(fetchResult, `failed to fetch origin/${defaultBranch}`);

  const baseRef = resolveBaseRef(repoDir, defaultBranch);
  const addResult = runGit([
    "worktree",
    "add",
    worktreeDir,
    "-B",
    branchName,
    baseRef,
  ], repoDir);
  ensureSuccess(addResult, `failed to create worktree for ${taskId}`);
  return worktreeDir;
}
