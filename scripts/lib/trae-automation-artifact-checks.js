import fs from "node:fs";
import { spawnSync } from "node:child_process";
function runGit(args, cwd) {
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
function isGitWorktree(dir, runGitFn = runGit) {
    if (!fs.existsSync(dir)) {
        return false;
    }
    const result = runGitFn(["rev-parse", "--is-inside-work-tree"], dir);
    return result.status === 0 && result.stdout === "true";
}
function getCurrentBranch(worktreeDir, runGitFn = runGit) {
    const result = runGitFn(["branch", "--show-current"], worktreeDir);
    if (result.status !== 0) {
        return null;
    }
    return result.stdout || null;
}
function getHeadCommit(worktreeDir, runGitFn = runGit) {
    const result = runGitFn(["rev-parse", "HEAD"], worktreeDir);
    if (result.status !== 0) {
        return null;
    }
    return result.stdout || null;
}
function getMergeBase(worktreeDir, defaultBranch, runGitFn = runGit) {
    const result = runGitFn(["merge-base", `origin/${defaultBranch}`, "HEAD"], worktreeDir);
    if (result.status !== 0) {
        return null;
    }
    return result.stdout || null;
}
function getChangedFiles(worktreeDir, baseRef, runGitFn = runGit) {
    const result = runGitFn(["diff", "--name-only", baseRef], worktreeDir);
    if (result.status !== 0) {
        return [];
    }
    return result.stdout ? result.stdout.split("\n").filter(Boolean) : [];
}
function getUnstagedChanges(worktreeDir, runGitFn = runGit) {
    const result = runGitFn(["diff", "--name-only"], worktreeDir);
    if (result.status !== 0) {
        return [];
    }
    return result.stdout ? result.stdout.split("\n").filter(Boolean) : [];
}
function getStagedChanges(worktreeDir, runGitFn = runGit) {
    const result = runGitFn(["diff", "--cached", "--name-only"], worktreeDir);
    if (result.status !== 0) {
        return [];
    }
    return result.stdout ? result.stdout.split("\n").filter(Boolean) : [];
}
function getUntrackedFiles(worktreeDir, runGitFn = runGit) {
    const result = runGitFn(["ls-files", "--others", "--exclude-standard"], worktreeDir);
    if (result.status !== 0) {
        return [];
    }
    return result.stdout ? result.stdout.split("\n").filter(Boolean) : [];
}
function matchesAllowedPath(filePath, allowedPaths) {
    for (const pattern of allowedPaths) {
        if (pattern === filePath) {
            return true;
        }
        if (pattern.endsWith("/**")) {
            const prefix = pattern.slice(0, -3);
            if (filePath.startsWith(prefix + "/") || filePath === prefix) {
                return true;
            }
        }
        if (pattern === filePath) {
            return true;
        }
    }
    return false;
}
function filterFilesInScope(files, allowedPaths) {
    const inScope = [];
    const outOfScope = [];
    for (const file of files) {
        if (matchesAllowedPath(file, allowedPaths)) {
            inScope.push(file);
        }
        else {
            outOfScope.push(file);
        }
    }
    return { inScope, outOfScope };
}
export function checkRemoteCommitExists(worktreeDir, branchName, commitSha, options = {}) {
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
export function checkArtifactReviewability(task, options = {}) {
    const runGitFn = options.runGit || runGit;
    const worktreeDir = task.worktree_dir || "";
    const allowedPaths = Array.isArray(task.scope) ? task.scope : [];
    const defaultBranch = task.default_branch || "main";
    const result = {
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
    if (!worktreeDir) {
        result.reason = "No worktree directory specified";
        return result;
    }
    if (!isGitWorktree(worktreeDir, runGitFn)) {
        result.reason = "Worktree is not a valid git repository";
        return result;
    }
    result.evidence.worktreeExists = true;
    const currentBranch = getCurrentBranch(worktreeDir, runGitFn);
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
    const headCommit = getHeadCommit(worktreeDir, runGitFn);
    result.evidence.commitSha = headCommit;
    let committedChanges = [];
    const mergeBase = getMergeBase(worktreeDir, defaultBranch, runGitFn);
    if (mergeBase) {
        committedChanges = getChangedFiles(worktreeDir, mergeBase, runGitFn);
    }
    const stagedChanges = getStagedChanges(worktreeDir, runGitFn);
    const unstagedChanges = getUnstagedChanges(worktreeDir, runGitFn);
    const untrackedFiles = getUntrackedFiles(worktreeDir, runGitFn);
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
    }
    else {
        result.evidence.allChangesInScope = true;
    }
    const remoteCheck = checkRemoteCommitExists(worktreeDir, currentBranch, headCommit || "", {
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
