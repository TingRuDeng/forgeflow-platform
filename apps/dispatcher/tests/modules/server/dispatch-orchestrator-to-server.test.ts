import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

const repoRoot = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "../../../../../",
);
const modulePath = path.join(repoRoot, "scripts/lib/dispatch-orchestrator.js");
const tempRoots: string[] = [];

function makeTempDir() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "forgeflow-dispatch-payload-"));
  tempRoots.push(tempDir);
  return tempDir;
}

function writeJson(filePath: string, value: unknown) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

afterEach(() => {
  for (const tempDir of tempRoots.splice(0)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

describe("dispatch-orchestrator payload", () => {
  it("builds a dispatcher payload from .orchestrator files", async () => {
    const tempDir = makeTempDir();
    const orchestratorDir = path.join(tempDir, ".orchestrator");
    const assignmentDir = path.join(orchestratorDir, "assignments", "task-1");
    const mod = await import(modulePath);

    writeJson(path.join(orchestratorDir, "task-ledger.json"), {
      repo: "TingRuDeng/openclaw-multi-agent-mvp",
      defaultBranch: "master",
      generatedAt: "2026-03-16T12:00:00.000Z",
      tasks: [
        {
          id: "task-1",
          title: "实现后端鉴权 API",
          pool: "codex",
          allowedPaths: ["src/**", "tests/**"],
          acceptance: ["返回 token"],
          dependsOn: [],
          branchName: "ai/codex/task-1-auth-api",
          verification: {
            mode: "run",
          },
        },
      ],
    });
    writeJson(path.join(assignmentDir, "assignment.json"), {
      taskId: "task-1",
      workerId: "codex-worker-1",
      pool: "codex",
      status: "assigned",
      branchName: "ai/codex/task-1-auth-api",
      allowedPaths: ["src/**", "tests/**"],
      commands: {
        test: "pnpm test",
      },
      repo: "TingRuDeng/openclaw-multi-agent-mvp",
      defaultBranch: "master",
    });
    fs.writeFileSync(path.join(assignmentDir, "worker-prompt.md"), "你是 codex-worker。\n");
    fs.writeFileSync(path.join(assignmentDir, "context.md"), "# Context\n");

    const payload = mod.buildDispatchServerPayload({
      orchestratorDir,
      requestedBy: "codex-control",
    });

    expect(payload).toMatchObject({
      repo: "TingRuDeng/openclaw-multi-agent-mvp",
      defaultBranch: "master",
      requestedBy: "codex-control",
    });
    expect(payload.tasks[0]).toMatchObject({
      id: "task-1",
      title: "实现后端鉴权 API",
      pool: "codex",
    });
    expect(payload.packages[0]).toMatchObject({
      taskId: "task-1",
      workerPrompt: "你是 codex-worker。\n",
      contextMarkdown: "# Context\n",
    });
  });
});
