import fs from "node:fs";
import path from "node:path";
import os from "node:os";

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

import type { InspectResult, InspectSummaryResult } from "../src/types.js";

import { runInspect } from "../src/inspect.js";

const mockSnapshot = {
  tasks: [
    {
      id: "dispatch-1:task-1",
      status: "review",
      title: "Test Task",
      repo: "owner/repo",
      branchName: "feature/test",
      assignedWorkerId: "worker-1",
    },
  ],
  assignments: [
    {
      taskId: "dispatch-1:task-1",
      workerId: "worker-1",
      status: "review",
      repo: "owner/repo",
      branchName: "feature/test",
    },
  ],
  reviews: [
    {
      taskId: "dispatch-1:task-1",
      decision: "merge",
      actor: "reviewer-1",
      decidedAt: "2026-03-29T01:00:00Z",
      reviewMaterial: {
        repo: "owner/repo",
        title: "Test Task",
        changedFiles: ["src/index.ts"],
        selfTestPassed: true,
        checks: [{ command: "pnpm test" }, { command: "pnpm typecheck" }],
        pullRequest: {
          number: 1,
          url: "https://github.com/owner/repo/pull/1",
          headBranch: "feature/test",
          status: "opened",
        },
      },
    },
  ],
  pullRequests: [
    {
      taskId: "dispatch-1:task-1",
      url: "https://github.com/owner/repo/pull/1",
      status: "opened",
      number: 1,
      headBranch: "feature/test",
    },
  ],
  events: [
    {
      taskId: "dispatch-1:task-1",
      type: "task_created",
      at: "2026-03-29T00:00:00Z",
      summary: "Task created",
    },
    {
      taskId: "dispatch-1:task-1",
      type: "task_assigned",
      at: "2026-03-29T00:01:00Z",
      summary: "Assigned to worker-1",
    },
  ],
};

describe("inspect", () => {
  it("retrieves task and related material from dispatcher snapshot", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(JSON.stringify(mockSnapshot)),
    });

    const result = (await runInspect({
      dispatcherUrl: "http://127.0.0.1:8787",
      taskId: "dispatch-1:task-1",
      fetchImpl: mockFetch,
    })) as InspectResult;

    expect(result.taskId).toBe("dispatch-1:task-1");
    expect(result.task).toMatchObject({
      id: "dispatch-1:task-1",
      status: "review",
    });
    expect(result.assignment).toMatchObject({
      taskId: "dispatch-1:task-1",
      workerId: "worker-1",
    });
    expect(result.reviews).toHaveLength(1);
    expect(result.reviews[0]).toMatchObject({
      taskId: "dispatch-1:task-1",
      decision: "merge",
    });
    expect(result.pullRequest).toMatchObject({
      taskId: "dispatch-1:task-1",
    });
    expect(result.events).toHaveLength(2);
    expect(result.events[0]).toMatchObject({
      taskId: "dispatch-1:task-1",
      type: "task_created",
    });
    expect(result.snapshot).toEqual(mockSnapshot);
  });

  it("throws error when task is not found", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(JSON.stringify({ tasks: [] })),
    });

    await expect(
      runInspect({
        dispatcherUrl: "http://127.0.0.1:8787",
        taskId: "nonexistent:task-1",
        fetchImpl: mockFetch,
      }),
    ).rejects.toThrow("task not found: nonexistent:task-1");
  });

  it("handles missing optional snapshot fields", async () => {
    const minimalSnapshot = {
      tasks: [
        {
          id: "dispatch-1:task-1",
          status: "pending",
        },
      ],
    };

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(JSON.stringify(minimalSnapshot)),
    });

    const result = (await runInspect({
      dispatcherUrl: "http://127.0.0.1:8787",
      taskId: "dispatch-1:task-1",
      fetchImpl: mockFetch,
    })) as InspectResult;

    expect(result.taskId).toBe("dispatch-1:task-1");
    expect(result.task).toMatchObject({ id: "dispatch-1:task-1" });
    expect(result.assignment).toBeNull();
    expect(result.reviews).toEqual([]);
    expect(result.pullRequest).toBeNull();
    expect(result.events).toEqual([]);
  });

  it("returns summary mode output with concise review material", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(JSON.stringify(mockSnapshot)),
    });

    const result = (await runInspect({
      dispatcherUrl: "http://127.0.0.1:8787",
      taskId: "dispatch-1:task-1",
      summary: true,
      fetchImpl: mockFetch,
    })) as InspectSummaryResult;

    expect(result.taskId).toBe("dispatch-1:task-1");
    expect(result.status).toBe("review");
    expect(result.branch).toBe("feature/test");
    expect(result.repo).toBe("owner/repo");
    expect(result.workerId).toBe("worker-1");
    expect(result.latestResultEvidence).toMatchObject({
      commit: "feature/test",
      pushStatus: "opened",
      testOutput: "pnpm test; pnpm typecheck",
    });
    expect(result.recentEvents).toHaveLength(2);
    expect(result.recentEvents[0]).toMatchObject({
      type: "task_assigned",
      at: "2026-03-29T00:01:00Z",
      summary: "Assigned to worker-1",
    });
    expect(result.reviewState).toMatchObject({
      decision: "merge",
      actor: "reviewer-1",
      at: "2026-03-29T01:00:00Z",
    });
    expect(result.pullRequestState).toMatchObject({
      url: "https://github.com/owner/repo/pull/1",
      status: "opened",
      number: 1,
    });
    expect(result).not.toHaveProperty("snapshot");
    expect(result).not.toHaveProperty("task");
  });

  it("summary mode handles missing optional fields gracefully", async () => {
    const minimalSnapshot = {
      tasks: [
        {
          id: "dispatch-2:task-2",
          status: "pending",
        },
      ],
    };

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(JSON.stringify(minimalSnapshot)),
    });

    const result = (await runInspect({
      dispatcherUrl: "http://127.0.0.1:8787",
      taskId: "dispatch-2:task-2",
      summary: true,
      fetchImpl: mockFetch,
    })) as InspectSummaryResult;

    expect(result.taskId).toBe("dispatch-2:task-2");
    expect(result.status).toBe("pending");
    expect(result.branch).toBeNull();
    expect(result.repo).toBeNull();
    expect(result.workerId).toBeNull();
    expect(result.latestResultEvidence).toMatchObject({
      commit: null,
      pushStatus: null,
      testOutput: null,
    });
    expect(result.recentEvents).toEqual([]);
    expect(result.reviewState).toBeNull();
    expect(result.pullRequestState).toBeNull();
  });

  it("summary mode extracts evidence from status_changed event for Trae tasks", async () => {
    const traeSnapshot = {
      tasks: [
        {
          id: "dispatch-3:trae-task-1",
          status: "review",
          branchName: "ai/trae/test-task",
          repo: "owner/repo",
        },
      ],
      assignments: [
        {
          taskId: "dispatch-3:trae-task-1",
          workerId: "trae-worker-1",
          status: "review",
          repo: "owner/repo",
        },
      ],
      reviews: [
        {
          taskId: "dispatch-3:trae-task-1",
          decision: null,
          at: "2026-03-29T02:00:00Z",
        },
      ],
      events: [
        {
          taskId: "dispatch-3:trae-task-1",
          type: "task_created",
          at: "2026-03-29T00:00:00Z",
          summary: "Task created",
        },
        {
          taskId: "dispatch-3:trae-task-1",
          type: "status_changed",
          at: "2026-03-29T01:00:00Z",
          payload: {
            from: "in_progress",
            to: "review",
            summary: "Task completed",
            test_output: "pnpm test\nPASS\npnpm typecheck\nPASS",
            github: {
              branch_name: "ai/trae/test-task",
              commit_sha: "abc123def456",
              push_status: "success",
              push_error: null,
              pr_number: null,
              pr_url: null,
            },
          },
        },
      ],
    };

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(JSON.stringify(traeSnapshot)),
    });

    const result = (await runInspect({
      dispatcherUrl: "http://127.0.0.1:8787",
      taskId: "dispatch-3:trae-task-1",
      summary: true,
      fetchImpl: mockFetch,
    })) as InspectSummaryResult;

    expect(result.taskId).toBe("dispatch-3:trae-task-1");
    expect(result.status).toBe("review");
    expect(result.branch).toBe("ai/trae/test-task");
    expect(result.latestResultEvidence).toMatchObject({
      commit: "abc123def456",
      pushStatus: "success",
      testOutput: "pnpm test\nPASS\npnpm typecheck\nPASS",
    });
  });

  it("summary mode prefers reviewMaterial over status_changed event", async () => {
    const mixedSnapshot = {
      tasks: [
        {
          id: "dispatch-4:task-1",
          status: "review",
          branchName: "feature/test",
          repo: "owner/repo",
        },
      ],
      assignments: [
        {
          taskId: "dispatch-4:task-1",
          workerId: "worker-1",
          status: "review",
          repo: "owner/repo",
        },
      ],
      reviews: [
        {
          taskId: "dispatch-4:task-1",
          decision: "merge",
          at: "2026-03-29T02:00:00Z",
          reviewMaterial: {
            pullRequest: {
              number: 1,
              url: "https://github.com/owner/repo/pull/1",
              headBranch: "feature/test-from-pr",
              status: "opened",
            },
            checks: [{ command: "pnpm test" }],
          },
        },
      ],
      events: [
        {
          taskId: "dispatch-4:task-1",
          type: "status_changed",
          at: "2026-03-29T01:00:00Z",
          payload: {
            from: "in_progress",
            to: "review",
            test_output: "from event",
            github: {
              commit_sha: "from-event-sha",
              push_status: "from-event-status",
            },
          },
        },
      ],
    };

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(JSON.stringify(mixedSnapshot)),
    });

    const result = (await runInspect({
      dispatcherUrl: "http://127.0.0.1:8787",
      taskId: "dispatch-4:task-1",
      summary: true,
      fetchImpl: mockFetch,
    })) as InspectSummaryResult;

    expect(result.latestResultEvidence).toMatchObject({
      commit: "feature/test-from-pr",
      pushStatus: "opened",
      testOutput: "pnpm test",
    });
  });

  it("summary mode returns last 5 events in reverse order", async () => {
    const manyEventsSnapshot = {
      tasks: [
        {
          id: "dispatch-3:task-3",
          status: "review",
        },
      ],
      events: [
        { taskId: "dispatch-3:task-3", type: "event_1", at: "2026-03-29T00:00:00Z", summary: "Event 1" },
        { taskId: "dispatch-3:task-3", type: "event_2", at: "2026-03-29T00:01:00Z", summary: "Event 2" },
        { taskId: "dispatch-3:task-3", type: "event_3", at: "2026-03-29T00:02:00Z", summary: "Event 3" },
        { taskId: "dispatch-3:task-3", type: "event_4", at: "2026-03-29T00:03:00Z", summary: "Event 4" },
        { taskId: "dispatch-3:task-3", type: "event_5", at: "2026-03-29T00:04:00Z", summary: "Event 5" },
        { taskId: "dispatch-3:task-3", type: "event_6", at: "2026-03-29T00:05:00Z", summary: "Event 6" },
        { taskId: "dispatch-3:task-3", type: "event_7", at: "2026-03-29T00:06:00Z", summary: "Event 7" },
      ],
    };

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(JSON.stringify(manyEventsSnapshot)),
    });

    const result = (await runInspect({
      dispatcherUrl: "http://127.0.0.1:8787",
      taskId: "dispatch-3:task-3",
      summary: true,
      fetchImpl: mockFetch,
    })) as InspectSummaryResult;

    expect(result.recentEvents).toHaveLength(5);
    expect(result.recentEvents[0].type).toBe("event_7");
    expect(result.recentEvents[4].type).toBe("event_3");
  });

  it("throws error when neither dispatcherUrl nor stateDir is provided", async () => {
    await expect(
      runInspect({
        taskId: "dispatch-1:task-1",
      }),
    ).rejects.toThrow("dispatcherUrl or stateDir is required");
  });

  describe("state-dir support", () => {
    let tempDir: string;

    beforeEach(() => {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "inspect-test-"));
    });

    afterEach(() => {
      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it("retrieves task from local state directory", async () => {
      const stateFilePath = path.join(tempDir, "runtime-state.json");
      fs.writeFileSync(stateFilePath, JSON.stringify(mockSnapshot, null, 2));

      const result = (await runInspect({
        stateDir: tempDir,
        taskId: "dispatch-1:task-1",
      })) as InspectResult;

      expect(result.taskId).toBe("dispatch-1:task-1");
      expect(result.task).toMatchObject({
        id: "dispatch-1:task-1",
        status: "review",
      });
      expect(result.assignment).toMatchObject({
        taskId: "dispatch-1:task-1",
        workerId: "worker-1",
      });
      expect(result.reviews).toHaveLength(1);
      expect(result.pullRequest).toMatchObject({
        taskId: "dispatch-1:task-1",
      });
      expect(result.events).toHaveLength(2);
    });

    it("returns summary mode output from local state directory", async () => {
      const stateFilePath = path.join(tempDir, "runtime-state.json");
      fs.writeFileSync(stateFilePath, JSON.stringify(mockSnapshot, null, 2));

      const result = (await runInspect({
        stateDir: tempDir,
        taskId: "dispatch-1:task-1",
        summary: true,
      })) as InspectSummaryResult;

      expect(result.taskId).toBe("dispatch-1:task-1");
      expect(result.status).toBe("review");
      expect(result.branch).toBe("feature/test");
      expect(result.repo).toBe("owner/repo");
      expect(result.workerId).toBe("worker-1");
      expect(result).not.toHaveProperty("snapshot");
    });

    it("throws error when task is not found in state directory", async () => {
      const stateFilePath = path.join(tempDir, "runtime-state.json");
      fs.writeFileSync(stateFilePath, JSON.stringify({ tasks: [] }, null, 2));

      await expect(
        runInspect({
          stateDir: tempDir,
          taskId: "nonexistent:task-1",
        }),
      ).rejects.toThrow("task not found: nonexistent:task-1");
    });

    it("handles missing state directory gracefully", async () => {
      const nonExistentDir = path.join(tempDir, "non-existent");

      await expect(
        runInspect({
          stateDir: nonExistentDir,
          taskId: "dispatch-1:task-1",
        }),
      ).rejects.toThrow("task not found: dispatch-1:task-1");
    });
  });
});
