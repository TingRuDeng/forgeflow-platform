import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { afterEach, describe, expect, it } from "vitest";

const repoRoot = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "../../../../../",
);
const runCodexControlFlowScript = path.join(repoRoot, "scripts/run-codex-control-flow.js");
const tempRoots: string[] = [];

function makeTempDir() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "forgeflow-codex-control-flow-"));
  tempRoots.push(tempDir);
  return tempDir;
}

afterEach(() => {
  for (const tempDir of tempRoots.splice(0)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

describe("run-codex-control-flow.mjs", () => {
  it("prints the combined flow in dry-run mode", () => {
    const tempDir = makeTempDir();
    const repoDir = path.join(tempDir, "business-repo");
    const plannerFile = path.join(tempDir, "planner-output.json");

    fs.mkdirSync(repoDir, { recursive: true });
    fs.writeFileSync(
      plannerFile,
      `${JSON.stringify({
        tasks: [
          {
            title: "后端接口与测试实现",
            pool: "codex",
            allowedPaths: ["src/**", "tests/**"],
            verification: { mode: "run" },
          },
        ],
      }, null, 2)}\n`,
    );

    const result = spawnSync(
      "node",
      [
        runCodexControlFlowScript,
        "--repo",
        "TingRuDeng/openclaw-multi-agent-mvp",
        "--ref",
        "master",
        "--repo-dir",
        repoDir,
        "--request-summary",
        "补充接入文档并增加 API 冒烟测试",
        "--task-type",
        "feature",
        "--planner-provider",
        "manual",
        "--planner-json-file",
        plannerFile,
        "--dry-run",
      ],
      {
        cwd: repoRoot,
        encoding: "utf8",
      },
    );

    expect(result.status).toBe(0);

    const payload = JSON.parse(result.stdout);
    expect(payload).toMatchObject({
      repo: "TingRuDeng/openclaw-multi-agent-mvp",
      ref: "master",
      repoDir,
      workflow: "ai-dispatch.yml",
      artifactName: "dispatch-plan",
      plannerProvider: "manual",
    });
    expect(payload.steps).toEqual([
      "dispatch workflow",
      "wait for workflow completion",
      "download dispatch artifact",
      "extract .orchestrator",
      "run assigned tasks locally",
    ]);
    expect(payload.payload.inputs.request_summary).toBe("补充接入文档并增加 API 冒烟测试");
  });

  it("prints dispatcher publication steps when dispatcher-url is provided", () => {
    const tempDir = makeTempDir();
    const repoDir = path.join(tempDir, "business-repo");
    const plannerFile = path.join(tempDir, "planner-output.json");

    fs.mkdirSync(repoDir, { recursive: true });
    fs.writeFileSync(
      plannerFile,
      `${JSON.stringify({
        tasks: [
          {
            title: "后端接口与测试实现",
            pool: "codex",
            allowedPaths: ["src/**", "tests/**"],
            verification: { mode: "run" },
          },
        ],
      }, null, 2)}\n`,
    );

    const result = spawnSync(
      "node",
      [
        runCodexControlFlowScript,
        "--repo",
        "TingRuDeng/openclaw-multi-agent-mvp",
        "--ref",
        "master",
        "--repo-dir",
        repoDir,
        "--request-summary",
        "补充接入文档并增加 API 冒烟测试",
        "--task-type",
        "feature",
        "--planner-provider",
        "manual",
        "--planner-json-file",
        plannerFile,
        "--dispatcher-url",
        "http://127.0.0.1:8787",
        "--dry-run",
      ],
      {
        cwd: repoRoot,
        encoding: "utf8",
      },
    );

    expect(result.status).toBe(0);

    const payload = JSON.parse(result.stdout);
    expect(payload.dispatcherUrl).toBe("http://127.0.0.1:8787");
    expect(payload.steps).toEqual([
      "dispatch workflow",
      "wait for workflow completion",
      "download dispatch artifact",
      "extract .orchestrator",
      "publish tasks to dispatcher server",
    ]);
  });
});
