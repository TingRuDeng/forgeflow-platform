import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

type GitResult = {
  status: number;
  stdout?: string;
  stderr?: string;
};

function createRunGitMock(results: Record<string, GitResult>) {
  return vi.fn((args: string[]) => {
    const key = args.join(" ");
    const result = results[key];
    if (!result) {
      throw new Error(`Unexpected git command: ${key}`);
    }
    return {
      status: result.status,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
    };
  });
}

describe("runtime/trae-automation-artifact-checks", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  function createWorktreeDir() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "forgeflow-artifact-checks-"));
    tempDirs.push(dir);
    return dir;
  }

  it("blocks reviewability when uncommitted changes are present", async () => {
    const { checkArtifactReviewability } = await import("../src/runtime/trae-automation-artifact-checks.js");
    const worktreeDir = createWorktreeDir();
    const runGit = createRunGitMock({
      "rev-parse --is-inside-work-tree": { status: 0, stdout: "true" },
      "branch --show-current": { status: 0, stdout: "feature/runtime" },
      "rev-parse HEAD": { status: 0, stdout: "abc123" },
      "merge-base origin/main HEAD": { status: 0, stdout: "base123" },
      "diff --name-only base123": { status: 0, stdout: "src/runtime/worker.ts" },
      "diff --cached --name-only": { status: 0, stdout: "" },
      "diff --name-only": { status: 0, stdout: "src/runtime/worker.ts" },
      "ls-files --others --exclude-standard": { status: 0, stdout: "notes.txt" },
    });

    const result = checkArtifactReviewability({
      worktree_dir: worktreeDir,
      branch: "feature/runtime",
      default_branch: "main",
      scope: ["src/runtime/**"],
    }, { runGit });

    expect(result.reviewable).toBe(false);
    expect(result.reason).toContain("Uncommitted changes present");
    expect(result.evidence.branchName).toBe("feature/runtime");
    expect(result.evidence.commitSha).toBe("abc123");
    expect(result.evidence.uncommittedFiles).toEqual(["src/runtime/worker.ts", "notes.txt"]);
    expect(result.evidence.remoteVerified).toBe(false);
    expect(runGit).not.toHaveBeenCalledWith(["ls-remote", "--heads", "origin", "feature/runtime"], worktreeDir);
  });

  it("blocks reviewability when remote commit verification fails", async () => {
    const { checkArtifactReviewability } = await import("../src/runtime/trae-automation-artifact-checks.js");
    const worktreeDir = createWorktreeDir();
    const runGit = createRunGitMock({
      "rev-parse --is-inside-work-tree": { status: 0, stdout: "true" },
      "branch --show-current": { status: 0, stdout: "feature/runtime" },
      "rev-parse HEAD": { status: 0, stdout: "abc123" },
      "merge-base origin/main HEAD": { status: 0, stdout: "base123" },
      "diff --name-only base123": { status: 0, stdout: "src/runtime/worker.ts" },
      "diff --cached --name-only": { status: 0, stdout: "" },
      "diff --name-only": { status: 0, stdout: "" },
      "ls-files --others --exclude-standard": { status: 0, stdout: "" },
      "ls-remote --heads origin feature/runtime": { status: 0, stdout: "abc123\trefs/heads/feature/runtime" },
      "fetch --quiet origin feature/runtime": { status: 0, stdout: "" },
      "merge-base --is-ancestor abc123 FETCH_HEAD": { status: 1, stderr: "" },
    });

    const result = checkArtifactReviewability({
      worktree_dir: worktreeDir,
      branch: "feature/runtime",
      default_branch: "main",
      scope: ["src/runtime/**"],
    }, { runGit });

    expect(result.reviewable).toBe(false);
    expect(result.reason).toContain("Commit abc123 not pushed to remote branch feature/runtime");
    expect(result.evidence.filesChanged).toEqual(["src/runtime/worker.ts"]);
    expect(result.evidence.outOfScopeFiles).toEqual([]);
    expect(result.evidence.uncommittedFiles).toEqual([]);
    expect(result.evidence.remoteVerified).toBe(false);
  });

  it("blocks reviewability when changed files are outside scope", async () => {
    const { checkArtifactReviewability } = await import("../src/runtime/trae-automation-artifact-checks.js");
    const worktreeDir = createWorktreeDir();
    const runGit = createRunGitMock({
      "rev-parse --is-inside-work-tree": { status: 0, stdout: "true" },
      "branch --show-current": { status: 0, stdout: "feature/runtime" },
      "rev-parse HEAD": { status: 0, stdout: "abc123" },
      "merge-base origin/main HEAD": { status: 0, stdout: "base123" },
      "diff --name-only base123": { status: 0, stdout: "src/runtime/worker.ts\nREADME.md" },
      "diff --cached --name-only": { status: 0, stdout: "" },
      "diff --name-only": { status: 0, stdout: "" },
      "ls-files --others --exclude-standard": { status: 0, stdout: "" },
    });

    const result = checkArtifactReviewability({
      worktree_dir: worktreeDir,
      branch: "feature/runtime",
      default_branch: "main",
      scope: ["src/runtime/**"],
    }, { runGit });

    expect(result.reviewable).toBe(false);
    expect(result.reason).toContain("Out-of-scope files detected: README.md");
    expect(result.evidence.filesChanged).toEqual(["src/runtime/worker.ts", "README.md"]);
    expect(result.evidence.outOfScopeFiles).toEqual(["README.md"]);
    expect(result.evidence.remoteVerified).toBe(false);
    expect(runGit).not.toHaveBeenCalledWith(["ls-remote", "--heads", "origin", "feature/runtime"], worktreeDir);
  });

  it("marks an artifact reviewable when branch, scope, cleanliness, and remote checks all pass", async () => {
    const { checkArtifactReviewability } = await import("../src/runtime/trae-automation-artifact-checks.js");
    const worktreeDir = createWorktreeDir();
    const runGit = createRunGitMock({
      "rev-parse --is-inside-work-tree": { status: 0, stdout: "true" },
      "branch --show-current": { status: 0, stdout: "feature/runtime" },
      "rev-parse HEAD": { status: 0, stdout: "abc123" },
      "merge-base origin/main HEAD": { status: 0, stdout: "base123" },
      "diff --name-only base123": { status: 0, stdout: "src/runtime/worker.ts\nsrc/runtime/clients.ts" },
      "diff --cached --name-only": { status: 0, stdout: "" },
      "diff --name-only": { status: 0, stdout: "" },
      "ls-files --others --exclude-standard": { status: 0, stdout: "" },
      "ls-remote --heads origin feature/runtime": { status: 0, stdout: "abc123\trefs/heads/feature/runtime" },
      "fetch --quiet origin feature/runtime": { status: 0, stdout: "" },
      "merge-base --is-ancestor abc123 FETCH_HEAD": { status: 0, stdout: "" },
    });

    const result = checkArtifactReviewability({
      worktree_dir: worktreeDir,
      branch: "feature/runtime",
      default_branch: "main",
      scope: ["src/runtime/**"],
    }, { runGit });

    expect(result).toEqual({
      reviewable: true,
      reason: "Artifact is reviewable",
      evidence: expect.objectContaining({
        worktreeExists: true,
        branchMatches: true,
        hasChanges: true,
        allChangesInScope: true,
        remoteVerified: true,
        branchName: "feature/runtime",
        commitSha: "abc123",
        filesChanged: ["src/runtime/worker.ts", "src/runtime/clients.ts"],
        outOfScopeFiles: [],
        uncommittedFiles: [],
      }),
    });
  });
});
