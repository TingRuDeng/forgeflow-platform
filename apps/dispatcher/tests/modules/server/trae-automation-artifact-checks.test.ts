import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "../../../../../",
);
const artifactChecksModulePath = path.join(repoRoot, "scripts/lib/trae-automation-artifact-checks.js");

type GitResult = {
  status: number;
  stdout?: string;
  stderr?: string;
};

function createRunGitMock(
  responses: Record<string, GitResult | ((cwd: string) => GitResult)>,
) {
  return (args: string[], cwd: string) => {
    const key = args.join("\u0000");
    const response = responses[key];
    if (!response) {
      throw new Error(`Unexpected git command: ${args.join(" ")} @ ${cwd}`);
    }
    const result = typeof response === "function" ? response(cwd) : response;
    return {
      status: result.status,
      stdout: result.stdout || "",
      stderr: result.stderr || "",
    };
  };
}

function reviewableGitResponses(overrides: Record<string, GitResult> = {}) {
  return {
    "rev-parse\u0000--is-inside-work-tree": { status: 0, stdout: "true" },
    "branch\u0000--show-current": { status: 0, stdout: "ai/trae/task-1" },
    "rev-parse\u0000HEAD": { status: 0, stdout: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
    "merge-base\u0000origin/main\u0000HEAD": {
      status: 0,
      stdout: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    },
    "diff\u0000--name-only\u0000bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb": {
      status: 0,
      stdout: "src/test.js",
    },
    "diff\u0000--cached\u0000--name-only": { status: 0, stdout: "" },
    "diff\u0000--name-only": { status: 0, stdout: "" },
    "ls-files\u0000--others\u0000--exclude-standard": { status: 0, stdout: "" },
    "ls-remote\u0000--heads\u0000origin\u0000ai/trae/task-1": {
      status: 0,
      stdout: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\trefs/heads/ai/trae/task-1",
    },
    "fetch\u0000--quiet\u0000origin\u0000ai/trae/task-1": { status: 0, stdout: "" },
    "merge-base\u0000--is-ancestor\u0000aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\u0000FETCH_HEAD": {
      status: 0,
      stdout: "",
    },
    ...overrides,
  };
}

describe("trae automation artifact checks", () => {
  it("returns not reviewable when worktree directory is not specified", async () => {
    const mod = await import(artifactChecksModulePath);

    const result = mod.checkArtifactReviewability({
      worktree_dir: null,
      scope: ["src/**"],
      branch: "ai/trae/task-1",
      default_branch: "main",
    });

    expect(result.reviewable).toBe(false);
    expect(result.reason).toBe("No worktree directory specified");
  });

  it("returns not reviewable when worktree is not a git repository", async () => {
    const mod = await import(artifactChecksModulePath);
    const nonGitDir = fs.mkdtempSync(path.join(os.tmpdir(), "non-git-"));

    const result = mod.checkArtifactReviewability({
      worktree_dir: nonGitDir,
      scope: ["src/**"],
      branch: "ai/trae/task-1",
      default_branch: "main",
    });

    expect(result.reviewable).toBe(false);
    expect(result.reason).toBe("Worktree is not a valid git repository");

    fs.rmSync(nonGitDir, { recursive: true, force: true });
  });

  it("returns not reviewable when branch does not match", async () => {
    const mod = await import(artifactChecksModulePath);
    const worktreeDir = fs.mkdtempSync(path.join(os.tmpdir(), "artifact-checks-"));
    const runGit = createRunGitMock({
      "rev-parse\u0000--is-inside-work-tree": { status: 0, stdout: "true" },
      "branch\u0000--show-current": { status: 0, stdout: "main" },
    });

    const result = mod.checkArtifactReviewability({
      worktree_dir: worktreeDir,
      scope: ["src/**"],
      branch: "ai/trae/task-1",
      default_branch: "main",
    }, { runGit });

    expect(result.reviewable).toBe(false);
    expect(result.reason).toContain("Branch mismatch");
    expect(result.evidence.branchName).toBe("main");

    fs.rmSync(worktreeDir, { recursive: true, force: true });
  });

  it("returns not reviewable when no committed changes detected", async () => {
    const mod = await import(artifactChecksModulePath);
    const worktreeDir = fs.mkdtempSync(path.join(os.tmpdir(), "artifact-checks-"));
    const runGit = createRunGitMock(reviewableGitResponses({
      "diff\u0000--name-only\u0000bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb": {
        status: 0,
        stdout: "",
      },
    }));

    const result = mod.checkArtifactReviewability({
      worktree_dir: worktreeDir,
      scope: ["src/**"],
      branch: "ai/trae/task-1",
      default_branch: "main",
    }, { runGit });

    expect(result.reviewable).toBe(false);
    expect(result.reason).toBe("No changes detected in worktree");

    fs.rmSync(worktreeDir, { recursive: true, force: true });
  });

  it("returns not reviewable when uncommitted changes are present", async () => {
    const mod = await import(artifactChecksModulePath);
    const worktreeDir = fs.mkdtempSync(path.join(os.tmpdir(), "artifact-checks-"));
    const runGit = createRunGitMock(reviewableGitResponses({
      "diff\u0000--cached\u0000--name-only": {
        status: 0,
        stdout: "src/extra.js",
      },
    }));

    const result = mod.checkArtifactReviewability({
      worktree_dir: worktreeDir,
      scope: ["src/**"],
      branch: "ai/trae/task-1",
      default_branch: "main",
    }, { runGit });

    expect(result.reviewable).toBe(false);
    expect(result.reason).toContain("Uncommitted changes present");
    expect(result.evidence.uncommittedFiles).toEqual(["src/extra.js"]);

    fs.rmSync(worktreeDir, { recursive: true, force: true });
  });

  it("returns not reviewable when committed changes are out of scope", async () => {
    const mod = await import(artifactChecksModulePath);
    const worktreeDir = fs.mkdtempSync(path.join(os.tmpdir(), "artifact-checks-"));
    const runGit = createRunGitMock(reviewableGitResponses({
      "diff\u0000--name-only\u0000bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb": {
        status: 0,
        stdout: "docs/guide.md",
      },
    }));

    const result = mod.checkArtifactReviewability({
      worktree_dir: worktreeDir,
      scope: ["src/**"],
      branch: "ai/trae/task-1",
      default_branch: "main",
    }, { runGit });

    expect(result.reviewable).toBe(false);
    expect(result.reason).toContain("Out-of-scope files detected");
    expect(result.evidence.outOfScopeFiles).toEqual(["docs/guide.md"]);

    fs.rmSync(worktreeDir, { recursive: true, force: true });
  });

  it("returns not reviewable when remote branch does not contain the commit", async () => {
    const mod = await import(artifactChecksModulePath);
    const worktreeDir = fs.mkdtempSync(path.join(os.tmpdir(), "artifact-checks-"));
    const runGit = createRunGitMock(reviewableGitResponses({
      "merge-base\u0000--is-ancestor\u0000aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\u0000FETCH_HEAD": {
        status: 1,
        stderr: "",
      },
    }));

    const result = mod.checkArtifactReviewability({
      worktree_dir: worktreeDir,
      scope: ["src/**"],
      branch: "ai/trae/task-1",
      default_branch: "main",
    }, { runGit });

    expect(result.reviewable).toBe(false);
    expect(result.reason).toContain("not pushed to remote branch");
    expect(result.evidence.remoteVerified).toBe(false);

    fs.rmSync(worktreeDir, { recursive: true, force: true });
  });

  it("returns reviewable when committed changes are in scope and remote verified", async () => {
    const mod = await import(artifactChecksModulePath);
    const worktreeDir = fs.mkdtempSync(path.join(os.tmpdir(), "artifact-checks-"));
    const runGit = createRunGitMock(reviewableGitResponses());

    const result = mod.checkArtifactReviewability({
      worktree_dir: worktreeDir,
      scope: ["src/**"],
      branch: "ai/trae/task-1",
      default_branch: "main",
    }, { runGit });

    expect(result.reviewable).toBe(true);
    expect(result.reason).toBe("Artifact is reviewable");
    expect(result.evidence.remoteVerified).toBe(true);
    expect(result.evidence.filesChanged).toEqual(["src/test.js"]);

    fs.rmSync(worktreeDir, { recursive: true, force: true });
  });

  it("treats empty scope as no path restriction once remote verification passes", async () => {
    const mod = await import(artifactChecksModulePath);
    const worktreeDir = fs.mkdtempSync(path.join(os.tmpdir(), "artifact-checks-"));
    const runGit = createRunGitMock(reviewableGitResponses({
      "diff\u0000--name-only\u0000bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb": {
        status: 0,
        stdout: "docs/guide.md",
      },
    }));

    const result = mod.checkArtifactReviewability({
      worktree_dir: worktreeDir,
      scope: [],
      branch: "ai/trae/task-1",
      default_branch: "main",
    }, { runGit });

    expect(result.reviewable).toBe(true);
    expect(result.evidence.allChangesInScope).toBe(true);
    expect(result.evidence.filesChanged).toEqual(["docs/guide.md"]);

    fs.rmSync(worktreeDir, { recursive: true, force: true });
  });
});
