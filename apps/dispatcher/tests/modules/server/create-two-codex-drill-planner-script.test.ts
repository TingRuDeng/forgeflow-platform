import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

const repoRoot = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "../../../../../",
);
const scriptPath = path.join(repoRoot, "scripts/create-two-codex-drill-planner.js");
const tempRoots: string[] = [];

function makeTempDir() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "forgeflow-two-codex-planner-"));
  tempRoots.push(tempDir);
  return tempDir;
}

afterEach(() => {
  for (const tempDir of tempRoots.splice(0)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

describe("create-two-codex-drill-planner script", () => {
  it("writes a planner_output_json with two codex tasks", () => {
    const tempDir = makeTempDir();
    const outputFile = path.join(tempDir, "planner.json");

    const result = spawnSync("node", [scriptPath, "--output", outputFile], {
      cwd: repoRoot,
      encoding: "utf8",
    });

    expect(result.status).toBe(0);
    const plannerOutput = JSON.parse(fs.readFileSync(outputFile, "utf8"));
    expect(plannerOutput.tasks).toHaveLength(2);
    expect(plannerOutput.tasks.every((task: { pool: string }) => task.pool === "codex")).toBe(true);
  });
});
