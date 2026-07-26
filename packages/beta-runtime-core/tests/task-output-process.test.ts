import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { runWorkerAssignmentScript } from "../src/runtime/task-output.js";

describe("worker assignment process lifecycle", () => {
  it("terminates the assignment process tree when aborted", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "forgeflow-assignment-abort-"));
    const outputDir = path.join(root, "output");
    const startedMarker = path.join(root, "grandchild-started");
    const marker = path.join(root, "grandchild-finished");
    const scriptPath = path.join(root, "runtime-script.cjs");
    const grandchildCode = [
      `require("fs").writeFileSync(${JSON.stringify(startedMarker)}, "started");`,
      `setTimeout(() => require("fs").writeFileSync(${JSON.stringify(marker)}, "done"), 200);`,
    ].join("");
    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(scriptPath, [
      'const { spawn } = require("node:child_process");',
      `spawn(process.execPath, ["-e", ${JSON.stringify(grandchildCode)}], { stdio: "ignore" });`,
      "setInterval(() => {}, 1000);",
    ].join("\n"));
    const abortController = new AbortController();

    const execution = runWorkerAssignmentScript({
      packageRoot: root,
      assignmentDir: root,
      worktreeDir: root,
      outputDir,
      runtimeScriptPath: scriptPath,
      signal: abortController.signal,
    });

    try {
      await waitForFile(startedMarker, 5_000);
      abortController.abort();

      await expect(execution).rejects.toThrow("worker execution aborted");
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(fs.existsSync(marker)).toBe(false);
    } finally {
      abortController.abort();
      await execution.catch(() => undefined);
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

async function waitForFile(filePath: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!fs.existsSync(filePath)) {
    if (Date.now() >= deadline) {
      throw new Error(`timed out waiting for process marker: ${filePath}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
