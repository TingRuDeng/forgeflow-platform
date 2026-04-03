import { describe, expect, it } from "vitest";
import { createTraeWorkerServer } from "../src/server.js";

describe("Trae Worker Server", () => {
  describe("register", () => {
    it("registers a worker and calls deps", async () => {
      const mockDeps = {
        registerWorker: async () => ({ status: "registered" } as const),
        fetchTask: async () => ({ status: "no_task" } as const),
        startTask: async () => ({ status: "started" } as const),
        reportProgress: async () => ({ ok: true } as const),
        submitResult: async () => ({ ok: true } as const),
        heartbeat: async () => ({ ok: true } as const),
      };
      const server = createTraeWorkerServer(mockDeps);

      const result = await server.callTool("register", {
        worker_id: "trae-worker-1",
        pool: "codex",
        repo_dir: "/repos/test",
        labels: ["mac", "codex"],
      });

      expect(result).toEqual({ status: "registered" });
    });
  });

  describe("fetch_task", () => {
    it("fetches assigned task with execution context", async () => {
      const mockTask = {
        status: "ok" as const,
        task: {
          task_id: "dispatch-1:task-1",
          repo: "test/repo",
          branch: "ai/trae/task-1",
          goal: "Fix bug",
          scope: ["src/**"],
          constraints: ["dont break tests"],
          acceptance: ["tests pass"],
          prompt: "Fix the bug in src/main.ts",
          worktree_dir: "/worktrees/dispatch-1/task-1",
          assignment_dir: "/assignments/dispatch-1/task-1",
        },
      };

      const mockDeps = {
        registerWorker: async () => ({ status: "registered" } as const),
        fetchTask: async () => mockTask,
        startTask: async () => ({ status: "started" } as const),
        reportProgress: async () => ({ ok: true } as const),
        submitResult: async () => ({ ok: true } as const),
        heartbeat: async () => ({ ok: true } as const),
      };

      const server = createTraeWorkerServer(mockDeps);
      const result = await server.callTool("fetch_task", {
        worker_id: "trae-worker-1",
      });

      expect(result).toEqual(mockTask);
    });
  });

  describe("start_task and automatic heartbeat", () => {
    it("starts a task and activates heartbeat", async () => {
      const mockDeps = {
        registerWorker: async () => ({ status: "registered" } as const),
        fetchTask: async () => ({ status: "no_task" } as const),
        startTask: async () => ({ status: "started" } as const),
        reportProgress: async () => ({ ok: true } as const),
        submitResult: async () => ({ ok: true } as const),
        heartbeat: async () => ({ ok: true } as const),
      };

      const server = createTraeWorkerServer(mockDeps);
      const result = await server.callTool("start_task", {
        worker_id: "trae-worker-1",
        task_id: "dispatch-1:task-1",
      });

      expect(result).toEqual({
        status: "started",
        task_id: "dispatch-1:task-1",
        worker_id: "trae-worker-1",
      });

      expect(server.getActiveHeartbeats()).toContain("trae-worker-1");

      server.stopAllHeartbeats();
    });

    it("prevents duplicate heartbeat timers", async () => {
      const mockDeps = {
        registerWorker: async () => ({ status: "registered" } as const),
        fetchTask: async () => ({ status: "no_task" } as const),
        startTask: async () => ({ status: "started" } as const),
        reportProgress: async () => ({ ok: true } as const),
        submitResult: async () => ({ ok: true } as const),
        heartbeat: async () => ({ ok: true } as const),
      };

      const server = createTraeWorkerServer(mockDeps);

      await server.callTool("start_task", {
        worker_id: "trae-worker-1",
        task_id: "dispatch-1:task-1",
      });

      await server.callTool("start_task", {
        worker_id: "trae-worker-1",
        task_id: "dispatch-1:task-2",
      });

      const activeCount = server.getActiveHeartbeats().filter((id: string) => id === "trae-worker-1").length;
      expect(activeCount).toBe(1);

      server.stopAllHeartbeats();
    });
  });

  describe("submit_result demotes to idle heartbeat", () => {
    it("demotes to idle heartbeat after submitting result with review_ready", async () => {
      const mockDeps = {
        registerWorker: async () => ({ status: "registered" } as const),
        fetchTask: async () => ({ status: "no_task" } as const),
        startTask: async () => ({ status: "started" } as const),
        reportProgress: async () => ({ ok: true } as const),
        submitResult: async () => ({ ok: true } as const),
        heartbeat: async () => ({ ok: true } as const),
      };

      const server = createTraeWorkerServer(mockDeps);

      await server.callTool("start_task", {
        worker_id: "trae-worker-1",
        task_id: "dispatch-1:task-1",
      });

      expect(server.getActiveHeartbeats()).toContain("trae-worker-1");

      await server.callTool("submit_result", {
        worker_id: "trae-worker-1",
        task_id: "dispatch-1:task-1",
        status: "review_ready",
        summary: "Fixed the bug",
        test_output: "All tests passed",
        risks: ["Low risk"],
        files_changed: ["src/main.ts"],
      });

      expect(server.getActiveHeartbeats()).toContain("trae-worker-1");

      server.stopAllHeartbeats();
    });

    it("demotes to idle heartbeat after submitting failed result", async () => {
      const mockDeps = {
        registerWorker: async () => ({ status: "registered" } as const),
        fetchTask: async () => ({ status: "no_task" } as const),
        startTask: async () => ({ status: "started" } as const),
        reportProgress: async () => ({ ok: true } as const),
        submitResult: async () => ({ ok: true } as const),
        heartbeat: async () => ({ ok: true } as const),
      };

      const server = createTraeWorkerServer(mockDeps);

      await server.callTool("start_task", {
        worker_id: "trae-worker-1",
        task_id: "dispatch-1:task-1",
      });

      await server.callTool("submit_result", {
        worker_id: "trae-worker-1",
        task_id: "dispatch-1:task-1",
        status: "failed",
        summary: "Could not fix the bug",
        test_output: "Tests failed",
        risks: ["High risk"],
        files_changed: [],
      });

      expect(server.getActiveHeartbeats()).toContain("trae-worker-1");

      server.stopAllHeartbeats();
    });
  });

  describe("manual heartbeat", () => {
    it("can send manual heartbeat", async () => {
      const mockDeps = {
        registerWorker: async () => ({ status: "registered" } as const),
        fetchTask: async () => ({ status: "no_task" } as const),
        startTask: async () => ({ status: "started" } as const),
        reportProgress: async () => ({ ok: true } as const),
        submitResult: async () => ({ ok: true } as const),
        heartbeat: async () => ({ ok: true } as const),
      };

      const server = createTraeWorkerServer(mockDeps);
      const result = await server.callTool("heartbeat", {
        worker_id: "trae-worker-1",
      });

      expect(result).toEqual({ ok: true });
    });
  });

  describe("stopAllHeartbeats", () => {
    it("stops all active heartbeat timers", async () => {
      const mockDeps = {
        registerWorker: async () => ({ status: "registered" } as const),
        fetchTask: async () => ({ status: "no_task" } as const),
        startTask: async () => ({ status: "started" } as const),
        reportProgress: async () => ({ ok: true } as const),
        submitResult: async () => ({ ok: true } as const),
        heartbeat: async () => ({ ok: true } as const),
      };

      const server = createTraeWorkerServer(mockDeps);

      await server.callTool("start_task", {
        worker_id: "trae-worker-1",
        task_id: "dispatch-1:task-1",
      });

      await server.callTool("start_task", {
        worker_id: "trae-worker-2",
        task_id: "dispatch-1:task-2",
      });

      expect(server.getActiveHeartbeats()).toHaveLength(2);

      server.stopAllHeartbeats();

      expect(server.getActiveHeartbeats()).toHaveLength(0);
    });
  });

  describe("listTools", () => {
    it("lists all available tools", async () => {
      const mockDeps = {
        registerWorker: async () => ({ status: "registered" } as const),
        fetchTask: async () => ({ status: "no_task" } as const),
        startTask: async () => ({ status: "started" } as const),
        reportProgress: async () => ({ ok: true } as const),
        submitResult: async () => ({ ok: true } as const),
        heartbeat: async () => ({ ok: true } as const),
      };

      const server = createTraeWorkerServer(mockDeps);
      const tools = server.listTools();
      const toolNames = tools.map((t: { name: string }) => t.name);

      expect(toolNames).toContain("register");
      expect(toolNames).toContain("fetch_task");
      expect(toolNames).toContain("start_task");
      expect(toolNames).toContain("report_progress");
      expect(toolNames).toContain("submit_result");
      expect(toolNames).toContain("heartbeat");
    });
  });
});
