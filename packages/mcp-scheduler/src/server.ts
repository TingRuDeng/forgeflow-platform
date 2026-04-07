import { z } from "zod";

export interface SchedulerTaskInput {
  id: string;
  repo: string;
  title: string;
  pool: string;
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
  inputSchema: Record<string, unknown>;
}

const SchedulerTaskInputSchema = z.object({
  id: z.string().min(1),
  repo: z.string().min(1),
  title: z.string().min(1),
  pool: z.string().min(1),
  allowedPaths: z.array(z.string()).default([]),
  acceptance: z.array(z.string()).default([]),
  dependsOn: z.array(z.string()).default([]),
});

const CreateTasksArgsSchema = z.object({
  tasks: z.array(SchedulerTaskInputSchema).min(1),
});

const TaskIdArgsSchema = z.object({
  taskId: z.string().min(1),
});

const HeartbeatArgsSchema = z.object({
  workerId: z.string().min(1),
  at: z.string().min(1),
});

const CompleteTaskArgsSchema = z.object({
  taskId: z.string().min(1),
  result: z.record(z.string(), z.unknown()).default({}),
});

const FailTaskArgsSchema = z.object({
  taskId: z.string().min(1),
  reason: z.string().min(1),
});

const GetAssignedTaskArgsSchema = z.object({
  workerId: z.string().min(1),
});

const EmptyArgsSchema = z.object({});

const TOOL_ARG_SCHEMAS = {
  create_tasks: CreateTasksArgsSchema,
  list_ready_tasks: EmptyArgsSchema,
  assign_task: TaskIdArgsSchema,
  heartbeat: HeartbeatArgsSchema,
  start_task: TaskIdArgsSchema,
  complete_task: CompleteTaskArgsSchema,
  fail_task: FailTaskArgsSchema,
  get_assigned_task: GetAssignedTaskArgsSchema,
} as const satisfies Record<SchedulerToolName, z.ZodTypeAny>;

const TASK_INPUT_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["id", "repo", "title", "pool"],
  properties: {
    id: { type: "string", minLength: 1 },
    repo: { type: "string", minLength: 1 },
    title: { type: "string", minLength: 1 },
    pool: { type: "string", minLength: 1 },
    allowedPaths: { type: "array", items: { type: "string" } },
    acceptance: { type: "array", items: { type: "string" } },
    dependsOn: { type: "array", items: { type: "string" } },
  },
} as const;

const TOOL_DEFINITIONS: McpToolDefinition[] = [
  {
    name: "create_tasks",
    description: "Create structured tasks in the scheduler.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["tasks"],
      properties: {
        tasks: {
          type: "array",
          minItems: 1,
          items: TASK_INPUT_JSON_SCHEMA,
        },
      },
    },
  },
  {
    name: "list_ready_tasks",
    description: "List ready tasks that can be assigned.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {},
    },
  },
  {
    name: "assign_task",
    description: "Assign a ready task to an available worker.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["taskId"],
      properties: {
        taskId: { type: "string", minLength: 1 },
      },
    },
  },
  {
    name: "heartbeat",
    description: "Record a worker heartbeat.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["workerId", "at"],
      properties: {
        workerId: { type: "string", minLength: 1 },
        at: { type: "string", minLength: 1 },
      },
    },
  },
  {
    name: "start_task",
    description: "Mark an assigned task as in progress.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["taskId"],
      properties: {
        taskId: { type: "string", minLength: 1 },
      },
    },
  },
  {
    name: "complete_task",
    description: "Mark a task as completed.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["taskId"],
      properties: {
        taskId: { type: "string", minLength: 1 },
        result: { type: "object" },
      },
    },
  },
  {
    name: "fail_task",
    description: "Mark a task as failed.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["taskId", "reason"],
      properties: {
        taskId: { type: "string", minLength: 1 },
        reason: { type: "string", minLength: 1 },
      },
    },
  },
  {
    name: "get_assigned_task",
    description: "Get the task currently assigned to a worker.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["workerId"],
      properties: {
        workerId: { type: "string", minLength: 1 },
      },
    },
  },
];

export function createSchedulerServer(deps: SchedulerServerDeps) {
  return {
    listTools(): McpToolDefinition[] {
      return [...TOOL_DEFINITIONS];
    },
    async callTool(name: SchedulerToolName, args: Record<string, unknown>): Promise<unknown> {
      switch (name) {
        case "create_tasks":
          return deps.createTasks(TOOL_ARG_SCHEMAS.create_tasks.parse(args).tasks);
        case "list_ready_tasks":
          TOOL_ARG_SCHEMAS.list_ready_tasks.parse(args);
          return deps.listReadyTasks();
        case "assign_task":
          return deps.assignTask(TOOL_ARG_SCHEMAS.assign_task.parse(args).taskId);
        case "heartbeat":
          {
            const parsed = TOOL_ARG_SCHEMAS.heartbeat.parse(args);
            return deps.heartbeat(parsed.workerId, parsed.at);
          }
        case "start_task":
          return deps.startTask(TOOL_ARG_SCHEMAS.start_task.parse(args).taskId);
        case "complete_task":
          {
            const parsed = TOOL_ARG_SCHEMAS.complete_task.parse(args);
            return deps.completeTask(parsed.taskId, parsed.result);
          }
        case "fail_task":
          {
            const parsed = TOOL_ARG_SCHEMAS.fail_task.parse(args);
            return deps.failTask(parsed.taskId, parsed.reason);
          }
        case "get_assigned_task":
          return deps.getAssignedTask(TOOL_ARG_SCHEMAS.get_assigned_task.parse(args).workerId);
      }
    },
  };
}
