import { z } from "zod";

export {
  ReviewFindingSchema,
  RunResultSchema,
} from "@forgeflow/result-contracts";

export const WorkerPoolSchema = z.enum(["codex", "gemini", "trae"]);
export const WorkerStatusSchema = z.enum(["idle", "busy", "offline", "disabled"]);
export const TaskStatusSchema = z.enum([
  "planned",
  "ready",
  "assigned",
  "in_progress",
  "review",
  "merged",
  "blocked",
  "failed",
  "cancelled",
]);
export const VerificationModeSchema = z.enum(["run", "review"]);
export const VerificationSchema = z.object({
  mode: VerificationModeSchema,
});

export const TaskSchema = z.object({
  id: z.string().min(1),
  externalTaskId: z.string().min(1).optional(),
  traceId: z.string().min(1).optional(),
  repo: z.string().min(1),
  defaultBranch: z.string().min(1).optional(),
  title: z.string().min(1),
  pool: WorkerPoolSchema,
  allowedPaths: z.array(z.string()).default([]),
  acceptance: z.array(z.string()).default([]),
  dependsOn: z.array(z.string()).default([]),
  branchName: z.string().min(1).optional(),
  targetWorkerId: z.string().min(1).optional(),
  verification: VerificationSchema.optional(),
  chatMode: z.string().min(1).optional(),
  continuationMode: z.string().min(1).optional(),
  continueFromTaskId: z.string().min(1).optional(),
  followUpOfTaskId: z.string().min(1).optional(),
  workerChangeReason: z.string().min(1).optional(),
  status: TaskStatusSchema,
  assignedWorkerId: z.string().min(1).optional(),
  lastAssignedWorkerId: z.string().min(1).optional(),
  requestedBy: z.string().min(1).optional(),
  createdAt: z.string().datetime().optional(),
});

export const WorkerSchema = z.object({
  id: z.string().min(1),
  pool: WorkerPoolSchema,
  status: WorkerStatusSchema,
  hostname: z.string().optional(),
  labels: z.array(z.string()).optional(),
  repoDir: z.string().optional(),
  lastHeartbeatAt: z.string().datetime(),
  currentTaskId: z.string().optional(),
  disabledAt: z.string().datetime().optional(),
  disabledBy: z.string().optional(),
});

export const AssignmentPayloadSchema = z.object({
  taskId: z.string().min(1),
  taskTitle: z.string().min(1),
  taskBranchName: z.string().min(1),
  traceId: z.string().min(1).optional(),
  workerId: z.string().min(1),
  pool: WorkerPoolSchema,
  status: z.enum(["assigned"]),
  branchName: z.string().min(1),
  allowedPaths: z.array(z.string()).optional(),
  acceptance: z.array(z.string()).optional(),
  commands: z.record(z.string()).optional(),
  repo: z.string().min(1),
  defaultBranch: z.string().min(1),
  targetWorkerId: z.string().min(1).optional(),
  chatMode: z.string().min(1).optional(),
  continuationMode: z.string().min(1).optional(),
  continueFromTaskId: z.string().min(1).optional(),
  followUpOfTaskId: z.string().min(1).optional(),
  workerChangeReason: z.string().min(1).optional(),
});

export const ProjectConfigSchema = z.object({
  project: z.object({
    key: z.string().min(1),
    repo: z.string().min(1),
    default_branch: z.string().min(1),
  }),
  routing: z.record(z.array(z.string()).min(1)),
  commands: z.record(z.string()),
  governance: z.object({
    branch_prefix: z.string().default("ai"),
    require_review: z.boolean().default(true),
    require_checks: z.boolean().default(true),
  }),
  worktree: z.object({
    root_dir: z.string().default(".worktrees"),
    branch_template: z.string().default("ai/{pool}/{task_id}-{slug}"),
    sync_from_default_branch: z.boolean().default(true),
  }).default({}),
  observability: z.object({
    enabled: z.boolean().default(true),
    retain_days: z.number().int().positive().default(14),
  }).default({}),
  providers: z.object({
    enabled: z.array(WorkerPoolSchema).default(["codex", "gemini"]),
    permissions: z.record(z.record(z.unknown())).default({}),
  }).default({}),
});

export const TaskEventSchema = z.object({
  taskId: z.string().min(1),
  type: z.string().min(1),
  at: z.string().datetime(),
  payload: z.record(z.unknown()).default({}),
});

export type Task = z.infer<typeof TaskSchema>;
export type Worker = z.infer<typeof WorkerSchema>;
export type AssignmentPayload = z.infer<typeof AssignmentPayloadSchema>;
export type ProjectConfig = z.infer<typeof ProjectConfigSchema>;
export type TaskEvent = z.infer<typeof TaskEventSchema>;
