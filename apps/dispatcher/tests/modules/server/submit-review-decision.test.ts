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

  it("preserves reviewMaterial when recording review decision via client", async () => {
    const stateDir = makeTempDir();
    const stateMod = await import(stateModulePath);

    let state = stateMod.createEmptyRuntimeState();
    state = stateMod.registerWorker(state, {
      workerId: "codex-review-material-client",
      pool: "codex",
      hostname: "test-host",
      labels: ["codex"],
      repoDir: "/repos/test",
      at: "2026-04-04T10:00:00.000Z",
    });

    const dispatch = stateMod.createDispatch(state, {
      repo: "TingRuDeng/ForgeFlow",
      defaultBranch: "main",
      requestedBy: "test",
      tasks: [
        {
          id: "task-review-material-client",
          title: "Test review material via client",
          pool: "codex",
          allowedPaths: ["src/**"],
          acceptance: ["test"],
          dependsOn: [],
          branchName: "ai/codex/task-review-material-client",
          verification: { mode: "run" },
        },
      ],
      packages: [
        {
          taskId: "task-review-material-client",
          assignment: {
            taskId: "task-review-material-client",
            workerId: "codex-review-material-client",
            pool: "codex",
            status: "assigned",
            branchName: "ai/codex/task-review-material-client",
            allowedPaths: ["src/**"],
            repo: "TingRuDeng/ForgeFlow",
            defaultBranch: "main",
          },
          workerPrompt: "Test prompt",
        },
      ],
      createdAt: "2026-04-04T10:00:10.000Z",
    });
    state = dispatch.state;
    const taskId = dispatch.taskIds[0];

    state = stateMod.beginTaskForWorker(state, {
      workerId: "codex-review-material-client",
      taskId,
      at: "2026-04-04T10:00:15.000Z",
    });

    state = stateMod.recordWorkerResult(state, {
      workerId: "codex-review-material-client",
      result: {
        taskId,
        workerId: "codex-review-material-client",
        provider: "codex",
        pool: "codex",
        branchName: "ai/codex/task-review-material-client",
        repo: "TingRuDeng/ForgeFlow",
        defaultBranch: "main",
        mode: "run",
        output: "done",
        generatedAt: "2026-04-04T10:05:00.000Z",
        verification: {
          allPassed: true,
          commands: [{ command: "pnpm test", exitCode: 0, output: "ok" }],
        },
      },
      changedFiles: ["src/main.ts", "src/utils.ts"],
      pullRequest: {
        number: 50,
        url: "https://github.com/TingRuDeng/ForgeFlow/pull/50",
        headBranch: "ai/codex/task-review-material-client",
        baseBranch: "main",
      },
    });

    stateMod.saveRuntimeState(stateDir, state);

    const reviewMod = await import(reviewModulePath);
    const client = reviewMod.createStateDirReviewClient(stateDir);
    await reviewMod.submitReviewDecision({
      client,
      taskId,
      actor: "reviewer",
      decision: "block",
      notes: "needs more tests",
    });

    const snapshot = stateMod.buildDashboardSnapshot(stateMod.loadRuntimeState(stateDir));
    expect(snapshot.reviews[0]?.reviewMaterial).toMatchObject({
      repo: "TingRuDeng/ForgeFlow",
      changedFiles: ["src/main.ts", "src/utils.ts"],
      selfTestPassed: true,
    });
    expect(snapshot.tasks[0]).toMatchObject({
      status: "blocked",
    });
  }, 15_000);

  it("records structured evidence with review decision via client", async () => {
    const stateDir = makeTempDir();
    const stateMod = await import(stateModulePath);

    let state = stateMod.createEmptyRuntimeState();
    state = stateMod.registerWorker(state, {
      workerId: "codex-evidence-client",
      pool: "codex",
      hostname: "test-host",
      labels: ["codex"],
      repoDir: "/repos/test",
      at: "2026-04-04T11:00:00.000Z",
    });

    const dispatch = stateMod.createDispatch(state, {
      repo: "TingRuDeng/ForgeFlow",
      defaultBranch: "main",
      requestedBy: "test",
      tasks: [
        {
          id: "task-evidence-client",
          title: "Test evidence via client",
          pool: "codex",
          allowedPaths: ["src/**"],
          acceptance: ["test"],
          dependsOn: [],
          branchName: "ai/codex/task-evidence-client",
          verification: { mode: "run" },
        },
      ],
      packages: [
        {
          taskId: "task-evidence-client",
          assignment: {
            taskId: "task-evidence-client",
            workerId: "codex-evidence-client",
            pool: "codex",
            status: "assigned",
            branchName: "ai/codex/task-evidence-client",
            allowedPaths: ["src/**"],
            repo: "TingRuDeng/ForgeFlow",
            defaultBranch: "main",
          },
          workerPrompt: "Test prompt",
        },
      ],
      createdAt: "2026-04-04T11:00:10.000Z",
    });
    state = dispatch.state;
    const taskId = dispatch.taskIds[0];

    state = stateMod.beginTaskForWorker(state, {
      workerId: "codex-evidence-client",
      taskId,
      at: "2026-04-04T11:00:15.000Z",
    });

    state = stateMod.recordWorkerResult(state, {
      workerId: "codex-evidence-client",
      result: {
        taskId,
        workerId: "codex-evidence-client",
        provider: "codex",
        pool: "codex",
        branchName: "ai/codex/task-evidence-client",
        repo: "TingRuDeng/ForgeFlow",
        defaultBranch: "main",
        mode: "run",
        output: "done",
        generatedAt: "2026-04-04T11:05:00.000Z",
        verification: {
          allPassed: true,
          commands: [{ command: "pnpm test", exitCode: 0, output: "ok" }],
        },
      },
      changedFiles: ["src/main.ts"],
      pullRequest: null,
    });

    stateMod.saveRuntimeState(stateDir, state);

    const structuredEvidence = {
      decision: "block" as const,
      actor: "reviewer",
      notes: "insufficient coverage",
      findings: [
        {
          finding_id: "finding-1",
          severity: "high" as const,
          category: "test-gap" as const,
          title: "Missing unit tests for calculateTotal",
          evidence: {
            file: "src/main.ts",
            line: 10,
            symbol: "calculateTotal",
            snippet: "function calculateTotal() { return 0; }",
          },
          recommendation: "Add unit tests",
          confidence: 0.9,
          fingerprint: "abc123",
          detected_by: ["codex"],
        },
      ],
      blockedReason: "test coverage below threshold",
    };

    const reviewMod = await import(reviewModulePath);
    const client = reviewMod.createStateDirReviewClient(stateDir);
    await reviewMod.submitReviewDecision({
      client,
      taskId,
      actor: "reviewer",
      decision: "block",
      notes: "insufficient coverage",
      evidence: structuredEvidence,
    });

    const snapshot = stateMod.buildDashboardSnapshot(stateMod.loadRuntimeState(stateDir));
    expect(snapshot.reviews[0]?.evidence).toMatchObject({
      decision: "block",
      actor: "reviewer",
      findings: [
        {
          finding_id: "finding-1",
          severity: "high",
          category: "test-gap",
        },
      ],
      blockedReason: "test coverage below threshold",
    });
    expect(snapshot.reviews[0]?.reviewMaterial).toBeDefined();
  }, 15_000);
});
