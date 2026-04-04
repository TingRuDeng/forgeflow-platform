import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

import { afterEach, describe, expect, it } from "vitest";

const repoRoot = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "../../../../../",
);
const stateModulePath = path.join(repoRoot, "scripts/lib/dispatcher-state.js");
const reviewModulePath = path.join(repoRoot, "scripts/lib/review-decision.js");
const reviewScriptPath = path.join(repoRoot, "scripts/submit-review-decision.js");
const tempRoots: string[] = [];

function makeTempDir() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "forgeflow-review-decision-"));
  tempRoots.push(tempDir);
  return tempDir;
}

afterEach(() => {
  for (const tempDir of tempRoots.splice(0)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

async function createReviewReadyState(stateDir: string) {
  const stateMod = await import(stateModulePath);

  let state = stateMod.createEmptyRuntimeState();
  state = stateMod.registerWorker(state, {
    workerId: "codex-mac-mini",
    pool: "codex",
    hostname: "mac-mini",
    labels: ["mac"],
    repoDir: "/repos/openclaw",
    at: "2026-03-16T13:00:40.000Z",
  });
  const dispatch = stateMod.createDispatch(state, {
    repo: "TingRuDeng/openclaw-multi-agent-mvp",
    defaultBranch: "master",
    requestedBy: "codex-control",
    tasks: [
      {
        id: "task-1",
        title: "实现后端鉴权 API",
        pool: "codex",
        allowedPaths: ["src/**"],
        acceptance: [],
        dependsOn: [],
        branchName: "ai/codex/task-1-auth-api",
        verification: { mode: "run" },
      },
    ],
    packages: [
      {
        taskId: "task-1",
        assignment: {
          taskId: "task-1",
          workerId: "placeholder",
          pool: "codex",
          status: "assigned",
          branchName: "ai/codex/task-1-auth-api",
          allowedPaths: ["src/**"],
          commands: { test: "pnpm test" },
          repo: "TingRuDeng/openclaw-multi-agent-mvp",
          defaultBranch: "master",
        },
        workerPrompt: "你是 codex-worker。",
        contextMarkdown: "# Context",
      },
    ],
    createdAt: "2026-03-16T13:01:00.000Z",
  });
  state = stateMod.recordWorkerResult(dispatch.state, {
    workerId: "codex-mac-mini",
    result: {
      taskId: dispatch.taskIds[0],
      workerId: "codex-mac-mini",
      provider: "codex",
      pool: "codex",
      branchName: "ai/codex/task-1-auth-api",
      repo: "TingRuDeng/openclaw-multi-agent-mvp",
      defaultBranch: "master",
      mode: "run",
      output: "done",
      generatedAt: "2026-03-16T13:02:00.000Z",
      verification: {
        allPassed: true,
        commands: [{ command: "pnpm test", exitCode: 0, output: "ok" }],
      },
    },
    changedFiles: ["src/auth.ts"],
    pullRequest: {
      number: 15,
      url: "https://github.com/TingRuDeng/openclaw-multi-agent-mvp/pull/15",
      headBranch: "ai/codex/task-1-auth-api",
      baseBranch: "master",
    },
  });
  stateMod.saveRuntimeState(stateDir, state);

  return {
    stateMod,
    taskId: dispatch.taskIds[0],
  };
}

describe("submit review decision", () => {
  it("marks a review task as blocked when requesting rework", async () => {
    const stateDir = makeTempDir();
    const { stateMod, taskId } = await createReviewReadyState(stateDir);
    const reviewMod = await import(reviewModulePath);

    const client = reviewMod.createStateDirReviewClient(stateDir);
    const result = await reviewMod.submitReviewDecision({
      client,
      taskId,
      actor: "codex-control",
      decision: "rework",
      notes: "需要补充失败分支测试",
    });

    expect(result.status).toBe("decision_recorded");
    const snapshot = stateMod.buildDashboardSnapshot(stateMod.loadRuntimeState(stateDir));
    expect(snapshot.tasks[0]).toMatchObject({
      status: "blocked",
    });
    expect(snapshot.reviews[0]).toMatchObject({
      decision: "rework",
    });
    expect(snapshot.pullRequests[0]).toMatchObject({
      status: "changes_requested",
    });
  }, 15_000);

  it("supports the CLI --state-dir mode without a dispatcher URL", async () => {
    const stateDir = makeTempDir();
    const { stateMod, taskId } = await createReviewReadyState(stateDir);

    const stdout = execFileSync(
      process.execPath,
      [
        reviewScriptPath,
        "--state-dir",
        stateDir,
        "--task-id",
        taskId,
        "--decision",
        "merge",
        "--actor",
        "codex-control",
        "--notes",
        "looks good",
      ],
      {
        cwd: repoRoot,
        encoding: "utf8",
      },
    );

    const json = JSON.parse(stdout);
    expect(json.status).toBe("decision_recorded");

    const snapshot = stateMod.buildDashboardSnapshot(stateMod.loadRuntimeState(stateDir));
    expect(snapshot.tasks[0]).toMatchObject({
      status: "merged",
    });
    expect(snapshot.reviews[0]).toMatchObject({
      decision: "merge",
    });
    expect(snapshot.pullRequests[0]).toMatchObject({
      status: "merged",
    });
  }, 15_000);
});
