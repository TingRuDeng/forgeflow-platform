import { describe, expect, it, vi } from "vitest";

import { runRedrive } from "../src/redrive.js";

const mockWorktreeMismatchSnapshot = {
  tasks: [
    {
      id: "dispatch-1:task-1",
      status: "failed",
      title: "Test Task",
      repo: "owner/repo",
      defaultBranch: "main",
      branchName: "feature/test",
      pool: "trae",
      allowedPaths: ["docs/**"],
      acceptance: ["pnpm typecheck", "git diff --check"],
    },
  ],
  assignments: [
    {
      taskId: "dispatch-1:task-1",
      workerId: "worker-1",
      pool: "trae",
      status: "failed",
      repo: "owner/repo",
      defaultBranch: "main",
      branchName: "feature/test",
      allowedPaths: ["docs/**"],
      targetWorkerId: "trae-remote-forgeflow",
      workerPrompt: "Custom worker prompt for this task",
      contextMarkdown: "# Task Context\n\nThis is the custom context for the redrive task.",
    },
  ],
  reviews: [],
  events: [
    {
      taskId: "dispatch-1:task-1",
      type: "task_created",
      at: "2026-03-29T00:00:00Z",
      summary: "Task created",
    },
    {
      taskId: "dispatch-1:task-1",
      type: "status_changed",
      at: "2026-03-29T01:00:00Z",
      payload: {
        from: "pending",
        to: "in_progress",
        summary: "Task started",
      },
    },
    {
      taskId: "dispatch-1:task-1",
      type: "status_changed",
      at: "2026-03-29T02:00:00Z",
      payload: {
        from: "in_progress",
        to: "failed",
        summary: "worktree_mismatch: expected workspace ai/trae/task-1 but got workspace different-worktree",
      },
    },
  ],
};

const mockBranchMismatchSnapshot = {
  tasks: [
    {
      id: "dispatch-1:task-2",
      status: "failed",
      title: "Branch Mismatch Task",
      repo: "owner/repo",
      defaultBranch: "main",
      branchName: "feature/branch-task",
      pool: "trae",
    },
  ],
  assignments: [
    {
      taskId: "dispatch-1:task-2",
      workerId: "worker-1",
      pool: "trae",
      status: "failed",
      repo: "owner/repo",
      defaultBranch: "main",
      branchName: "feature/branch-task",
      targetWorkerId: "trae-remote-forgeflow",
    },
  ],
  reviews: [],
  events: [
    {
      taskId: "dispatch-1:task-2",
      type: "status_changed",
      at: "2026-03-29T02:00:00Z",
      payload: {
        from: "in_progress",
        to: "failed",
        summary: "branch_mismatch: expected branch feature/branch-task but found different-branch",
      },
    },
  ],
};

const mockPreflightWorkspaceMismatchSnapshot = {
  tasks: [
    {
      id: "dispatch-1:task-3",
      status: "failed",
      title: "Preflight Task",
      repo: "owner/repo",
      defaultBranch: "main",
      branchName: "feature/preflight-task",
      pool: "trae",
    },
  ],
  assignments: [
    {
      taskId: "dispatch-1:task-3",
      workerId: "worker-1",
      pool: "trae",
      status: "failed",
      repo: "owner/repo",
      defaultBranch: "main",
      branchName: "feature/preflight-task",
      targetWorkerId: "trae-remote-forgeflow",
    },
  ],
  reviews: [],
  events: [
    {
      taskId: "dispatch-1:task-3",
      type: "status_changed",
      at: "2026-03-29T02:00:00Z",
      payload: {
        from: "in_progress",
        to: "failed",
        summary: "preflight workspace mismatch: expected workspace ai/trae/task-3 but got workspace wrong-workspace",
      },
    },
  ],
};

describe("redrive", () => {
  it("redrives a worktree_mismatch failed task", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(JSON.stringify(mockWorktreeMismatchSnapshot)),
    });

    const dispatchMockFetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () =>
        Promise.resolve(
          JSON.stringify({
            dispatchId: "dispatch-redrive-1",
            taskIds: ["dispatch-64:redrive-abcd1234"],
            assignments: [],
          }),
        ),
    });

    let fetchCallCount = 0;
    const combinedFetch = async (url: string, init?: RequestInit) => {
      fetchCallCount++;
      if (fetchCallCount === 1) {
        return mockFetch(url, init);
      }
      return dispatchMockFetch(url, init);
    };

    const result = await runRedrive({
      dispatcherUrl: "http://127.0.0.1:8787",
      taskId: "dispatch-1:task-1",
      fetchImpl: combinedFetch as typeof globalThis.fetch,
    });

    expect(result.originalTaskId).toBe("dispatch-1:task-1");
    expect(result.newTaskId).toBe("dispatch-64:redrive-abcd1234");
    expect(result.targetWorkerId).toBe("trae-remote-forgeflow");
    expect(result.failureSummary).toContain("worktree_mismatch");
    expect(result.continuationMode).toBe("continue");
    expect(result.continueFromTaskId).toBe("dispatch-1:task-1");
  });

  it("redrives a branch_mismatch failed task", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(JSON.stringify(mockBranchMismatchSnapshot)),
    });

    const dispatchMockFetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () =>
        Promise.resolve(
          JSON.stringify({
            dispatchId: "dispatch-redrive-2",
            taskIds: ["dispatch-65:redrive-xyz98765"],
            assignments: [],
          }),
        ),
    });

    let fetchCallCount = 0;
    const combinedFetch = async (url: string, init?: RequestInit) => {
      fetchCallCount++;
      if (fetchCallCount === 1) {
        return mockFetch(url, init);
      }
      return dispatchMockFetch(url, init);
    };

    const result = await runRedrive({
      dispatcherUrl: "http://127.0.0.1:8787",
      taskId: "dispatch-1:task-2",
      fetchImpl: combinedFetch as typeof globalThis.fetch,
    });

    expect(result.originalTaskId).toBe("dispatch-1:task-2");
    expect(result.newTaskId).toBe("dispatch-65:redrive-xyz98765");
    expect(result.targetWorkerId).toBe("trae-remote-forgeflow");
    expect(result.failureSummary).toContain("branch_mismatch");
    expect(result.continuationMode).toBe("continue");
    expect(result.continueFromTaskId).toBe("dispatch-1:task-2");
  });

  it("redrives a preflight_workspace_mismatch failed task", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(JSON.stringify(mockPreflightWorkspaceMismatchSnapshot)),
    });

    const dispatchMockFetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () =>
        Promise.resolve(
          JSON.stringify({
            dispatchId: "dispatch-redrive-3",
            taskIds: ["dispatch-66:redrive-uvw55555"],
            assignments: [],
          }),
        ),
    });

    let fetchCallCount = 0;
    const combinedFetch = async (url: string, init?: RequestInit) => {
      fetchCallCount++;
      if (fetchCallCount === 1) {
        return mockFetch(url, init);
      }
      return dispatchMockFetch(url, init);
    };

    const result = await runRedrive({
      dispatcherUrl: "http://127.0.0.1:8787",
      taskId: "dispatch-1:task-3",
      fetchImpl: combinedFetch as typeof globalThis.fetch,
    });

    expect(result.originalTaskId).toBe("dispatch-1:task-3");
    expect(result.newTaskId).toBe("dispatch-66:redrive-uvw55555");
    expect(result.targetWorkerId).toBe("trae-remote-forgeflow");
    expect(result.failureSummary).toContain("preflight workspace mismatch");
    expect(result.continuationMode).toBe("continue");
    expect(result.continueFromTaskId).toBe("dispatch-1:task-3");
  });

  it("throws error when task is not found", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(JSON.stringify({ tasks: [] })),
    });

    await expect(
      runRedrive({
        dispatcherUrl: "http://127.0.0.1:8787",
        taskId: "nonexistent:task-1",
        fetchImpl: mockFetch as typeof globalThis.fetch,
      }),
    ).rejects.toThrow("task not found: nonexistent:task-1");
  });

  it("throws error when task is not in failed or blocked+rework state", async () => {
    const snapshot = {
      tasks: [
        {
          id: "dispatch-1:task-1",
          status: "review",
          title: "Test Task",
        },
      ],
      assignments: [],
      reviews: [],
      events: [],
    };

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(JSON.stringify(snapshot)),
    });

    await expect(
      runRedrive({
        dispatcherUrl: "http://127.0.0.1:8787",
        taskId: "dispatch-1:task-1",
        fetchImpl: mockFetch as typeof globalThis.fetch,
      }),
    ).rejects.toThrow('task dispatch-1:task-1 is in "review" state and is not redriveable');
  });

  it("throws error when task has no failure summary in events", async () => {
    const snapshot = {
      tasks: [
        {
          id: "dispatch-1:task-1",
          status: "failed",
          title: "Test Task",
        },
      ],
      assignments: [],
      reviews: [],
      events: [
        {
          taskId: "dispatch-1:task-1",
          type: "status_changed",
          at: "2026-03-29T02:00:00Z",
          payload: {
            from: "in_progress",
            to: "failed",
          },
        },
      ],
    };

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(JSON.stringify(snapshot)),
    });

    await expect(
      runRedrive({
        dispatcherUrl: "http://127.0.0.1:8787",
        taskId: "dispatch-1:task-1",
        fetchImpl: mockFetch as typeof globalThis.fetch,
      }),
    ).rejects.toThrow("task dispatch-1:task-1 has no failure summary to analyze");
  });

  it("throws error when failure reason is not redriveable", async () => {
    const snapshot = {
      tasks: [
        {
          id: "dispatch-1:task-1",
          status: "failed",
          title: "Test Task",
        },
      ],
      assignments: [],
      reviews: [],
      events: [
        {
          taskId: "dispatch-1:task-1",
          type: "status_changed",
          at: "2026-03-29T02:00:00Z",
          payload: {
            from: "in_progress",
            to: "failed",
            summary: "some unrelated error occurred",
          },
        },
      ],
    };

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(JSON.stringify(snapshot)),
    });

    await expect(
      runRedrive({
        dispatcherUrl: "http://127.0.0.1:8787",
        taskId: "dispatch-1:task-1",
        fetchImpl: mockFetch as typeof globalThis.fetch,
      }),
    ).rejects.toThrow("task dispatch-1:task-1 failed for a non-redriveable reason");
  });

  it("preserves acceptance, workerPrompt, and contextMarkdown from original task and uses new branchName", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(JSON.stringify(mockWorktreeMismatchSnapshot)),
    });

    const dispatchMockFetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () =>
        Promise.resolve(
          JSON.stringify({
            dispatchId: "dispatch-redrive-preserve",
            taskIds: ["dispatch-69:redrive-preserve"],
            assignments: [],
          }),
        ),
    });

    let fetchCallCount = 0;
    let capturedPayload: unknown = null;
    const combinedFetch = async (url: string, init?: RequestInit) => {
      fetchCallCount++;
      if (fetchCallCount === 1) {
        return mockFetch(url, init);
      }
      if (init?.body) {
        capturedPayload = JSON.parse(init.body as string);
      }
      return dispatchMockFetch(url, init);
    };

    await runRedrive({
      dispatcherUrl: "http://127.0.0.1:8787",
      taskId: "dispatch-1:task-1",
      fetchImpl: combinedFetch as typeof globalThis.fetch,
    });

    expect(capturedPayload).not.toBeNull();
    const payload = capturedPayload as { tasks?: unknown[]; packages?: unknown[] };
    expect(payload.tasks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          acceptance: ["pnpm typecheck", "git diff --check"],
        }),
      ]),
    );
    expect(payload.packages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          contextMarkdown: "# Task Context\n\nThis is the custom context for the redrive task.",
        }),
      ]),
    );
    const preservedPackage = (payload.packages as unknown[])[0] as Record<string, unknown>;
    expect(String(preservedPackage.workerPrompt ?? "")).toContain("Custom worker prompt for this task");
    expect(String(preservedPackage.workerPrompt ?? "")).toContain("## 任务完成");
    expect(String(preservedPackage.workerPrompt ?? "")).toContain("任务ID");

    const originalBranchName = "feature/test";
    const redriveTask = (payload.tasks as unknown[]).find((t: unknown) => {
      const task = t as Record<string, unknown>;
      return task.id && String(task.id).startsWith("redrive-");
    }) as Record<string, unknown> | undefined;
    expect(redriveTask).toBeDefined();
    expect(redriveTask?.branchName).not.toBe(originalBranchName);
    expect(redriveTask?.branchName).toMatch(new RegExp(`^${originalBranchName}-redrive-[a-f0-9]{8}$`));
    expect(redriveTask?.continuationMode).toBe("continue");
    expect(redriveTask?.continueFromTaskId).toBe("dispatch-1:task-1");
  });

  it("generates new branchName with -redrive- suffix", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(JSON.stringify(mockWorktreeMismatchSnapshot)),
    });

    const dispatchMockFetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () =>
        Promise.resolve(
          JSON.stringify({
            dispatchId: "dispatch-redrive-branch",
            taskIds: ["dispatch-70:redrive-branch"],
            assignments: [],
          }),
        ),
    });

    let fetchCallCount = 0;
    let capturedPayload: unknown = null;
    const combinedFetch = async (url: string, init?: RequestInit) => {
      fetchCallCount++;
      if (fetchCallCount === 1) {
        return mockFetch(url, init);
      }
      if (init?.body) {
        capturedPayload = JSON.parse(init.body as string);
      }
      return dispatchMockFetch(url, init);
    };

    await runRedrive({
      dispatcherUrl: "http://127.0.0.1:8787",
      taskId: "dispatch-1:task-1",
      fetchImpl: combinedFetch as typeof globalThis.fetch,
    });

    expect(capturedPayload).not.toBeNull();
    const payload = capturedPayload as { tasks?: unknown[] };
    const originalBranchName = "feature/test";

    const taskPayload = (payload.tasks as unknown[]).find((t: unknown) => {
      const task = t as Record<string, unknown>;
      return task.id && String(task.id).startsWith("redrive-");
    }) as Record<string, unknown> | undefined;
    expect(taskPayload).toBeDefined();
    expect(taskPayload?.branchName).toMatch(/^feature\/test-redrive-[a-f0-9]{8}$/);
    expect(taskPayload?.branchName).not.toBe(originalBranchName);
  });

  it("throws error when dispatch response is missing taskIds", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(JSON.stringify(mockWorktreeMismatchSnapshot)),
    });

    const dispatchMockFetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () =>
        Promise.resolve(
          JSON.stringify({
            dispatchId: "dispatch-redrive-5",
            taskIds: [],
            assignments: [],
          }),
        ),
    });

    let fetchCallCount = 0;
    const combinedFetch = async (url: string, init?: RequestInit) => {
      fetchCallCount++;
      if (fetchCallCount === 1) {
        return mockFetch(url, init);
      }
      return dispatchMockFetch(url, init);
    };

    await expect(
      runRedrive({
        dispatcherUrl: "http://127.0.0.1:8787",
        taskId: "dispatch-1:task-1",
        fetchImpl: combinedFetch as typeof globalThis.fetch,
      }),
    ).rejects.toThrow("dispatch response missing taskIds for redrive of dispatch-1:task-1");
  });

  it("throws error when dispatch response has null taskIds", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(JSON.stringify(mockWorktreeMismatchSnapshot)),
    });

    const dispatchMockFetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () =>
        Promise.resolve(
          JSON.stringify({
            dispatchId: "dispatch-redrive-6",
            taskIds: null,
            assignments: [],
          }),
        ),
    });

    let fetchCallCount = 0;
    const combinedFetch = async (url: string, init?: RequestInit) => {
      fetchCallCount++;
      if (fetchCallCount === 1) {
        return mockFetch(url, init);
      }
      return dispatchMockFetch(url, init);
    };

    await expect(
      runRedrive({
        dispatcherUrl: "http://127.0.0.1:8787",
        taskId: "dispatch-1:task-1",
        fetchImpl: combinedFetch as typeof globalThis.fetch,
      }),
    ).rejects.toThrow("dispatch response missing taskIds for redrive of dispatch-1:task-1");
  });

  it("uses latest status_changed to failed event when multiple exist", async () => {
    const snapshot = {
      tasks: [
        {
          id: "dispatch-1:task-1",
          status: "failed",
          title: "Test Task",
          repo: "owner/repo",
          defaultBranch: "main",
          branchName: "feature/test",
          pool: "trae",
        },
      ],
      assignments: [
        {
          taskId: "dispatch-1:task-1",
          workerId: "worker-1",
          pool: "trae",
          status: "failed",
          repo: "owner/repo",
          defaultBranch: "main",
          branchName: "feature/test",
          targetWorkerId: "trae-remote-forgeflow",
        },
      ],
      reviews: [],
      events: [
        {
          taskId: "dispatch-1:task-1",
          type: "status_changed",
          at: "2026-03-29T01:00:00Z",
          payload: {
            from: "pending",
            to: "in_progress",
            summary: "First failure that should be ignored",
          },
        },
        {
          taskId: "dispatch-1:task-1",
          type: "status_changed",
          at: "2026-03-29T02:00:00Z",
          payload: {
            from: "in_progress",
            to: "failed",
            summary: "worktree_mismatch: latest failure event",
          },
        },
        {
          taskId: "dispatch-1:task-1",
          type: "status_changed",
          at: "2026-03-29T03:00:00Z",
          payload: {
            from: "failed",
            to: "in_progress",
            summary: "Retrying after first failure",
          },
        },
      ],
    };

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(JSON.stringify(snapshot)),
    });

    const dispatchMockFetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () =>
        Promise.resolve(
          JSON.stringify({
            dispatchId: "dispatch-redrive-7",
            taskIds: ["dispatch-68:redrive-latest"],
            assignments: [],
          }),
        ),
    });

    let fetchCallCount = 0;
    const combinedFetch = async (url: string, init?: RequestInit) => {
      fetchCallCount++;
      if (fetchCallCount === 1) {
        return mockFetch(url, init);
      }
      return dispatchMockFetch(url, init);
    };

    const result = await runRedrive({
      dispatcherUrl: "http://127.0.0.1:8787",
      taskId: "dispatch-1:task-1",
      fetchImpl: combinedFetch as typeof globalThis.fetch,
    });

    expect(result.failureSummary).toContain("latest failure event");
  });

  it("redrives a blocked task with rework decision", async () => {
    const snapshot = {
      tasks: [
        {
          id: "dispatch-1:task-rework",
          status: "blocked",
          title: "Rework Task",
          repo: "owner/repo",
          defaultBranch: "main",
          branchName: "feature/rework-test",
          pool: "trae",
          allowedPaths: ["src/**"],
          acceptance: ["pnpm test"],
        },
      ],
      assignments: [
        {
          taskId: "dispatch-1:task-rework",
          workerId: "worker-1",
          pool: "trae",
          status: "blocked",
          repo: "owner/repo",
          defaultBranch: "main",
          branchName: "feature/rework-test",
          allowedPaths: ["src/**"],
          targetWorkerId: "trae-remote-forgeflow",
          workerPrompt: "Custom worker prompt",
          contextMarkdown: "# Context\n\nRework task.",
        },
      ],
      reviews: [
        {
          taskId: "dispatch-1:task-rework",
          decision: "rework",
          actor: "reviewer",
          notes: "please fix the type error",
          decidedAt: "2026-03-29T10:00:00Z",
        },
      ],
      events: [
        {
          taskId: "dispatch-1:task-rework",
          type: "status_changed",
          at: "2026-03-29T01:00:00Z",
          payload: {
            from: "review",
            to: "blocked",
          },
        },
      ],
    };

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(JSON.stringify(snapshot)),
    });

    const dispatchMockFetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () =>
        Promise.resolve(
          JSON.stringify({
            dispatchId: "dispatch-redrive-rework",
            taskIds: ["dispatch-70:redrive-rework1234"],
            assignments: [],
          }),
        ),
    });

    let fetchCallCount = 0;
    const combinedFetch = async (url: string, init?: RequestInit) => {
      fetchCallCount++;
      if (fetchCallCount === 1) {
        return mockFetch(url, init);
      }
      return dispatchMockFetch(url, init);
    };

    const result = await runRedrive({
      dispatcherUrl: "http://127.0.0.1:8787",
      taskId: "dispatch-1:task-rework",
      fetchImpl: combinedFetch as typeof globalThis.fetch,
    });

    expect(result.originalTaskId).toBe("dispatch-1:task-rework");
    expect(result.newTaskId).toBe("dispatch-70:redrive-rework1234");
    expect(result.targetWorkerId).toBe("trae-remote-forgeflow");
    expect(result.failureSummary).toContain("rework:");
    expect(result.continuationMode).toBe("continue");
    expect(result.continueFromTaskId).toBe("dispatch-1:task-rework");
  });

  it("throws error when blocked task has non-rework decision", async () => {
    const snapshot = {
      tasks: [
        {
          id: "dispatch-1:task-blocked-merge",
          status: "blocked",
          title: "Blocked Task",
          repo: "owner/repo",
          defaultBranch: "main",
          branchName: "feature/blocked-merge",
          pool: "trae",
        },
      ],
      assignments: [],
      reviews: [
        {
          taskId: "dispatch-1:task-blocked-merge",
          decision: "merge",
          actor: "reviewer",
          notes: "looks good but needs more tests",
          decidedAt: "2026-03-29T10:00:00Z",
        },
      ],
      events: [],
    };

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(JSON.stringify(snapshot)),
    });

    await expect(
      runRedrive({
        dispatcherUrl: "http://127.0.0.1:8787",
        taskId: "dispatch-1:task-blocked-merge",
        fetchImpl: mockFetch as typeof globalThis.fetch,
      }),
    ).rejects.toThrow('task dispatch-1:task-blocked-merge is blocked but latest review decision is "merge" (only "rework" is redriveable)');
  });

  it("uses parsed review timestamps when UTC and local-offset decisions are mixed", async () => {
    const snapshot = {
      tasks: [
        {
          id: "dispatch-1:task-mixed-review-times",
          status: "blocked",
          title: "Mixed Review Time Task",
          repo: "owner/repo",
          defaultBranch: "main",
          branchName: "feature/mixed-review-times",
          pool: "trae",
        },
      ],
      assignments: [],
      reviews: [
        {
          taskId: "dispatch-1:task-mixed-review-times",
          decision: "rework",
          actor: "reviewer-a",
          notes: "older local-offset rework note",
          decidedAt: "2026-03-29T08:00:00+08:00",
        },
        {
          taskId: "dispatch-1:task-mixed-review-times",
          decision: "merge",
          actor: "reviewer-b",
          notes: "newer UTC merge note",
          decidedAt: "2026-03-29T00:30:00Z",
        },
      ],
      events: [],
    };

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(JSON.stringify(snapshot)),
    });

    await expect(
      runRedrive({
        dispatcherUrl: "http://127.0.0.1:8787",
        taskId: "dispatch-1:task-mixed-review-times",
        fetchImpl: mockFetch as typeof globalThis.fetch,
      }),
    ).rejects.toThrow('task dispatch-1:task-mixed-review-times is blocked but latest review decision is "merge" (only "rework" is redriveable)');
  });

  it("blocked+rework redrive generates payload with continuation fields", async () => {
    const snapshot = {
      tasks: [
        {
          id: "dispatch-1:task-cont-rework",
          status: "blocked",
          title: "Continuation Rework Task",
          repo: "owner/repo",
          defaultBranch: "main",
          branchName: "feature/cont-rework",
          pool: "trae",
          allowedPaths: ["src/**"],
          acceptance: ["pnpm test"],
        },
      ],
      assignments: [
        {
          taskId: "dispatch-1:task-cont-rework",
          workerId: "worker-1",
          pool: "trae",
          status: "blocked",
          repo: "owner/repo",
          defaultBranch: "main",
          branchName: "feature/cont-rework",
          allowedPaths: ["src/**"],
          targetWorkerId: "trae-remote-forgeflow",
          workerPrompt: "Rework prompt",
          contextMarkdown: "# Context\n\nContinue rework.",
        },
      ],
      reviews: [
        {
          taskId: "dispatch-1:task-cont-rework",
          decision: "rework",
          actor: "reviewer",
          notes: "fix the bug",
          decidedAt: "2026-03-29T10:00:00Z",
        },
      ],
      events: [],
    };

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(JSON.stringify(snapshot)),
    });

    const dispatchMockFetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () =>
        Promise.resolve(
          JSON.stringify({
            dispatchId: "dispatch-cont-rework",
            taskIds: ["dispatch-71:redrive-crework-abcd"],
            assignments: [],
          }),
        ),
    });

    let fetchCallCount = 0;
    let capturedPayload: unknown = null;
    const combinedFetch = async (url: string, init?: RequestInit) => {
      fetchCallCount++;
      if (fetchCallCount === 1) {
        return mockFetch(url, init);
      }
      if (init?.body) {
        capturedPayload = JSON.parse(init.body as string);
      }
      return dispatchMockFetch(url, init);
    };

    await runRedrive({
      dispatcherUrl: "http://127.0.0.1:8787",
      taskId: "dispatch-1:task-cont-rework",
      fetchImpl: combinedFetch as typeof globalThis.fetch,
    });

    expect(capturedPayload).not.toBeNull();
    const payload = capturedPayload as { tasks?: unknown[]; packages?: unknown[] };

    const redriveTask = (payload.tasks as unknown[]).find((t: unknown) => {
      const task = t as Record<string, unknown>;
      return task.id && String(task.id).startsWith("redrive-");
    }) as Record<string, unknown> | undefined;
    expect(redriveTask).toBeDefined();
    expect(redriveTask?.continuationMode).toBe("continue");
    expect(redriveTask?.continueFromTaskId).toBe("dispatch-1:task-cont-rework");

    const originalBranchName = "feature/cont-rework";
    expect(redriveTask?.branchName).toMatch(new RegExp(`^${originalBranchName}-redrive-[a-f0-9]{8}$`));
  });

  it("blocked+rework redrive injects rework notes into workerPrompt and contextMarkdown", async () => {
    const snapshot = {
      tasks: [
        {
          id: "dispatch-1:task-rework-notes",
          status: "blocked",
          title: "Rework Notes Task",
          repo: "owner/repo",
          defaultBranch: "main",
          branchName: "feature/rework-notes-test",
          pool: "trae",
          allowedPaths: ["src/**"],
          acceptance: ["pnpm test"],
        },
      ],
      assignments: [
        {
          taskId: "dispatch-1:task-rework-notes",
          workerId: "worker-1",
          pool: "trae",
          status: "blocked",
          repo: "owner/repo",
          defaultBranch: "main",
          branchName: "feature/rework-notes-test",
          allowedPaths: ["src/**"],
          targetWorkerId: "trae-remote-forgeflow",
          workerPrompt: "Original worker prompt",
          contextMarkdown: "# Original Context",
        },
      ],
      reviews: [
        {
          taskId: "dispatch-1:task-rework-notes",
          decision: "rework",
          actor: "reviewer",
          notes: "Please refactor the authentication logic to use the new OAuth2 module",
          decidedAt: "2026-03-29T12:00:00Z",
        },
      ],
      events: [],
    };

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(JSON.stringify(snapshot)),
    });

    const dispatchMockFetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () =>
        Promise.resolve(
          JSON.stringify({
            dispatchId: "dispatch-redrive-rework-notes",
            taskIds: ["dispatch-72:redrive-rework-notes"],
            assignments: [],
          }),
        ),
    });

    let fetchCallCount = 0;
    let capturedPayload: unknown = null;
    const combinedFetch = async (url: string, init?: RequestInit) => {
      fetchCallCount++;
      if (fetchCallCount === 1) {
        return mockFetch(url, init);
      }
      if (init?.body) {
        capturedPayload = JSON.parse(init.body as string);
      }
      return dispatchMockFetch(url, init);
    };

    await runRedrive({
      dispatcherUrl: "http://127.0.0.1:8787",
      taskId: "dispatch-1:task-rework-notes",
      fetchImpl: combinedFetch as typeof globalThis.fetch,
    });

    expect(capturedPayload).not.toBeNull();
    const payload = capturedPayload as { tasks?: unknown[]; packages?: unknown[] };

    const pkg = (payload.packages as unknown[])[0] as Record<string, unknown> | undefined;
    expect(pkg).toBeDefined();

    const workerPrompt = pkg?.workerPrompt as string;
    expect(workerPrompt).toContain("Original worker prompt");
    expect(workerPrompt).toContain("## Rework Notes");
    expect(workerPrompt).toContain("Please refactor the authentication logic to use the new OAuth2 module");

    const contextMarkdown = pkg?.contextMarkdown as string;
    expect(contextMarkdown).toContain("# Original Context");
    expect(contextMarkdown).toContain("## Rework Notes");
    expect(contextMarkdown).toContain("Please refactor the authentication logic to use the new OAuth2 module");
  });

  it("failed redrive does not inject rework notes", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(JSON.stringify(mockWorktreeMismatchSnapshot)),
    });

    const dispatchMockFetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () =>
        Promise.resolve(
          JSON.stringify({
            dispatchId: "dispatch-redrive-failed-no-rework",
            taskIds: ["dispatch-73:redrive-failed-no-rework"],
            assignments: [],
          }),
        ),
    });

    let fetchCallCount = 0;
    let capturedPayload: unknown = null;
    const combinedFetch = async (url: string, init?: RequestInit) => {
      fetchCallCount++;
      if (fetchCallCount === 1) {
        return mockFetch(url, init);
      }
      if (init?.body) {
        capturedPayload = JSON.parse(init.body as string);
      }
      return dispatchMockFetch(url, init);
    };

    await runRedrive({
      dispatcherUrl: "http://127.0.0.1:8787",
      taskId: "dispatch-1:task-1",
      fetchImpl: combinedFetch as typeof globalThis.fetch,
    });

    expect(capturedPayload).not.toBeNull();
    const payload = capturedPayload as { packages?: unknown[] };

    const pkg = (payload.packages as unknown[])[0] as Record<string, unknown> | undefined;
    expect(pkg).toBeDefined();

    const workerPrompt = pkg?.workerPrompt as string;
    expect(workerPrompt).toContain("Custom worker prompt for this task");
    expect(workerPrompt).toContain("## 任务完成");
    expect(workerPrompt).toContain("任务ID");
    expect(workerPrompt).not.toContain("Rework Notes");

    const contextMarkdown = pkg?.contextMarkdown as string;
    expect(contextMarkdown).toBe("# Task Context\n\nThis is the custom context for the redrive task.");
    expect(contextMarkdown).not.toContain("Rework Notes");
  });

  it("blocked+rework with empty notes does not inject empty rework section", async () => {
    const snapshot = {
      tasks: [
        {
          id: "dispatch-1:task-empty-notes",
          status: "blocked",
          title: "Empty Notes Task",
          repo: "owner/repo",
          defaultBranch: "main",
          branchName: "feature/empty-notes",
          pool: "trae",
          allowedPaths: ["src/**"],
          acceptance: ["pnpm test"],
        },
      ],
      assignments: [
        {
          taskId: "dispatch-1:task-empty-notes",
          workerId: "worker-1",
          pool: "trae",
          status: "blocked",
          repo: "owner/repo",
          defaultBranch: "main",
          branchName: "feature/empty-notes",
          allowedPaths: ["src/**"],
          targetWorkerId: "trae-remote-forgeflow",
          workerPrompt: "Original prompt",
          contextMarkdown: "# Original",
        },
      ],
      reviews: [
        {
          taskId: "dispatch-1:task-empty-notes",
          decision: "rework",
          actor: "reviewer",
          notes: "",
          decidedAt: "2026-03-29T12:00:00Z",
        },
      ],
      events: [],
    };

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(JSON.stringify(snapshot)),
    });

    const dispatchMockFetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () =>
        Promise.resolve(
          JSON.stringify({
            dispatchId: "dispatch-redrive-empty-notes",
            taskIds: ["dispatch-74:redrive-empty-notes"],
            assignments: [],
          }),
        ),
    });

    let fetchCallCount = 0;
    let capturedPayload: unknown = null;
    const combinedFetch = async (url: string, init?: RequestInit) => {
      fetchCallCount++;
      if (fetchCallCount === 1) {
        return mockFetch(url, init);
      }
      if (init?.body) {
        capturedPayload = JSON.parse(init.body as string);
      }
      return dispatchMockFetch(url, init);
    };

    await runRedrive({
      dispatcherUrl: "http://127.0.0.1:8787",
      taskId: "dispatch-1:task-empty-notes",
      fetchImpl: combinedFetch as typeof globalThis.fetch,
    });

    expect(capturedPayload).not.toBeNull();
    const payload = capturedPayload as { packages?: unknown[] };

    const pkg = (payload.packages as unknown[])[0] as Record<string, unknown> | undefined;
    expect(pkg).toBeDefined();

    const workerPrompt = pkg?.workerPrompt as string;
    expect(workerPrompt).toContain("Original prompt");
    expect(workerPrompt).toContain("## 任务完成");
    expect(workerPrompt).toContain("任务ID");
    expect(workerPrompt).not.toContain("Rework Notes");

    const contextMarkdown = pkg?.contextMarkdown as string;
    expect(contextMarkdown).toBe("# Original");
    expect(contextMarkdown).not.toContain("Rework Notes");
  });

  it("blocked+rework with mustFix uses mustFix for redrive reason", async () => {
    const snapshot = {
      tasks: [
        {
          id: "dispatch-1:task-mustfix",
          status: "blocked",
          title: "MustFix Task",
          repo: "owner/repo",
          defaultBranch: "main",
          branchName: "feature/mustfix",
          pool: "trae",
          allowedPaths: ["src/**"],
          acceptance: ["pnpm test"],
        },
      ],
      assignments: [
        {
          taskId: "dispatch-1:task-mustfix",
          workerId: "worker-1",
          pool: "trae",
          status: "blocked",
          repo: "owner/repo",
          defaultBranch: "main",
          branchName: "feature/mustfix",
          allowedPaths: ["src/**"],
          targetWorkerId: "trae-remote-forgeflow",
          workerPrompt: "Original prompt",
          contextMarkdown: "# Original",
        },
      ],
      reviews: [
        {
          taskId: "dispatch-1:task-mustfix",
          decision: "rework",
          actor: "reviewer",
          notes: "fallback notes",
          decidedAt: "2026-03-29T12:00:00Z",
          evidence: {
            mustFix: ["补充失败场景覆盖", "修复类型错误"],
            reasonCode: "test_gap",
            canRedrive: true,
          },
        },
      ],
      events: [],
    };

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(JSON.stringify(snapshot)),
    });

    const dispatchMockFetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () =>
        Promise.resolve(
          JSON.stringify({
            dispatchId: "dispatch-redrive-mustfix",
            taskIds: ["dispatch-75:redrive-mustfix"],
            assignments: [],
          }),
        ),
    });

    let fetchCallCount = 0;
    let capturedPayload: unknown = null;
    const combinedFetch = async (url: string, init?: RequestInit) => {
      fetchCallCount++;
      if (fetchCallCount === 1) {
        return mockFetch(url, init);
      }
      if (init?.body) {
        capturedPayload = JSON.parse(init.body as string);
      }
      return dispatchMockFetch(url, init);
    };

    const result = await runRedrive({
      dispatcherUrl: "http://127.0.0.1:8787",
      taskId: "dispatch-1:task-mustfix",
      fetchImpl: combinedFetch as typeof globalThis.fetch,
    });

    expect(result.failureSummary).toBe("rework: 补充失败场景覆盖; 修复类型错误");
    expect(result.failureSummary).not.toContain("fallback notes");

    expect(capturedPayload).not.toBeNull();
    const payload = capturedPayload as { packages?: unknown[] };
    const pkg = (payload.packages as unknown[])[0] as Record<string, unknown> | undefined;
    const workerPrompt = pkg?.workerPrompt as string;
    expect(workerPrompt).toContain("补充失败场景覆盖");
    expect(workerPrompt).toContain("修复类型错误");
  });

  it("blocked+rework with reasonCode but no mustFix uses reasonCode for redrive reason", async () => {
    const snapshot = {
      tasks: [
        {
          id: "dispatch-1:task-reasoncode",
          status: "blocked",
          title: "ReasonCode Task",
          repo: "owner/repo",
          defaultBranch: "main",
          branchName: "feature/reasoncode",
          pool: "trae",
          allowedPaths: ["src/**"],
          acceptance: ["pnpm test"],
        },
      ],
      assignments: [
        {
          taskId: "dispatch-1:task-reasoncode",
          workerId: "worker-1",
          pool: "trae",
          status: "blocked",
          repo: "owner/repo",
          defaultBranch: "main",
          branchName: "feature/reasoncode",
          allowedPaths: ["src/**"],
          targetWorkerId: "trae-remote-forgeflow",
          workerPrompt: "Original prompt",
          contextMarkdown: "# Original",
        },
      ],
      reviews: [
        {
          taskId: "dispatch-1:task-reasoncode",
          decision: "rework",
          actor: "reviewer",
          notes: "fallback notes",
          decidedAt: "2026-03-29T12:00:00Z",
          evidence: {
            reasonCode: "test_gap",
            canRedrive: true,
          },
        },
      ],
      events: [],
    };

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(JSON.stringify(snapshot)),
    });

    const dispatchMockFetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () =>
        Promise.resolve(
          JSON.stringify({
            dispatchId: "dispatch-redrive-reasoncode",
            taskIds: ["dispatch-76:redrive-reasoncode"],
            assignments: [],
          }),
        ),
    });

    let fetchCallCount = 0;
    const combinedFetch = async (url: string, init?: RequestInit) => {
      fetchCallCount++;
      if (fetchCallCount === 1) {
        return mockFetch(url, init);
      }
      return dispatchMockFetch(url, init);
    };

    const result = await runRedrive({
      dispatcherUrl: "http://127.0.0.1:8787",
      taskId: "dispatch-1:task-reasoncode",
      fetchImpl: combinedFetch as typeof globalThis.fetch,
    });

    expect(result.failureSummary).toBe("rework: test_gap");
    expect(result.failureSummary).not.toContain("fallback notes");
  });

  it("blocked+rework with canRedrive=false throws error", async () => {
    const snapshot = {
      tasks: [
        {
          id: "dispatch-1:task-no-redrive",
          status: "blocked",
          title: "No Redrive Task",
          repo: "owner/repo",
          defaultBranch: "main",
          branchName: "feature/no-redrive",
          pool: "trae",
          allowedPaths: ["src/**"],
          acceptance: ["pnpm test"],
        },
      ],
      assignments: [
        {
          taskId: "dispatch-1:task-no-redrive",
          workerId: "worker-1",
          pool: "trae",
          status: "blocked",
          repo: "owner/repo",
          defaultBranch: "main",
          branchName: "feature/no-redrive",
          allowedPaths: ["src/**"],
          targetWorkerId: "trae-remote-forgeflow",
          workerPrompt: "Original prompt",
          contextMarkdown: "# Original",
        },
      ],
      reviews: [
        {
          taskId: "dispatch-1:task-no-redrive",
          decision: "rework",
          actor: "reviewer",
          notes: "this task should not be redriven",
          decidedAt: "2026-03-29T12:00:00Z",
          evidence: {
            canRedrive: false,
            reasonCode: "manual_intervention_required",
          },
        },
      ],
      events: [],
    };

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(JSON.stringify(snapshot)),
    });

    await expect(
      runRedrive({
        dispatcherUrl: "http://127.0.0.1:8787",
        taskId: "dispatch-1:task-no-redrive",
        fetchImpl: mockFetch as typeof globalThis.fetch,
      }),
    ).rejects.toThrow("task dispatch-1:task-no-redrive latest review explicitly disabled redrive");
  });

  it("failed redrive prefers latestWorkerResult.evidence.failureSummary over event payload", async () => {
    const snapshot = {
      tasks: [
        {
          id: "dispatch-1:task-evidence-priority",
          status: "failed",
          title: "Evidence Priority Task",
          repo: "owner/repo",
          defaultBranch: "main",
          branchName: "feature/evidence-priority",
          pool: "trae",
        },
      ],
      assignments: [
        {
          taskId: "dispatch-1:task-evidence-priority",
          workerId: "worker-1",
          pool: "trae",
          status: "failed",
          repo: "owner/repo",
          defaultBranch: "main",
          branchName: "feature/evidence-priority",
          targetWorkerId: "trae-remote-forgeflow",
        },
      ],
      reviews: [
        {
          taskId: "dispatch-1:task-evidence-priority",
          decision: "pending",
          notes: "",
          latestWorkerResult: {
            taskId: "dispatch-1:task-evidence-priority",
            workerId: "worker-1",
            evidence: {
              failureType: "preflight",
              failureSummary: "worktree_mismatch: structured evidence summary from latestWorkerResult",
            },
          },
        },
      ],
      events: [
        {
          taskId: "dispatch-1:task-evidence-priority",
          type: "status_changed",
          at: "2026-03-29T02:00:00Z",
          payload: {
            from: "in_progress",
            to: "failed",
            failureSummary: "worktree_mismatch: event payload failureSummary should be ignored",
            summary: "worktree_mismatch: event summary should be ignored",
          },
        },
      ],
    };

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(JSON.stringify(snapshot)),
    });

    const dispatchMockFetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () =>
        Promise.resolve(
          JSON.stringify({
            dispatchId: "dispatch-redrive-evidence",
            taskIds: ["dispatch-80:redrive-evidence"],
            assignments: [],
          }),
        ),
    });

    let fetchCallCount = 0;
    const combinedFetch = async (url: string, init?: RequestInit) => {
      fetchCallCount++;
      if (fetchCallCount === 1) {
        return mockFetch(url, init);
      }
      return dispatchMockFetch(url, init);
    };

    const result = await runRedrive({
      dispatcherUrl: "http://127.0.0.1:8787",
      taskId: "dispatch-1:task-evidence-priority",
      fetchImpl: combinedFetch as typeof globalThis.fetch,
    });

    expect(result.failureSummary).toContain("structured evidence summary from latestWorkerResult");
    expect(result.failureSummary).not.toContain("event payload failureSummary");
    expect(result.failureSummary).not.toContain("event summary");
  });

  it("failed redrive falls back to event payload failureSummary when latestWorkerResult.evidence.failureSummary is absent", async () => {
    const snapshot = {
      tasks: [
        {
          id: "dispatch-1:task-payload-fallback",
          status: "failed",
          title: "Payload Fallback Task",
          repo: "owner/repo",
          defaultBranch: "main",
          branchName: "feature/payload-fallback",
          pool: "trae",
        },
      ],
      assignments: [
        {
          taskId: "dispatch-1:task-payload-fallback",
          workerId: "worker-1",
          pool: "trae",
          status: "failed",
          repo: "owner/repo",
          defaultBranch: "main",
          branchName: "feature/payload-fallback",
          targetWorkerId: "trae-remote-forgeflow",
        },
      ],
      reviews: [
        {
          taskId: "dispatch-1:task-payload-fallback",
          decision: "pending",
          notes: "",
          latestWorkerResult: {
            taskId: "dispatch-1:task-payload-fallback",
            workerId: "worker-1",
          },
        },
      ],
      events: [
        {
          taskId: "dispatch-1:task-payload-fallback",
          type: "status_changed",
          at: "2026-03-29T02:00:00Z",
          payload: {
            from: "in_progress",
            to: "failed",
            failureSummary: "worktree_mismatch: event payload failureSummary should be used",
            summary: "worktree_mismatch: event summary should be ignored",
          },
        },
      ],
    };

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(JSON.stringify(snapshot)),
    });

    const dispatchMockFetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () =>
        Promise.resolve(
          JSON.stringify({
            dispatchId: "dispatch-redrive-payload",
            taskIds: ["dispatch-81:redrive-payload"],
            assignments: [],
          }),
        ),
    });

    let fetchCallCount = 0;
    const combinedFetch = async (url: string, init?: RequestInit) => {
      fetchCallCount++;
      if (fetchCallCount === 1) {
        return mockFetch(url, init);
      }
      return dispatchMockFetch(url, init);
    };

    const result = await runRedrive({
      dispatcherUrl: "http://127.0.0.1:8787",
      taskId: "dispatch-1:task-payload-fallback",
      fetchImpl: combinedFetch as typeof globalThis.fetch,
    });

    expect(result.failureSummary).toContain("event payload failureSummary should be used");
    expect(result.failureSummary).not.toContain("event summary");
  });

  it("failed redrive falls back to event summary when both evidence and payload failureSummary are absent", async () => {
    const snapshot = {
      tasks: [
        {
          id: "dispatch-1:task-summary-fallback",
          status: "failed",
          title: "Summary Fallback Task",
          repo: "owner/repo",
          defaultBranch: "main",
          branchName: "feature/summary-fallback",
          pool: "trae",
        },
      ],
      assignments: [
        {
          taskId: "dispatch-1:task-summary-fallback",
          workerId: "worker-1",
          pool: "trae",
          status: "failed",
          repo: "owner/repo",
          defaultBranch: "main",
          branchName: "feature/summary-fallback",
          targetWorkerId: "trae-remote-forgeflow",
        },
      ],
      reviews: [],
      events: [
        {
          taskId: "dispatch-1:task-summary-fallback",
          type: "status_changed",
          at: "2026-03-29T02:00:00Z",
          payload: {
            from: "in_progress",
            to: "failed",
            summary: "worktree_mismatch: legacy event summary should be used",
          },
        },
      ],
    };

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(JSON.stringify(snapshot)),
    });

    const dispatchMockFetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () =>
        Promise.resolve(
          JSON.stringify({
            dispatchId: "dispatch-redrive-summary",
            taskIds: ["dispatch-82:redrive-summary"],
            assignments: [],
          }),
        ),
    });

    let fetchCallCount = 0;
    const combinedFetch = async (url: string, init?: RequestInit) => {
      fetchCallCount++;
      if (fetchCallCount === 1) {
        return mockFetch(url, init);
      }
      return dispatchMockFetch(url, init);
    };

    const result = await runRedrive({
      dispatcherUrl: "http://127.0.0.1:8787",
      taskId: "dispatch-1:task-summary-fallback",
      fetchImpl: combinedFetch as typeof globalThis.fetch,
    });

    expect(result.failureSummary).toContain("legacy event summary should be used");
  });

  it("failed redrive with empty evidence.failureSummary falls back to event payload", async () => {
    const snapshot = {
      tasks: [
        {
          id: "dispatch-1:task-empty-evidence",
          status: "failed",
          title: "Empty Evidence Task",
          repo: "owner/repo",
          defaultBranch: "main",
          branchName: "feature/empty-evidence",
          pool: "trae",
        },
      ],
      assignments: [
        {
          taskId: "dispatch-1:task-empty-evidence",
          workerId: "worker-1",
          pool: "trae",
          status: "failed",
          repo: "owner/repo",
          defaultBranch: "main",
          branchName: "feature/empty-evidence",
          targetWorkerId: "trae-remote-forgeflow",
        },
      ],
      reviews: [
        {
          taskId: "dispatch-1:task-empty-evidence",
          decision: "pending",
          notes: "",
          latestWorkerResult: {
            taskId: "dispatch-1:task-empty-evidence",
            workerId: "worker-1",
            evidence: {
              failureType: "preflight",
              failureSummary: "",
            },
          },
        },
      ],
      events: [
        {
          taskId: "dispatch-1:task-empty-evidence",
          type: "status_changed",
          at: "2026-03-29T02:00:00Z",
          payload: {
            from: "in_progress",
            to: "failed",
            failureSummary: "worktree_mismatch: payload failureSummary used when evidence is empty",
          },
        },
      ],
    };

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(JSON.stringify(snapshot)),
    });

    const dispatchMockFetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () =>
        Promise.resolve(
          JSON.stringify({
            dispatchId: "dispatch-redrive-empty",
            taskIds: ["dispatch-83:redrive-empty"],
            assignments: [],
          }),
        ),
    });

    let fetchCallCount = 0;
    const combinedFetch = async (url: string, init?: RequestInit) => {
      fetchCallCount++;
      if (fetchCallCount === 1) {
        return mockFetch(url, init);
      }
      return dispatchMockFetch(url, init);
    };

    const result = await runRedrive({
      dispatcherUrl: "http://127.0.0.1:8787",
      taskId: "dispatch-1:task-empty-evidence",
      fetchImpl: combinedFetch as typeof globalThis.fetch,
    });

    expect(result.failureSummary).toContain("payload failureSummary used when evidence is empty");
  });
});
