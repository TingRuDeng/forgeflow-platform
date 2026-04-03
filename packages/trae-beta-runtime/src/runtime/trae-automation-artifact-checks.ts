import fs from "node:fs";
import { spawnSync } from "node:child_process";

export interface GitCommandResult {
  status: number;
  stdout: string;
  stderr: string;
}

export type GitRunner = (args: string[], cwd: string) => GitCommandResult;

export interface CheckGitOptions {
  runGit?: GitRunner;
}

export interface ArtifactTaskInput {
  worktree_dir?: string;
  execution_dir?: string;
  branch?: string;
  default_branch?: string;
  scope?: string[];
}

export interface RemoteCommitCheckResult {
  exists: boolean;
  reason: string;
}

export interface ArtifactReviewabilityEvidence {
  worktreeExists: boolean;
  branchMatches: boolean;
  hasChanges: boolean;
  allChangesInScope: boolean;
  remoteVerified: boolean;
  branchName: string | null;
  commitSha: string | null;
  filesChanged: string[];
  outOfScopeFiles: string[];
  uncommittedFiles: string[];
  remoteCheckReason?: string;
}

export interface ArtifactReviewabilityResult {
  reviewable: boolean;
  reason: string | null;
  evidence: ArtifactReviewabilityEvidence;
}

export function runGit(args: string[], cwd: string): GitCommandResult {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    timeout: 10000,
  });

  return {
    status: result.status ?? 1,
    stdout: (result.stdout || "").trim(),
    stderr: (result.stderr || "").trim(),
  };
}

export function isGitWorktree(dir: string, runGitFn: GitRunner = runGit) {
  if (!fs.existsSync(dir)) {
    return false;
  }

  const result = runGitFn(["rev-parse", "--is-inside-work-tree"], dir);
  return result.status === 0 && result.stdout === "true";
}

export function getCurrentBranch(worktreeDir: string, runGitFn: GitRunner = runGit) {
  const result = runGitFn(["branch", "--show-current"], worktreeDir);
  if (result.status !== 0) {
    return null;
  }
  return result.stdout || null;
}

export function getHeadCommit(worktreeDir: string, runGitFn: GitRunner = runGit) {
  const result = runGitFn(["rev-parse", "HEAD"], worktreeDir);
  if (result.status !== 0) {
    return null;
  }
  return result.stdout || null;
}

export function getMergeBase(worktreeDir: string, defaultBranch: string, runGitFn: GitRunner = runGit) {
  const result = runGitFn(["merge-base", `origin/${defaultBranch}`, "HEAD"], worktreeDir);
  if (result.status !== 0) {
    return null;
  }
  return result.stdout || null;
}

export function getChangedFiles(worktreeDir: string, baseRef: string, runGitFn: GitRunner = runGit) {
  const result = runGitFn(["diff", "--name-only", baseRef], worktreeDir);
  if (result.status !== 0) {
    return [];
  }
  return result.stdout ? result.stdout.split("\n").filter(Boolean) : [];
}

export function getUnstagedChanges(worktreeDir: string, runGitFn: GitRunner = runGit) {
  const result = runGitFn(["diff", "--name-only"], worktreeDir);
  if (result.status !== 0) {
    return [];
  }
  return result.stdout ? result.stdout.split("\n").filter(Boolean) : [];
}

export function getStagedChanges(worktreeDir: string, runGitFn: GitRunner = runGit) {
  const result = runGitFn(["diff", "--cached", "--name-only"], worktreeDir);
  if (result.status !== 0) {
    return [];
  }
  return result.stdout ? result.stdout.split("\n").filter(Boolean) : [];
}

export function getUntrackedFiles(worktreeDir: string, runGitFn: GitRunner = runGit) {
  const result = runGitFn(["ls-files", "--others", "--exclude-standard"], worktreeDir);
  if (result.status !== 0) {
    return [];
  }
  return result.stdout ? result.stdout.split("\n").filter(Boolean) : [];
}

export function matchesAllowedPath(filePath: string, allowedPaths: string[]) {
  for (const pattern of allowedPaths) {
    if (pattern === filePath) {
      return true;
    }
    if (pattern.endsWith("/**")) {
      const prefix = pattern.slice(0, -3);
      if (filePath.startsWith(`${prefix}/`) || filePath === prefix) {
        return true;
      }
    }
    if (pattern === filePath) {
      return true;
    }
  }

  return false;
}

export function filterFilesInScope(files: string[], allowedPaths: string[]) {
  const inScope: string[] = [];
  const outOfScope: string[] = [];

  for (const file of files) {
    if (matchesAllowedPath(file, allowedPaths)) {
      inScope.push(file);
      continue;
    }
    outOfScope.push(file);
  }

  return { inScope, outOfScope };
}

export function checkRemoteCommitExists(
  worktreeDir: string,
  branchName: string | null,
  commitSha: string | null,
  options: CheckGitOptions = {},
): RemoteCommitCheckResult {
  const runGitFn = options.runGit || runGit;
  if (!branchName || !commitSha) {
    return { exists: false, reason: "Missing branch name or commit SHA" };
  }

  const branchResult = runGitFn(["ls-remote", "--heads", "origin", branchName], worktreeDir);
  if (branchResult.status !== 0) {
    return { exists: false, reason: `Failed to check remote branch: ${branchResult.stderr}` };
  }

  if (!branchResult.stdout) {
    return { exists: false, reason: `Branch ${branchName} not found on remote` };
  }

  const fetchResult = runGitFn(["fetch", "--quiet", "origin", branchName], worktreeDir);
  if (fetchResult.status !== 0) {
    return { exists: false, reason: `Failed to fetch remote branch ${branchName}: ${fetchResult.stderr}` };
  }

  const commitResult = runGitFn(["merge-base", "--is-ancestor", commitSha, "FETCH_HEAD"], worktreeDir);
  if (commitResult.status !== 0) {
    return { exists: false, reason: `Commit ${commitSha} not pushed to remote branch ${branchName}` };
  }

  return { exists: true, reason: "Commit exists on remote" };
}

export function checkArtifactReviewability(
  task: ArtifactTaskInput,
  options: CheckGitOptions = {},
): ArtifactReviewabilityResult {
  const runGitFn = options.runGit || runGit;
  const effectiveDir = task.execution_dir || task.worktree_dir;
  const allowedPaths = Array.isArray(task.scope) ? task.scope : [];
  const defaultBranch = task.default_branch || "main";

  const result: ArtifactReviewabilityResult = {
    reviewable: false,
    reason: null,
    evidence: {
      worktreeExists: false,
      branchMatches: false,
      hasChanges: false,
      allChangesInScope: false,
      remoteVerified: false,
      branchName: null,
      commitSha: null,
      filesChanged: [],
      outOfScopeFiles: [],
      uncommittedFiles: [],
    },
  };

  if (!effectiveDir) {
    result.reason = "No execution directory specified";
    return result;
  }

  if (!isGitWorktree(effectiveDir, runGitFn)) {
    result.reason = "Execution directory is not a valid git repository";
    return result;
  }
  result.evidence.worktreeExists = true;

  const currentBranch = getCurrentBranch(effectiveDir, runGitFn);
  result.evidence.branchName = currentBranch;
  if (!currentBranch) {
    result.reason = "Could not determine current branch";
    return result;
  }

  const expectedBranch = task.branch;
  if (expectedBranch && currentBranch !== expectedBranch) {
    result.reason = `Branch mismatch: expected ${expectedBranch}, got ${currentBranch}`;
    return result;
  }
  result.evidence.branchMatches = true;

  const headCommit = getHeadCommit(effectiveDir, runGitFn);
  result.evidence.commitSha = headCommit;

  let committedChanges: string[] = [];
  const mergeBase = getMergeBase(effectiveDir, defaultBranch, runGitFn);
  if (mergeBase) {
    committedChanges = getChangedFiles(effectiveDir, mergeBase, runGitFn);
  }

  const stagedChanges = getStagedChanges(effectiveDir, runGitFn);
  const unstagedChanges = getUnstagedChanges(effectiveDir, runGitFn);
  const untrackedFiles = getUntrackedFiles(effectiveDir, runGitFn);
  const uncommittedFiles = [...new Set([
    ...stagedChanges,
    ...unstagedChanges,
    ...untrackedFiles,
  ])];
  result.evidence.uncommittedFiles = uncommittedFiles;

  if (uncommittedFiles.length > 0) {
    result.reason = `Uncommitted changes present: ${uncommittedFiles.join(", ")}`;
    return result;
  }

  committedChanges = [...new Set(committedChanges)];
  if (committedChanges.length === 0) {
    result.reason = "No changes detected in worktree";
    return result;
  }
  result.evidence.hasChanges = true;
  result.evidence.filesChanged = committedChanges;

  if (allowedPaths.length > 0) {
    const { outOfScope } = filterFilesInScope(committedChanges, allowedPaths);
    result.evidence.outOfScopeFiles = outOfScope;
    if (outOfScope.length > 0) {
      result.reason = `Out-of-scope files detected: ${outOfScope.join(", ")}`;
      return result;
    }
    result.evidence.allChangesInScope = true;
  } else {
    result.evidence.allChangesInScope = true;
  }

  const remoteCheck = checkRemoteCommitExists(effectiveDir, currentBranch, headCommit, {
    runGit: runGitFn,
  });
  result.evidence.remoteVerified = remoteCheck.exists;
  result.evidence.remoteCheckReason = remoteCheck.reason;
  if (!remoteCheck.exists) {
    result.reason = remoteCheck.reason;
    return result;
  }

  result.reviewable = true;
  result.reason = "Artifact is reviewable";
  return result;
}
