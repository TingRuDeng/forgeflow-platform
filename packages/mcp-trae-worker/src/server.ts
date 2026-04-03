function nowIso() {
  return new Date().toISOString();
}

export interface TraeWorkerDeps {
  registerWorker(worker: { workerId: string; pool: string; hostname: string; labels: string[]; repoDir: string; at: string }): Promise<unknown> | unknown;
  fetchTask(workerId: string, repoDir?: string): Promise<{ status: "no_task" } | { status: "ok"; task: TraeTask }>;
  startTask(workerId: string, payload: { taskId: string; at: string }): Promise<unknown> | unknown;
  reportProgress(taskId: string, message: string): Promise<{ ok: boolean }>;
  submitResult(input: {
    taskId: string;
    status: "review_ready" | "failed";
    summary?: string;
    testOutput?: string;
    risks?: string[];
    filesChanged?: string[];
    github?: {
      branchName?: string;
      commitSha?: string;
      pushStatus?: "success" | "failed" | "not_attempted";
      pushError?: string;
      prNumber?: number;
      prUrl?: string;
    };
  }): Promise<{ ok: boolean; error?: string }>;
  heartbeat(workerId: string, payload: { at: string }): Promise<unknown> | unknown;
}

export interface TraeTask {
  task_id: string;
  repo: string;
  branch: string;
  goal: string;
  scope: string[];
  constraints: string[];
  acceptance: string[];
  prompt: string;
  worktree_dir: string;
  assignment_dir: string;
}

export type TraeWorkerToolName =
  | "register"
  | "fetch_task"
  | "start_task"
  | "report_progress"
  | "submit_result"
  | "heartbeat";

export interface McpToolDefinition {
  name: TraeWorkerToolName;
  description: string;
  inputSchema: Record<string, unknown>;
}

const TOOL_DEFINITIONS: McpToolDefinition[] = [
  {
    name: "register",
    description: "Register this Trae worker with the dispatcher. Must be called before fetching tasks.",
    inputSchema: {
      type: "object",
      properties: {
        worker_id: { type: "string", description: "Unique identifier for this worker" },
        pool: { type: "string", description: "Worker pool (e.g., 'trae', 'codex')" },
        repo_dir: { type: "string", description: "Path to the repository directory" },
        labels: { type: "array", items: { type: "string" }, description: "Optional labels for this worker" },
      },
      required: ["worker_id", "pool", "repo_dir"],
    },
  },
  {
    name: "fetch_task",
    description: "Fetch an assigned task for the Trae worker. Returns task details with worktree_dir, assignment_dir, and constraints if available.",
    inputSchema: {
      type: "object",
      properties: {
        worker_id: { type: "string", description: "The Trae worker ID" },
        repo_dir: { type: "string", description: "Absolute path to the repository directory on this machine" },
      },
      required: ["worker_id"],
    },
  },
  {
    name: "start_task",
    description: "Mark a task as started. This will automatically begin sending heartbeats to keep the worker online.",
    inputSchema: {
      type: "object",
      properties: {
        worker_id: { type: "string", description: "Worker ID" },
        task_id: { type: "string", description: "Task ID to start" },
      },
      required: ["worker_id", "task_id"],
    },
  },
  {
    name: "report_progress",
    description: "Report progress message for a running task.",
    inputSchema: {
      type: "object",
      properties: {
        task_id: { type: "string", description: "The task ID" },
        message: { type: "string", description: "Progress message" },
      },
      required: ["task_id", "message"],
    },
  },
  {
    name: "submit_result",
    description: "Submit the result. This demotes to idle heartbeat instead of stopping.",
    inputSchema: {
      type: "object",
      properties: {
        worker_id: { type: "string", description: "Worker ID" },
        task_id: { type: "string", description: "The task ID" },
        status: {
          type: "string",
          enum: ["review_ready", "failed"],
          description: "Task status: review_ready or failed",
        },
        summary: { type: "string", description: "Summary of the work done" },
        test_output: { type: "string", description: "Test command output" },
        risks: { type: "array", items: { type: "string" }, description: "Potential risks" },
        files_changed: { type: "array", items: { type: "string" }, description: "List of changed files" },
        branch_name: { type: "string", description: "Branch name where changes were committed" },
        commit_sha: { type: "string", description: "Latest commit SHA" },
        push_status: { type: "string", enum: ["success", "failed", "not_attempted"], description: "Push status" },
        push_error: { type: "string", description: "Error message if push failed" },
        pr_number: { type: "number", description: "PR number if PR was created" },
        pr_url: { type: "string", description: "PR URL if available" },
      },
      required: ["worker_id", "task_id", "status"],
    },
  },
  {
    name: "heartbeat",
    description: "Send heartbeat to keep worker alive. Usually not needed as heartbeat is automatic after start_task.",
    inputSchema: {
      type: "object",
      properties: {
        worker_id: { type: "string", description: "The Trae worker ID" },
      },
      required: ["worker_id"],
    },
  },
];

const HEARTBEAT_INTERVAL_MS = 10_000;
const IDLE_HEARTBEAT_INTERVAL_MS = 10_000;

type HeartbeatMode = "high" | "low";

interface HeartbeatTimer {
  intervalId: ReturnType<typeof setInterval>;
  workerId: string;
  mode: HeartbeatMode;
}

export function createTraeWorkerServer(deps: TraeWorkerDeps) {
  const heartbeatTimers: Map<string, HeartbeatTimer> = new Map();

  function startHeartbeat(workerId: string, mode: HeartbeatMode = "high") {
    stopHeartbeat(workerId);

    const intervalMs = mode === "high" ? HEARTBEAT_INTERVAL_MS : IDLE_HEARTBEAT_INTERVAL_MS;

    const intervalId = setInterval(async () => {
      try {
        await deps.heartbeat(workerId, { at: nowIso() });
      } catch (error) {
        console.error(`[TraeWorker] Heartbeat failed for ${workerId}:`, error instanceof Error ? error.message : String(error));
      }
    }, intervalMs);

    heartbeatTimers.set(workerId, { intervalId, workerId, mode });
  }

  function promoteToIdleHeartbeat(workerId: string) {
    const existing = heartbeatTimers.get(workerId);
    if (existing && existing.mode === "high") {
      startHeartbeat(workerId, "low");
    }
  }

  function stopHeartbeat(workerId?: string) {
    if (workerId) {
      const existing = heartbeatTimers.get(workerId);
      if (existing) {
        clearInterval(existing.intervalId);
        heartbeatTimers.delete(workerId);
      }
    } else {
      for (const [id, timer] of heartbeatTimers) {
        clearInterval(timer.intervalId);
      }
      heartbeatTimers.clear();
    }
  }

  return {
    listTools(): McpToolDefinition[] {
      return [...TOOL_DEFINITIONS];
    },

    async callTool(name: TraeWorkerToolName, args: Record<string, unknown>): Promise<unknown> {
      switch (name) {
        case "register": {
          const workerId = args.worker_id as string;
          const pool = args.pool as string;
          const repoDir = args.repo_dir as string;
          const labels = (args.labels as string[]) ?? [];
          const hostname = "trae-worker";

          const result = await deps.registerWorker({
            workerId,
            pool,
            hostname,
            labels,
            repoDir,
            at: nowIso(),
          });

          startHeartbeat(workerId, "low");

          return result;
        }

        case "fetch_task": {
          const workerId = args.worker_id as string;
          const repoDir = args.repo_dir as string | undefined;
          return deps.fetchTask(workerId, repoDir);
        }

        case "start_task": {
          const workerId = args.worker_id as string;
          const taskId = args.task_id as string;

          await deps.startTask(workerId, { taskId, at: nowIso() });

          startHeartbeat(workerId);

          return { status: "started", task_id: taskId, worker_id: workerId };
        }

        case "report_progress": {
          const taskId = args.task_id as string;
          const message = args.message as string;
          return deps.reportProgress(taskId, message);
        }

        case "submit_result": {
          const workerId = args.worker_id as string;
          const taskId = args.task_id as string;
          const status = args.status as "review_ready" | "failed";
          const summary = args.summary as string | undefined;
          const testOutput = args.test_output as string | undefined;
          const risks = args.risks as string[] | undefined;
          const filesChanged = args.files_changed as string[] | undefined;
          const branchName = args.branch_name as string | undefined;
          const commitSha = args.commit_sha as string | undefined;
          const pushStatus = args.push_status as "success" | "failed" | "not_attempted" | undefined;
          const pushError = args.push_error as string | undefined;
          const prNumber = args.pr_number as number | undefined;
          const prUrl = args.pr_url as string | undefined;

          const result = await deps.submitResult({
            taskId,
            status,
            summary,
            testOutput,
            risks,
            filesChanged,
            github: branchName || commitSha || pushStatus || prNumber || prUrl
              ? { branchName, commitSha, pushStatus, pushError, prNumber, prUrl }
              : undefined,
          });

          if (result.ok) {
            promoteToIdleHeartbeat(workerId);
          }

          return result;
        }

        case "heartbeat": {
          const workerId = args.worker_id as string;
          return deps.heartbeat(workerId, { at: nowIso() });
        }

        default:
          return { ok: false, error: "unknown_tool" };
      }
    },

    stopAllHeartbeats() {
      for (const [workerId] of heartbeatTimers) {
        stopHeartbeat(workerId);
      }
    },

    getActiveHeartbeats(): string[] {
      return Array.from(heartbeatTimers.keys());
    },
  };
}
