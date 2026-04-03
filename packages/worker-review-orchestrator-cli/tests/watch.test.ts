import fs from "node:fs";
import path from "node:path";
import os from "node:os";

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

import { watchTask } from "../src/watch.js";

function createTempStateDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "watch-test-"));
}

function writeState(stateDir: string, state: Record<string, unknown>) {
  fs.writeFileSync(path.join(stateDir, "runtime-state.json"), JSON.stringify(state, null, 2));
}

describe("watch", () => {
  const tempDirs: string[] = [];

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    for (const dir of tempDirs) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    tempDirs.length = 0;
  });

  it("polls until the task reaches a terminal status", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ tasks: [{ id: "dispatch-1:task-1", status: "in_progress" }] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ tasks: [{ id: "dispatch-1:task-1", status: "review" }] }),
      });

    const resultPromise = watchTask({
      dispatcherUrl: "http://127.0.0.1:8787",
      taskId: "dispatch-1:task-1",
      intervalMs: 1,
      timeoutMs: 100,
      fetchImpl: fetchImpl as typeof globalThis.fetch,
    });

    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result).toMatchObject({
      taskId: "dispatch-1:task-1",
      status: "review",
      attempts: 2,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("returns summary output when summary mode is enabled", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ tasks: [{ id: "dispatch-1:task-1", status: "in_progress" }] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ tasks: [{ id: "dispatch-1:task-1", status: "merged" }] }),
      });

    const resultPromise = watchTask({
      dispatcherUrl: "http://127.0.0.1:8787",
      taskId: "dispatch-1:task-1",
      intervalMs: 1,
      timeoutMs: 100,
      summary: true,
      fetchImpl: fetchImpl as typeof globalThis.fetch,
    });

    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result).toMatchObject({
      taskId: "dispatch-1:task-1",
      status: "merged",
      attempts: 2,
    });
    expect(result).not.toHaveProperty("task");
    expect(result).not.toHaveProperty("snapshot");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("returns full output when summary mode is disabled", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ tasks: [{ id: "dispatch-1:task-1", status: "in_progress" }] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            tasks: [{ id: "dispatch-1:task-1", status: "failed", extra: "data" }],
            extra: "snapshot",
          }),
      });

    const resultPromise = watchTask({
      dispatcherUrl: "http://127.0.0.1:8787",
      taskId: "dispatch-1:task-1",
      intervalMs: 1,
      timeoutMs: 100,
      summary: false,
      fetchImpl: fetchImpl as typeof globalThis.fetch,
    });

    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result).toMatchObject({
      taskId: "dispatch-1:task-1",
      status: "failed",
      attempts: 2,
    });
    expect(result).toHaveProperty("task");
    expect(result).toHaveProperty("snapshot");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  describe("stateDir", () => {
    it("polls local state dir until task reaches terminal status", async () => {
      const stateDir = createTempStateDir();
      tempDirs.push(stateDir);

      writeState(stateDir, {
        version: 1,
        tasks: [{ id: "dispatch-2:task-1", status: "in_progress" }],
      });

      const resultPromise = watchTask({
        dispatcherUrl: "http://127.0.0.1:8787",
        stateDir,
        taskId: "dispatch-2:task-1",
        intervalMs: 10,
        timeoutMs: 1000,
      });

      await vi.advanceTimersByTimeAsync(5);
      writeState(stateDir, {
        version: 1,
        tasks: [{ id: "dispatch-2:task-1", status: "review" }],
      });

      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result).toMatchObject({
        taskId: "dispatch-2:task-1",
        status: "review",
      });
    });

    it("returns summary output with stateDir when summary mode is enabled", async () => {
      const stateDir = createTempStateDir();
      tempDirs.push(stateDir);

      writeState(stateDir, {
        version: 1,
        tasks: [{ id: "dispatch-2:task-2", status: "in_progress" }],
      });

      const resultPromise = watchTask({
        dispatcherUrl: "http://127.0.0.1:8787",
        stateDir,
        taskId: "dispatch-2:task-2",
        intervalMs: 10,
        timeoutMs: 1000,
        summary: true,
      });

      await vi.advanceTimersByTimeAsync(5);
      writeState(stateDir, {
        version: 1,
        tasks: [{ id: "dispatch-2:task-2", status: "merged" }],
      });

      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result).toMatchObject({
        taskId: "dispatch-2:task-2",
        status: "merged",
      });
      expect(result).not.toHaveProperty("task");
      expect(result).not.toHaveProperty("snapshot");
    });

    it("returns full output with stateDir when summary mode is disabled", async () => {
      const stateDir = createTempStateDir();
      tempDirs.push(stateDir);

      writeState(stateDir, {
        version: 1,
        tasks: [{ id: "dispatch-2:task-3", status: "in_progress" }],
        events: [],
      });

      const resultPromise = watchTask({
        dispatcherUrl: "http://127.0.0.1:8787",
        stateDir,
        taskId: "dispatch-2:task-3",
        intervalMs: 10,
        timeoutMs: 1000,
        summary: false,
      });

      await vi.advanceTimersByTimeAsync(5);
      writeState(stateDir, {
        version: 1,
        tasks: [{ id: "dispatch-2:task-3", status: "failed", extra: "data" }],
        events: [],
      });

      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result).toMatchObject({
        taskId: "dispatch-2:task-3",
        status: "failed",
      });
      expect(result).toHaveProperty("task");
      expect(result).toHaveProperty("snapshot");
    });

    it("throws timeout when stateDir task never reaches terminal status", async () => {
      const stateDir = createTempStateDir();
      tempDirs.push(stateDir);

      writeState(stateDir, {
        version: 1,
        tasks: [{ id: "dispatch-2:task-4", status: "in_progress" }],
      });

      const resultPromise = watchTask({
        dispatcherUrl: "http://127.0.0.1:8787",
        stateDir,
        taskId: "dispatch-2:task-4",
        intervalMs: 10,
        timeoutMs: 50,
      });

      resultPromise.catch(() => {});

      await vi.advanceTimersByTimeAsync(100);

      await expect(resultPromise).rejects.toThrow("watch timeout: dispatch-2:task-4");
    });
  });
});
