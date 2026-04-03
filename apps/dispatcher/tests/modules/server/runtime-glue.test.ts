import { describe, expect, it, vi } from "vitest";

import {
  createHttpReviewClient,
  submitReviewDecision,
  createStateDirReviewClientFactory,
  mergePullRequestGitHub,
} from "../../../src/modules/server/runtime-glue-review-decision.js";

import {
  createDispatcherHttpClient,
  runWorkerDaemonCycle,
} from "../../../src/modules/server/runtime-glue-dispatcher-client.js";

describe("runtime-glue review-decision", () => {
  describe("createHttpReviewClient", () => {
    it("creates a client with submitDecision method", () => {
      const client = createHttpReviewClient({ dispatcherUrl: "http://localhost:8787" });
      expect(typeof client.submitDecision).toBe("function");
    });
  });

  describe("submitReviewDecision", () => {
    it("submits decision via provided client", async () => {
      const mockClient = {
        submitDecision: vi.fn().mockResolvedValue({
          status: "decision_recorded",
          tasks: [],
        }),
      };

      const result = await submitReviewDecision({
        client: mockClient as never,
        taskId: "task-1",
        decision: "merge",
        actor: "tester",
      });

      expect(mockClient.submitDecision).toHaveBeenCalledWith("task-1", {
        actor: "tester",
        decision: "merge",
        notes: undefined,
        at: undefined,
      });
      expect(result.status).toBe("decision_recorded");
    });

    it("throws when client is not provided and no dispatcherUrl", async () => {
      await expect(
        submitReviewDecision({
          taskId: "task-1",
          decision: "merge",
        }),
      ).rejects.toThrow();
    });
  });
});

describe("runtime-glue dispatcher-client", () => {
  describe("createDispatcherHttpClient", () => {
    it("creates client with all required methods", () => {
      const client = createDispatcherHttpClient({
        dispatcherUrl: "http://localhost:8787",
      });

      expect(typeof client.registerWorker).toBe("function");
      expect(typeof client.heartbeat).toBe("function");
      expect(typeof client.getAssignedTask).toBe("function");
      expect(typeof client.startTask).toBe("function");
      expect(typeof client.submitResult).toBe("function");
    });

    it("throws error when request fails with non-ok status", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: () => Promise.resolve('{"error":"internal error"}'),
      });

      const client = createDispatcherHttpClient({
        dispatcherUrl: "http://localhost:8787",
        fetchImpl: mockFetch as never,
      });

      await expect(
        client.registerWorker({
          workerId: "test-worker",
          pool: "codex",
          hostname: "test-host",
        }),
      ).rejects.toThrow("dispatcher request failed");
    });

    it("throws error when fetch throws (network failure)", async () => {
      const mockFetch = vi.fn().mockRejectedValue(new Error("network unavailable"));

      const client = createDispatcherHttpClient({
        dispatcherUrl: "http://localhost:8787",
        fetchImpl: mockFetch as never,
      });

      await expect(
        client.registerWorker({
          workerId: "test-worker",
          pool: "codex",
        }),
      ).rejects.toThrow("dispatcher request failed");
    });

    it("strips trailing slash from dispatcherUrl", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: () => Promise.resolve('{"status":"registered"}'),
      });

      const client = createDispatcherHttpClient({
        dispatcherUrl: "http://localhost:8787/",
        fetchImpl: mockFetch as never,
      });

      await client.registerWorker({
        workerId: "test-worker",
        pool: "codex",
      });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringMatching(/^http:\/\/localhost:8787\/api\/workers\/register$/),
        expect.any(Object),
      );
    });
  });
});

describe("runtime-glue worker-daemon-cycle", () => {
  describe("runWorkerDaemonCycle", () => {
    it("returns idle status when no task is assigned", async () => {
      const mockClient = {
        registerWorker: vi.fn().mockResolvedValue({ status: "registered" }),
        heartbeat: vi.fn().mockResolvedValue({ status: "heartbeat" }),
        getAssignedTask: vi.fn().mockResolvedValue({ assignment: null, task: null }),
        startTask: vi.fn(),
        submitResult: vi.fn(),
      };

      const result = await runWorkerDaemonCycle({
        client: mockClient as never,
        workerId: "test-worker",
        pool: "codex",
        repoDir: "/tmp/test",
      });

      expect(result.status).toBe("idle");
      expect(result.workerId).toBe("test-worker");
      expect(mockClient.registerWorker).toHaveBeenCalledWith({
        workerId: "test-worker",
        pool: "codex",
        hostname: expect.any(String),
        labels: [],
        repoDir: "/tmp/test",
        at: expect.any(String),
      });
      expect(mockClient.heartbeat).toHaveBeenCalledWith("test-worker", {
        at: expect.any(String),
      });
      expect(mockClient.getAssignedTask).toHaveBeenCalledWith("test-worker");
      expect(mockClient.startTask).not.toHaveBeenCalled();
      expect(mockClient.submitResult).not.toHaveBeenCalled();
    });

    it("returns completed status and calls startTask + submitResult when task is assigned", async () => {
      const mockClient = {
        registerWorker: vi.fn().mockResolvedValue({ status: "registered" }),
        heartbeat: vi.fn().mockResolvedValue({ status: "heartbeat" }),
        getAssignedTask: vi.fn().mockResolvedValue({
          assignment: { taskId: "task-1", workerId: "test-worker" },
          task: { id: "task-1", title: "Test Task" },
        }),
        startTask: vi.fn().mockResolvedValue({ status: "started" }),
        submitResult: vi.fn().mockResolvedValue({ status: "result_recorded" }),
      };

      const mockExecutor = {
        executeTask: vi.fn().mockResolvedValue({
          result: { dryRun: true },
          changedFiles: ["file-a.ts", "file-b.ts"],
          pullRequest: { number: 42, url: "https://github.com/org/repo/pull/42", headBranch: "feature-1", baseBranch: "main" },
        }),
      };

      const result = await runWorkerDaemonCycle({
        client: mockClient as never,
        workerId: "test-worker",
        pool: "codex",
        repoDir: "/tmp/test",
        taskExecutor: mockExecutor as never,
      });

      expect(result.status).toBe("completed");
      expect(result.workerId).toBe("test-worker");
      expect(result.taskId).toBe("task-1");
      expect(result.changedFiles).toEqual(["file-a.ts", "file-b.ts"]);
      expect(result.pullRequest).toEqual({ number: 42, url: "https://github.com/org/repo/pull/42", headBranch: "feature-1", baseBranch: "main" });

      expect(mockClient.registerWorker).toHaveBeenCalledWith({
        workerId: "test-worker",
        pool: "codex",
        hostname: expect.any(String),
        labels: [],
        repoDir: "/tmp/test",
        at: expect.any(String),
      });
      expect(mockClient.heartbeat).toHaveBeenCalledWith("test-worker", { at: expect.any(String) });
      expect(mockClient.getAssignedTask).toHaveBeenCalledWith("test-worker");

      expect(mockClient.startTask).toHaveBeenCalledWith("test-worker", {
        taskId: "task-1",
        at: expect.any(String),
      });
      expect(mockExecutor.executeTask).toHaveBeenCalledWith(
        { id: "task-1", title: "Test Task" },
        { taskId: "task-1", workerId: "test-worker" },
      );
      expect(mockClient.submitResult).toHaveBeenCalledWith("test-worker", {
        result: { dryRun: true },
        changedFiles: ["file-a.ts", "file-b.ts"],
        pullRequest: { number: 42, url: "https://github.com/org/repo/pull/42", headBranch: "feature-1", baseBranch: "main" },
      });
    });

    it("uses dryRunExecution when no taskExecutor is provided", async () => {
      const mockClient = {
        registerWorker: vi.fn().mockResolvedValue({ status: "registered" }),
        heartbeat: vi.fn().mockResolvedValue({ status: "heartbeat" }),
        getAssignedTask: vi.fn().mockResolvedValue({
          assignment: { taskId: "task-1", workerId: "test-worker" },
          task: { id: "task-1", title: "Test Task" },
        }),
        startTask: vi.fn().mockResolvedValue({ status: "started" }),
        submitResult: vi.fn().mockResolvedValue({ status: "result_recorded" }),
      };

      const result = await runWorkerDaemonCycle({
        client: mockClient as never,
        workerId: "test-worker",
        pool: "codex",
        repoDir: "/tmp/test",
        dryRunExecution: true,
      });

      expect(result.status).toBe("completed");
      expect(result.taskId).toBe("task-1");
      expect(result.changedFiles).toEqual([]);
      expect(result.pullRequest).toBeNull();
      expect(mockClient.startTask).toHaveBeenCalled();
      expect(mockClient.submitResult).toHaveBeenCalledWith("test-worker", {
        result: { dryRun: true, taskId: "task-1" },
        changedFiles: [],
        pullRequest: null,
      });
    });

    it("throws when client is not provided", async () => {
      await expect(
        runWorkerDaemonCycle({
          workerId: "test-worker",
          pool: "codex",
          repoDir: "/tmp/test",
        }),
      ).rejects.toThrow("dispatcher client is required");
    });

    it("throws when taskExecutor is required but not provided and dryRunExecution is false", async () => {
      const mockClient = {
        registerWorker: vi.fn().mockResolvedValue({ status: "registered" }),
        heartbeat: vi.fn().mockResolvedValue({ status: "heartbeat" }),
        getAssignedTask: vi.fn().mockResolvedValue({
          assignment: { taskId: "task-1", workerId: "test-worker" },
          task: { id: "task-1", title: "Test Task" },
        }),
        startTask: vi.fn().mockResolvedValue({ status: "started" }),
        submitResult: vi.fn().mockResolvedValue({ status: "result_recorded" }),
      };

      await expect(
        runWorkerDaemonCycle({
          client: mockClient as never,
          workerId: "test-worker",
          pool: "codex",
          repoDir: "/tmp/test",
          dryRunExecution: false,
        }),
      ).rejects.toThrow("taskExecutor is required when dryRunExecution is false");
    });
  });
});

describe("runtime-glue state-dir review client", () => {
  it("submitDecision calls handleRequest with correct path", () => {
    const mockHandleRequest = vi.fn().mockReturnValue({
      json: { status: "decision_recorded", tasks: [] },
    });

    const createStateDirReviewClient = createStateDirReviewClientFactory(mockHandleRequest);
    const client = createStateDirReviewClient("/tmp/state-dir");

    client.submitDecision("task-1", {
      actor: "tester",
      decision: "rework",
    });

    expect(mockHandleRequest).toHaveBeenCalledWith({
      stateDir: "/tmp/state-dir",
      method: "POST",
      pathname: "/api/reviews/task-1/decision",
      body: {
        actor: "tester",
        decision: "rework",
      },
    });
  });
});

describe("runtime-glue mergePullRequestGitHub", () => {
  it("calls GitHub API with correct params when merge conditions are met", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve('{"merged":true}'),
    });

    const result = await mergePullRequestGitHub({
      repo: "org/repo",
      pullRequestNumber: 42,
      notes: "looks good",
      token: "ghp_test_token",
      fetchImpl: mockFetch,
    });

    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.github.com/repos/org/repo/pulls/42/merge",
      {
        method: "PUT",
        headers: {
          authorization: "Bearer ghp_test_token",
          accept: "application/vnd.github+json",
          "content-type": "application/json",
          "user-agent": "forgeflow-review-decision",
        },
        body: JSON.stringify({
          merge_method: "squash",
          commit_title: "looks good",
        }),
      },
    );
    expect(result).toEqual({ merged: true });
  });

  it("throws when GitHub API returns non-ok", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 405,
      text: () => Promise.resolve('{"message":"Pull request is not mergeable"}'),
    });

    await expect(
      mergePullRequestGitHub({
        repo: "org/repo",
        pullRequestNumber: 42,
        token: "ghp_test_token",
        fetchImpl: mockFetch,
      }),
    ).rejects.toThrow("Pull request is not mergeable");
  });

  it("throws when fetch throws (network failure)", async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error("network unavailable"));

    await expect(
      mergePullRequestGitHub({
        repo: "org/repo",
        pullRequestNumber: 42,
        token: "ghp_test_token",
        fetchImpl: mockFetch,
      }),
    ).rejects.toThrow("network unavailable");
  });
});

describe("runtime-glue submitReviewDecision with mergePullRequest side effect", () => {
  it("calls mergePullRequestGitHub when decision is merge with mergePullRequest flag", async () => {
    const mockClient = {
      submitDecision: vi.fn().mockResolvedValue({
        status: "decision_recorded",
        tasks: [],
      }),
    };

    const mockMergeFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve('{"merged":true}'),
    });

    const originalFetch = globalThis.fetch;
    globalThis.fetch = mockMergeFetch as never;

    try {
      const result = await submitReviewDecision({
        client: mockClient as never,
        taskId: "task-1",
        decision: "merge",
        actor: "tester",
        mergePullRequest: true,
        repo: "org/repo",
        pullRequestNumber: 42,
        githubToken: "ghp_test_token",
      });

      expect(result.status).toBe("decision_recorded");
      expect(mockMergeFetch).toHaveBeenCalledWith(
        "https://api.github.com/repos/org/repo/pulls/42/merge",
        expect.objectContaining({ method: "PUT" }),
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("does NOT call mergePullRequestGitHub when mergePullRequest flag is false", async () => {
    const mockClient = {
      submitDecision: vi.fn().mockResolvedValue({
        status: "decision_recorded",
        tasks: [],
      }),
    };

    const mockMergeFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve('{"merged":true}'),
    });

    const originalFetch = globalThis.fetch;
    globalThis.fetch = mockMergeFetch as never;

    try {
      const result = await submitReviewDecision({
        client: mockClient as never,
        taskId: "task-1",
        decision: "merge",
        actor: "tester",
        mergePullRequest: false,
        repo: "org/repo",
        pullRequestNumber: 42,
        githubToken: "ghp_test_token",
      });

      expect(result.status).toBe("decision_recorded");
      expect(mockMergeFetch).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("does NOT call mergePullRequestGitHub when decision is rework", async () => {
    const mockClient = {
      submitDecision: vi.fn().mockResolvedValue({
        status: "decision_recorded",
        tasks: [],
      }),
    };

    const mockMergeFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve('{"merged":true}'),
    });

    const originalFetch = globalThis.fetch;
    globalThis.fetch = mockMergeFetch as never;

    try {
      const result = await submitReviewDecision({
        client: mockClient as never,
        taskId: "task-1",
        decision: "rework",
        actor: "tester",
        mergePullRequest: true,
        repo: "org/repo",
        pullRequestNumber: 42,
        githubToken: "ghp_test_token",
      });

      expect(result.status).toBe("decision_recorded");
      expect(mockMergeFetch).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});