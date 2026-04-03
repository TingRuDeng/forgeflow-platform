import { describe, it, expect, vi, beforeEach } from "vitest";
import { createTraeWorkerServer, type TraeWorkerDeps } from "./server.js";

describe("mcp-trae-worker server integration", () => {
  let mockDeps: TraeWorkerDeps;
  let server: ReturnType<typeof createTraeWorkerServer>;

  beforeEach(() => {
    mockDeps = {
      registerWorker: vi.fn(),
      fetchTask: vi.fn(),
      startTask: vi.fn(),
      reportProgress: vi.fn(),
      submitResult: vi.fn(),
      heartbeat: vi.fn(),
    };
    server = createTraeWorkerServer(mockDeps);
  });

  describe("listTools", () => {
    it("should expose 6 tools", () => {
      const tools = server.listTools();
      expect(tools).toHaveLength(6);
      expect(tools.map((t) => t.name)).toContain("register");
      expect(tools.map((t) => t.name)).toContain("fetch_task");
      expect(tools.map((t) => t.name)).toContain("start_task");
      expect(tools.map((t) => t.name)).toContain("report_progress");
      expect(tools.map((t) => t.name)).toContain("submit_result");
      expect(tools.map((t) => t.name)).toContain("heartbeat");
    });

    it("should have correct input schemas", () => {
      const tools = server.listTools();
      const fetchTaskTool = tools.find((t) => t.name === "fetch_task");
      expect(fetchTaskTool?.inputSchema).toHaveProperty("properties.worker_id");
      expect(fetchTaskTool?.inputSchema).toHaveProperty("required");
      expect(fetchTaskTool?.inputSchema.required).toContain("worker_id");
    });
  });

  describe("register", () => {
    it("should register worker", async () => {
      vi.mocked(mockDeps.registerWorker).mockResolvedValue({ status: "registered" });

      const result = await server.callTool("register", {
        worker_id: "trae-01",
        pool: "trae",
        repo_dir: "/repos/test",
        labels: ["mac"],
      });

      expect(result).toEqual({ status: "registered" });
      expect(mockDeps.registerWorker).toHaveBeenCalled();
    });
  });

  describe("fetch_task", () => {
    it("should return no_task when no task available", async () => {
      vi.mocked(mockDeps.fetchTask).mockResolvedValue({ status: "no_task" });

      const result = await server.callTool("fetch_task", { worker_id: "trae-01" });
      expect(result).toEqual({ status: "no_task" });
      expect(mockDeps.fetchTask).toHaveBeenCalledWith("trae-01", undefined);
    });

    it("should return task when available", async () => {
      const mockTask = {
        task_id: "dispatch-1:task-1",
        repo: "test/repo",
        branch: "ai/trae/task-1",
        goal: "Test task",
        scope: ["docs/**"],
        constraints: [],
        acceptance: ["pnpm test"],
        prompt: "Do something",
        worktree_dir: "/worktrees/dispatch-1/task-1",
        assignment_dir: "/assignments/dispatch-1/task-1",
      };
      vi.mocked(mockDeps.fetchTask).mockResolvedValue({ status: "ok", task: mockTask });

      const result = await server.callTool("fetch_task", { worker_id: "trae-01" });
      expect(result).toEqual({ status: "ok", task: mockTask });
      expect(mockDeps.fetchTask).toHaveBeenCalledWith("trae-01", undefined);
    });
  });

  describe("start_task", () => {
    it("should start task and activate heartbeat", async () => {
      vi.mocked(mockDeps.startTask).mockResolvedValue({ status: "started" });
      vi.mocked(mockDeps.heartbeat).mockResolvedValue({ ok: true });

      const result = await server.callTool("start_task", {
        worker_id: "trae-01",
        task_id: "task-1",
      });

      expect(result).toEqual({
        status: "started",
        task_id: "task-1",
        worker_id: "trae-01",
      });
      expect(mockDeps.startTask).toHaveBeenCalled();
      expect(server.getActiveHeartbeats()).toContain("trae-01");
    });
  });

  describe("report_progress", () => {
    it("should call reportProgress with correct params", async () => {
      vi.mocked(mockDeps.reportProgress).mockResolvedValue({ ok: true });

      const result = await server.callTool("report_progress", {
        task_id: "task-1",
        message: "Working on it...",
      });

      expect(result).toEqual({ ok: true });
      expect(mockDeps.reportProgress).toHaveBeenCalledWith("task-1", "Working on it...");
    });
  });

  describe("submit_result", () => {
    it("should submit review_ready result and keep idle heartbeat", async () => {
      vi.mocked(mockDeps.submitResult).mockResolvedValue({ ok: true });

      await server.callTool("start_task", {
        worker_id: "trae-01",
        task_id: "task-1",
      });

      expect(server.getActiveHeartbeats()).toContain("trae-01");

      const result = await server.callTool("submit_result", {
        worker_id: "trae-01",
        task_id: "task-1",
        status: "review_ready",
        summary: "Done!",
        test_output: "PASS",
        risks: ["Low risk"],
        files_changed: ["docs/test.md"],
      });

      expect(result).toEqual({ ok: true });
      expect(mockDeps.submitResult).toHaveBeenCalledWith({
        taskId: "task-1",
        status: "review_ready",
        summary: "Done!",
        testOutput: "PASS",
        risks: ["Low risk"],
        filesChanged: ["docs/test.md"],
        github: undefined,
      });
      expect(server.getActiveHeartbeats()).toContain("trae-01");
    });

    it("should submit failed result", async () => {
      vi.mocked(mockDeps.submitResult).mockResolvedValue({ ok: true });

      const result = await server.callTool("submit_result", {
        worker_id: "trae-01",
        task_id: "task-1",
        status: "failed",
        summary: "Something went wrong",
      });

      expect(result).toEqual({ ok: true });
      expect(mockDeps.submitResult).toHaveBeenCalledWith({
        taskId: "task-1",
        status: "failed",
        summary: "Something went wrong",
        testOutput: undefined,
        risks: undefined,
        filesChanged: undefined,
      });
    });
  });

  describe("heartbeat", () => {
    it("should call heartbeat with correct worker id", async () => {
      vi.mocked(mockDeps.heartbeat).mockResolvedValue({ ok: true });

      const result = await server.callTool("heartbeat", { worker_id: "trae-01" });

      expect(result).toEqual({ ok: true });
      expect(mockDeps.heartbeat).toHaveBeenCalledWith("trae-01", { at: expect.any(String) });
    });
  });

  describe("error handling", () => {
    it("should return error for unknown tool", async () => {
      const result = await server.callTool("unknown_tool" as never, {});
      expect(result).toEqual({ ok: false, error: "unknown_tool" });
    });
  });
});
