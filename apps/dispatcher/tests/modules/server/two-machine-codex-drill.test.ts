import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const repoRoot = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "../../../../../",
);
const stateModulePath = path.join(repoRoot, "scripts/lib/dispatcher-state.js");
const tempRoots: string[] = [];

function makeTempDir() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "forgeflow-two-machine-drill-"));
  tempRoots.push(tempDir);
  return tempDir;
}

afterEach(() => {
  for (const tempDir of tempRoots.splice(0)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

describe("two-machine codex drill", () => {
  it("assigns two codex tasks to two different codex workers", async () => {
    const stateDir = makeTempDir();
    const mod = await import(stateModulePath);

    let state = mod.createEmptyRuntimeState();
    state = mod.registerWorker(state, {
      workerId: "codex-worker-78",
      pool: "codex",
      hostname: "192.168.1.78",
      labels: ["dispatcher", "codex"],
      repoDir: "/repos/openclaw",
      at: "2026-03-16T15:00:00.000Z",
    });
    state = mod.registerWorker(state, {
      workerId: "codex-worker-remote",
      pool: "codex",
      hostname: "192.168.1.99",
      labels: ["codex"],
      repoDir: "/repos/openclaw",
      at: "2026-03-16T15:00:01.000Z",
    });

    const dispatch = mod.createDispatch(state, {
      repo: "TingRuDeng/openclaw-multi-agent-mvp",
      defaultBranch: "master",
      requestedBy: "codex-control",
      tasks: [
        {
          id: "task-1",
          title: "编写服务端 smoke 文档",
          pool: "codex",
          allowedPaths: ["docs/**"],
          acceptance: ["新增服务端 smoke 文档"],
          dependsOn: [],
          branchName: "ai/codex/task-1-server-smoke",
          verification: { mode: "run" },
        },
        {
          id: "task-2",
          title: "补充 API smoke 测试说明",
          pool: "codex",
          allowedPaths: ["docs/**", "tests/**"],
          acceptance: ["新增 API smoke 测试说明"],
          dependsOn: [],
          branchName: "ai/codex/task-2-api-smoke",
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
            branchName: "ai/codex/task-1-server-smoke",
            allowedPaths: ["docs/**"],
            commands: {
              test: "echo ok",
            },
            repo: "TingRuDeng/openclaw-multi-agent-mvp",
            defaultBranch: "master",
          },
          workerPrompt: "你是 codex-worker。",
          contextMarkdown: "# Context",
        },
        {
          taskId: "task-2",
          assignment: {
            taskId: "task-2",
            workerId: "placeholder",
            pool: "codex",
            status: "assigned",
            branchName: "ai/codex/task-2-api-smoke",
            allowedPaths: ["docs/**", "tests/**"],
            commands: {
              test: "echo ok",
            },
            repo: "TingRuDeng/openclaw-multi-agent-mvp",
            defaultBranch: "master",
          },
          workerPrompt: "你是 codex-worker。",
          contextMarkdown: "# Context",
        },
      ],
      createdAt: "2026-03-16T15:00:20.000Z",
    });

    mod.saveRuntimeState(stateDir, dispatch.state);
    const snapshot = mod.buildDashboardSnapshot(dispatch.state, {
      now: "2026-03-16T15:00:21.000Z",
    });

    expect(snapshot.tasks).toHaveLength(2);
    expect(snapshot.tasks.every((task: { status: string }) => task.status === "assigned")).toBe(true);
    expect(new Set(snapshot.tasks.map((task: { assignedWorkerId?: string }) => task.assignedWorkerId)).size).toBe(2);
    expect(snapshot.workers.filter((worker: { status: string }) => worker.status === "busy")).toHaveLength(2);
  }, 15_000);
});
