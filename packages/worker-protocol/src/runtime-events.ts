import { z } from "zod";

const NonEmptyStringSchema = z.string().min(1);
const TraceIdSchema = z.string().min(1);

export const RuntimeEventTypeSchema = z.enum([
  "task_created",
  "task_ready",
  "worker_registered",
  "worker_heartbeat",
  "worker_disabled",
  "worker_enabled",
  "worker_offline",
  "lease_acquired",
  "lease_released",
  "lease_expired",
  "lease_conflict",
  "lease_reclaimed",
  "attempt_created",
  "attempt_started",
  "attempt_progress",
  "attempt_checkpointed",
  "attempt_result_submitted",
  "attempt_succeeded",
  "attempt_failed",
  "attempt_expired",
  "artifact_bundle_created",
  "review_requested",
  "review_decided",
  "task_redriven",
  "task_cancelled",
  "task_interrupted",
  "task_resumed",
  "policy_evaluated",
  "status_changed",
]);

export type RuntimeEventType = z.infer<typeof RuntimeEventTypeSchema>;

const LEGACY_RUNTIME_EVENT_TYPE_MAP: Readonly<Record<string, RuntimeEventType>> = {
  created: "task_created",
  assignment_claimed: "attempt_created",
  progress_reported: "attempt_progress",
  session_interrupted: "attempt_failed",
  submit_result_retry_failed: "attempt_failed",
  delivery_failed: "attempt_failed",
  worktree_cleanup_failed: "attempt_failed",
  worker_disabled: "worker_disabled",
  worker_enabled: "worker_enabled",
  worker_offline: "worker_offline",
  lease_conflict: "lease_conflict",
} as const;

export function normalizeRuntimeEventType(value: string): RuntimeEventType | null {
  const parsed = RuntimeEventTypeSchema.safeParse(value);
  if (parsed.success) {
    return parsed.data;
  }
  return LEGACY_RUNTIME_EVENT_TYPE_MAP[value] ?? null;
}

export const RuntimeEventSchema = z.object({
  eventId: NonEmptyStringSchema,
  sequence: z.number().int().nonnegative(),
  taskId: NonEmptyStringSchema,
  attemptId: z.string().optional(),
  workerId: z.string().optional(),
  traceId: TraceIdSchema,
  eventType: RuntimeEventTypeSchema,
  payload: z.record(z.unknown()).default({}),
  createdAt: NonEmptyStringSchema,
});

export type RuntimeEvent = z.infer<typeof RuntimeEventSchema>;
