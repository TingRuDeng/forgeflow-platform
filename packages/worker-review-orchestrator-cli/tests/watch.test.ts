import fs from "node:fs";
import path from "node:path";
import os from "node:os";

import { describe, expect, it, beforeEach, afterEach } from "vitest";

import { watchTask } from "../src/watch.js";

function createTempStateDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "watch-test-"));
}

function writeState(stateDir: string, state: Record<string, unknown>) {
  fs.writeFileSync(path.join(stateDir, "runtime-state.json"), JSON.stringify(state, null, 2));
}

describe("watch", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    tempDirs.length = 0;
  });

  it("returns summary output when summary mode is enabled", async () => {
    const fetchImpl = async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ tasks: [{ id: "dispatch-1:task-1", status: "review" }] }),
    });

    const result = await watchTask({
      dispatcherUrl: "http://127.0.0.1:8787",
      taskId: "dispatch-1:task-1",
      intervalMs: 10,
      timeoutMs: 5000,
      summary: true,
      fetchImpl: fetchImpl as typeof globalThis.fetch,
    });

    expect(result).toMatchObject({
      taskId: "dispatch-1:task-1",
      status: "review",
      attempts: 1,
    });
  });

  it("returns full output when summary mode is disabled", async () => {
    const fetchImpl = async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ tasks: [{ id: "dispatch-1:task-1", status: "failed" }] }),
    });

    const result = await watchTask({
      dispatcherUrl: "http://127.0.0.1:8787",
      taskId: "dispatch-1:task-1",
      intervalMs: 10,
      timeoutMs: 5000,
      summary: false,
      fetchImpl: fetchImpl as typeof globalThis.fetch,
    });

    expect(result).toMatchObject({
      taskId: "dispatch-1:task-1",
      status: "failed",
      attempts: 1,
    });
    expect("task" in result).toBe(true);
  });

  describe("stateDir", () => {
    it("returns summary output with stateDir when summary mode is enabled", async () => {
      const stateDir = createTempStateDir();
      tempDirs.push(stateDir);

      writeState(stateDir, { tasks: [{ id: "dispatch-1:task-1", status: "merged" }] });

      const result = await watchTask({
        stateDir,
        taskId: "dispatch-1:task-1",
        intervalMs: 10,
        timeoutMs: 5000,
        summary: true,
      });

      expect(result).toMatchObject({
        taskId: "dispatch-1:task-1",
        status: "merged",
        attempts: 1,
      });
    });

    it("returns full output with stateDir when summary mode is disabled", async () => {
      const stateDir = createTempStateDir();
      tempDirs.push(stateDir);

      writeState(stateDir, { tasks: [{ id: "dispatch-1:task-1", status: "blocked" }] });

      const result = await watchTask({
        stateDir,
        taskId: "dispatch-1:task-1",
        intervalMs: 10,
        timeoutMs: 5000,
        summary: false,
      });

      expect(result).toMatchObject({
        taskId: "dispatch-1:task-1",
        status: "blocked",
        attempts: 1,
      });
      expect("task" in result).toBe(true);
    });
  });
});
