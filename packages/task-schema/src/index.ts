import { z } from "zod";

export {
  ReviewFindingSchema,
  RunResultSchema,
} from "@forgeflow/result-contracts";

export const WorkerPoolSchema = z.enum(["codex", "gemini"]);
export const WorkerStatusSchema = z.enum(["idle", "busy", "offline", "disabled"]);
export const TaskStatusSchema = z.enum([
  "planned",
  "ready",
  "assigned",
  "in_progress",
  "partial_success",
  "expired",
  "review",
  "merged",
  "blocked",
  "failed",
]);

export const TaskSchema = z.object({
  id: z.string().min(1),
  repo: z.string().min(1),
  title: z.string().min(1),
  pool: WorkerPoolSchema,
  allowedPaths: z.array(z.string()).default([]),
  acceptance: z.array(z.string()).default([]),
  dependsOn: z.array(z.string()).default([]),
  status: TaskStatusSchema,
});

export const WorkerSchema = z.object({
  id: z.string().min(1),
  pool: WorkerPoolSchema,
  status: WorkerStatusSchema,
  lastHeartbeatAt: z.string().datetime(),
  currentTaskId: z.string().optional(),
  disabledAt: z.string().datetime().optional(),
  disabledBy: z.string().optional(),
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
export type ProjectConfig = z.infer<typeof ProjectConfigSchema>;
export type TaskEvent = z.infer<typeof TaskEventSchema>;
