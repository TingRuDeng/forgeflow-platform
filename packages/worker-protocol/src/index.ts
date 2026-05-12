import { z } from "zod";

export const ProtocolVersionSchema = z.literal("2026-05-v1");
export const TraceIdSchema = z.string().min(1);
export const IdempotencyKeySchema = z.string().min(1);
export const LeaseTokenSchema = z.string().min(1);

const NonEmptyStringSchema = z.string().min(1);

export const WorkerRuntimeSchema = z.enum([
  "codex",
  "gemini",
  "trae",
  "custom",
]);

export const WorkerProtocolEnvelopeSchema = z.object({
  protocolVersion: ProtocolVersionSchema,
  taskId: NonEmptyStringSchema,
  attemptId: NonEmptyStringSchema,
  workerId: NonEmptyStringSchema,
  leaseToken: LeaseTokenSchema,
  traceId: TraceIdSchema,
  idempotencyKey: IdempotencyKeySchema,
});

export const WorkerRegistrationRequestSchema = z.object({
  protocolVersion: ProtocolVersionSchema,
  workerId: NonEmptyStringSchema,
  runtime: WorkerRuntimeSchema,
  workerClass: NonEmptyStringSchema,
  capabilities: z.array(NonEmptyStringSchema).default([]),
  capacity: z.number().int().positive().default(1),
  labels: z.record(z.string()).default({}),
});

export const WorkerRegistrationResponseSchema = z.object({
  ok: z.literal(true),
  workerId: NonEmptyStringSchema,
  acceptedProtocolVersion: ProtocolVersionSchema,
  heartbeatIntervalMs: z.number().int().positive(),
  leaseDurationMs: z.number().int().positive(),
});

export const TaskAttemptStatusSchema = z.enum([
  "created",
  "leased",
  "starting",
  "running",
  "checkpointed",
  "result_submitted",
  "succeeded",
  "failed",
  "expired",
  "cancelled",
  "superseded",
]);

export const FailureCodeSchema = z.enum([
  "model_request_failed",
  "sandbox_blocked",
  "worktree_conflict",
  "push_failed",
  "pr_failed",
  "verification_failed",
  "policy_blocked",
  "unknown",
]);

export const TaskAttemptSchema = z.object({
  attemptId: NonEmptyStringSchema,
  taskId: NonEmptyStringSchema,
  attemptNo: z.number().int().positive(),
  workerId: NonEmptyStringSchema,
  workerRuntime: WorkerRuntimeSchema,
  protocolVersion: ProtocolVersionSchema,
  leaseToken: LeaseTokenSchema,
  status: TaskAttemptStatusSchema,
  traceId: TraceIdSchema,
  startedAt: z.string().optional(),
  heartbeatAt: z.string().optional(),
  leaseExpiresAt: z.string().optional(),
  endedAt: z.string().optional(),
  failureCode: FailureCodeSchema.optional(),
  failureMessage: z.string().optional(),
  artifactBundleId: z.string().optional(),
  idempotencyKey: IdempotencyKeySchema,
});

export const RuntimeLeaseStateSchema = z.enum([
  "active",
  "released",
  "expired",
  "reclaimed",
]);

export const RuntimeLeaseSchema = z.object({
  leaseId: NonEmptyStringSchema,
  taskId: NonEmptyStringSchema,
  attemptId: NonEmptyStringSchema,
  ownerWorkerId: NonEmptyStringSchema,
  leaseTokenHash: NonEmptyStringSchema,
  state: RuntimeLeaseStateSchema,
  acquiredAt: NonEmptyStringSchema,
  expiresAt: NonEmptyStringSchema,
  releasedAt: z.string().optional(),
});

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

export const ArtifactChangedFileSchema = z.object({
  path: NonEmptyStringSchema,
  changeType: z.enum(["added", "modified", "deleted", "renamed"]),
  additions: z.number().int().nonnegative().optional(),
  deletions: z.number().int().nonnegative().optional(),
});

export const ArtifactBundleSchema = z.object({
  bundleId: z.string().optional(),
  taskId: NonEmptyStringSchema,
  attemptId: NonEmptyStringSchema,
  schemaVersion: z.literal("artifact-bundle/v1"),
  summary: z.string().optional(),
  branch: z.string().optional(),
  commit: z.string().optional(),
  pullRequestUrl: z.string().url().optional(),
  changedFiles: z.array(ArtifactChangedFileSchema),
  refs: z.object({
    diff: z.string().optional(),
    logs: z.string().optional(),
    testResults: z.string().optional(),
    screenshots: z.array(z.string()).optional(),
    terminalTranscript: z.string().optional(),
    structuredReport: z.string().optional(),
  }),
  testResults: z.array(z.object({
    name: NonEmptyStringSchema,
    status: z.enum(["passed", "failed", "skipped", "unknown"]),
    durationMs: z.number().nonnegative().optional(),
    outputRef: z.string().optional(),
  })).optional(),
  riskNotes: z.array(z.string()).default([]),
  nextActions: z.array(z.string()).default([]),
  createdAt: z.string().optional(),
});

export const ReviewDecisionSchema = z.enum([
  "approve",
  "merge",
  "reject_fixable",
  "reject_policy",
  "reject_incomplete",
  "needs_human_pairing",
  "redrive",
  "block",
]);

export type ProtocolVersion = z.infer<typeof ProtocolVersionSchema>;
export type TraceId = z.infer<typeof TraceIdSchema>;
export type IdempotencyKey = z.infer<typeof IdempotencyKeySchema>;
export type LeaseToken = z.infer<typeof LeaseTokenSchema>;
export type WorkerRuntime = z.infer<typeof WorkerRuntimeSchema>;
export type WorkerProtocolEnvelope = z.infer<typeof WorkerProtocolEnvelopeSchema>;
export type WorkerRegistrationRequest = z.infer<typeof WorkerRegistrationRequestSchema>;
export type WorkerRegistrationResponse = z.infer<typeof WorkerRegistrationResponseSchema>;
export type TaskAttemptStatus = z.infer<typeof TaskAttemptStatusSchema>;
export type FailureCode = z.infer<typeof FailureCodeSchema>;
export type TaskAttempt = z.infer<typeof TaskAttemptSchema>;
export type RuntimeLeaseState = z.infer<typeof RuntimeLeaseStateSchema>;
export type RuntimeLease = z.infer<typeof RuntimeLeaseSchema>;
export type RuntimeEvent = z.infer<typeof RuntimeEventSchema>;
export type ArtifactChangedFile = z.infer<typeof ArtifactChangedFileSchema>;
export type ArtifactBundle = z.infer<typeof ArtifactBundleSchema>;
export type ReviewDecision = z.infer<typeof ReviewDecisionSchema>;
