export interface SchedulerTaskInput {
  id: string;
  repo: string;
  title: string;
  pool: "codex" | "gemini";
  allowedPaths: string[];
  acceptance: string[];
  dependsOn: string[];
}

export interface SchedulerServerDeps {
  createTasks(tasks: SchedulerTaskInput[]): Promise<unknown> | unknown;
  listReadyTasks(): Promise<unknown> | unknown;
  assignTask(taskId: string): Promise<unknown> | unknown;
  heartbeat(workerId: string, at: string): Promise<unknown> | unknown;
  startTask(taskId: string): Promise<unknown> | unknown;
  completeTask(taskId: string, result: Record<string, unknown>): Promise<unknown> | unknown;
  failTask(taskId: string, reason: string): Promise<unknown> | unknown;
  getAssignedTask(workerId: string): Promise<unknown> | unknown;
}

export type SchedulerToolName =
  | "create_tasks"
  | "list_ready_tasks"
  | "assign_task"
  | "heartbeat"
  | "start_task"
  | "complete_task"
  | "fail_task"
  | "get_assigned_task";

export interface McpToolDefinition {
  name: SchedulerToolName;
  description: string;
}

const TOOL_DEFINITIONS: McpToolDefinition[] = [
  { name: "create_tasks", description: "Create structured tasks in the scheduler." },
  { name: "list_ready_tasks", description: "List ready tasks that can be assigned." },
  { name: "assign_task", description: "Assign a ready task to an available worker." },
  { name: "heartbeat", description: "Record a worker heartbeat." },
  { name: "start_task", description: "Mark an assigned task as in progress." },
  { name: "complete_task", description: "Mark a task as completed." },
  { name: "fail_task", description: "Mark a task as failed." },
  { name: "get_assigned_task", description: "Get the task currently assigned to a worker." },
];

export function createSchedulerServer(deps: SchedulerServerDeps) {
  return {
    listTools(): McpToolDefinition[] {
      return [...TOOL_DEFINITIONS];
    },
    async callTool(name: SchedulerToolName, args: Record<string, unknown>): Promise<unknown> {
      switch (name) {
        case "create_tasks":
          return deps.createTasks(args.tasks as SchedulerTaskInput[]);
        case "list_ready_tasks":
          return deps.listReadyTasks();
        case "assign_task":
          return deps.assignTask(args.taskId as string);
        case "heartbeat":
          return deps.heartbeat(args.workerId as string, args.at as string);
        case "start_task":
          return deps.startTask(args.taskId as string);
        case "complete_task":
          return deps.completeTask(
            args.taskId as string,
            (args.result as Record<string, unknown> | undefined) ?? {},
          );
        case "fail_task":
          return deps.failTask(args.taskId as string, args.reason as string);
        case "get_assigned_task":
          return deps.getAssignedTask(args.workerId as string);
      }
    },
  };
}
