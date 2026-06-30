import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";

import { afterEach, beforeAll, describe, expect, it } from "vitest";

const repoRoot = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "../../../../../",
);
const scriptPath = path.join(repoRoot, "scripts/run-worker-assignment.js");
const distRuntimeCodex = path.join(repoRoot, "apps/dispatcher/dist/modules/runtime/codex.js");
const tempRoots: string[] = [];

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "forgeflow-run-assignment-"));
  tempRoots.push(dir);
  return dir;
}

function materializeAssignment(pool: string): { assignmentDir: string; worktreeDir: string } {
  const root = makeTempDir();
  const assignmentDir = path.join(root, "assignment");
  const worktreeDir = path.join(root, "worktree");
  fs.mkdirSync(assignmentDir, { recursive: true });
  fs.mkdirSync(worktreeDir, { recursive: true });
  fs.writeFileSync(
    path.join(assignmentDir, "assignment.json"),
    JSON.stringify({
      taskId: "dispatch-1:task-1",
      workerId: `${pool}-worker`,
      pool,
      branchName: `ai/${pool}/task-1`,
      repo: "owner/repo",
      defaultBranch: "main",
      commands: { test: "pnpm test" },
    }),
  );
  fs.writeFileSync(path.join(assignmentDir, "worker-prompt.md"), "Do the work.");
  fs.writeFileSync(path.join(assignmentDir, "context.md"), "# Context");
  return { assignmentDir, worktreeDir };
}

function runDryRun(assignmentDir: string, worktreeDir: string): { launch: { provider: string; argv: string[]; cwd: string } } {
  const stdout = execFileSync(
    "node",
    [scriptPath, "--dry-run", "--assignment-dir", assignmentDir, "--worktree-dir", worktreeDir],
    { encoding: "utf-8", cwd: repoRoot },
  );
  return JSON.parse(stdout);
}

describe("run-worker-assignment launch command (delegates to runtime abstraction)", () => {
  beforeAll(() => {
    if (!fs.existsSync(distRuntimeCodex)) {
      spawnSync("pnpm", ["--filter", "@forgeflow/dispatcher", "build"], { cwd: repoRoot, stdio: "ignore" });
    }
  }, 120_000);

  afterEach(() => {
    while (tempRoots.length > 0) {
      const dir = tempRoots.pop();
      if (dir) {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  it("builds the codex worker launch argv (no -m without an explicit model)", () => {
    const { assignmentDir, worktreeDir } = materializeAssignment("codex");
    const { launch } = runDryRun(assignmentDir, worktreeDir);
    expect(launch.provider).toBe("codex");
    expect(launch.cwd).toBe(worktreeDir);
    expect(launch.argv).toEqual([
      "codex",
      "exec",
      "--sandbox",
      "workspace-write",
      "Do the work.\n\n# Context\n",
    ]);
  });

  it("builds the gemini worker launch argv with the default model", () => {
    const { assignmentDir, worktreeDir } = materializeAssignment("gemini");
    const { launch } = runDryRun(assignmentDir, worktreeDir);
    expect(launch.provider).toBe("gemini");
    expect(launch.argv).toEqual([
      "gemini",
      "-m",
      "gemini-2.5-pro",
      "-p",
      "Do the work.\n\n# Context\n",
    ]);
  });

  it("honors FORGEFLOW_CODEX_MODEL for the codex launch argv", () => {
    const { assignmentDir, worktreeDir } = materializeAssignment("codex");
    const stdout = execFileSync(
      "node",
      [scriptPath, "--dry-run", "--assignment-dir", assignmentDir, "--worktree-dir", worktreeDir],
      { encoding: "utf-8", cwd: repoRoot, env: { ...process.env, FORGEFLOW_CODEX_MODEL: "gpt-5.4-codex" } },
    );
    const { launch } = JSON.parse(stdout);
    expect(launch.argv).toEqual([
      "codex",
      "exec",
      "-m",
      "gpt-5.4-codex",
      "--sandbox",
      "workspace-write",
      "Do the work.\n\n# Context\n",
    ]);
  });
});
