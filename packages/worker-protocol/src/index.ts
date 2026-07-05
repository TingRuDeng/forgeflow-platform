import { z } from "zod";

export * from "./artifact-bundle.js";
export * from "./runtime-events.js";

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

export const WorkerMutationKindSchema = z.enum(["start-task", "result"]);

export const WorkerSdkStartPayloadSchema = WorkerProtocolEnvelopeSchema.omit({
  workerId: true,
}).extend({
  kind: z.literal("start-task"),
  at: z.string().optional(),
});

const WorkerResultVerificationCommandSchema = z.object({
  command: NonEmptyStringSchema,
  exitCode: z.number().int(),
  output: z.string().optional(),
});

const ResumePayloadFieldSchema = z.object({
  type: z.enum(["string", "number", "integer", "boolean", "array"]).optional(),
  title: z.string().optional(),
  description: z.string().optional(),
  enum: z.array(z.string()).optional(),
  default: z.unknown().optional(),
  format: z.enum(["text", "textarea"]).optional(),
  placeholder: z.string().optional(),
  minimum: z.number().optional(),
  maximum: z.number().optional(),
  minItems: z.number().int().nonnegative().optional(),
  maxItems: z.number().int().nonnegative().optional(),
  items: z.object({
    type: z.literal("string").optional(),
    enum: z.array(z.string()).optional(),
  }).optional(),
});

const ResumePayloadSchema = z.object({
  properties: z.record(ResumePayloadFieldSchema).optional(),
  required: z.array(z.string()).optional(),
});

const WorkerResultBodySchema = z.object({
  taskId: NonEmptyStringSchema,
  workerId: NonEmptyStringSchema,
  provider: NonEmptyStringSchema,
  pool: NonEmptyStringSchema,
  branchName: NonEmptyStringSchema,
  repo: NonEmptyStringSchema,
  defaultBranch: NonEmptyStringSchema,
  mode: z.enum(["run", "review"]),
  output: z.string(),
  generatedAt: NonEmptyStringSchema,
  verification: z.object({
    allPassed: z.boolean(),
    commands: z.array(WorkerResultVerificationCommandSchema).default([]),
  }),
  evidence: z.unknown().optional(),
  waitingForInput: z.object({
    requestedBy: z.string().optional(),
    reason: z.string().optional(),
    prompt: z.string().optional(),
    resumePayloadSchema: ResumePayloadSchema.optional(),
  }).optional(),
});

const WorkerPullRequestSchema = z.object({
  number: z.number().int().positive(),
  url: z.string().url(),
  headBranch: NonEmptyStringSchema,
  baseBranch: NonEmptyStringSchema,
});

export const WorkerSdkResultPayloadSchema = WorkerProtocolEnvelopeSchema.omit({
  workerId: true,
}).extend({
  kind: z.literal("result"),
  result: WorkerResultBodySchema,
  changedFiles: z.array(NonEmptyStringSchema).default([]),
  pullRequest: WorkerPullRequestSchema.nullable().default(null),
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

export function buildWorkerStartPayload(input: {
  envelope: WorkerProtocolEnvelope;
  at?: string;
}): WorkerSdkStartPayload {
  return WorkerSdkStartPayloadSchema.parse({
    kind: "start-task",
    taskId: input.envelope.taskId,
    attemptId: input.envelope.attemptId,
    leaseToken: input.envelope.leaseToken,
    protocolVersion: input.envelope.protocolVersion,
    traceId: input.envelope.traceId,
    idempotencyKey: input.envelope.idempotencyKey,
    at: input.at,
  });
}

export function buildWorkerResultPayload(input: {
  envelope: WorkerProtocolEnvelope;
  result: Omit<WorkerSdkResultPayload["result"], "taskId" | "workerId">;
  changedFiles?: string[];
  pullRequest?: WorkerSdkResultPayload["pullRequest"];
}): WorkerSdkResultPayload {
  return WorkerSdkResultPayloadSchema.parse({
    kind: "result",
    taskId: input.envelope.taskId,
    attemptId: input.envelope.attemptId,
    leaseToken: input.envelope.leaseToken,
    protocolVersion: input.envelope.protocolVersion,
    traceId: input.envelope.traceId,
    idempotencyKey: input.envelope.idempotencyKey,
    result: {
      ...input.result,
      taskId: input.envelope.taskId,
      workerId: input.envelope.workerId,
    },
    changedFiles: input.changedFiles ?? [],
    pullRequest: input.pullRequest ?? null,
  });
}

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
export type WorkerMutationKind = z.infer<typeof WorkerMutationKindSchema>;
export type WorkerSdkStartPayload = z.infer<typeof WorkerSdkStartPayloadSchema>;
export type WorkerSdkResultPayload = z.infer<typeof WorkerSdkResultPayloadSchema>;
export type WorkerRegistrationRequest = z.infer<typeof WorkerRegistrationRequestSchema>;
export type WorkerRegistrationResponse = z.infer<typeof WorkerRegistrationResponseSchema>;
export type TaskAttemptStatus = z.infer<typeof TaskAttemptStatusSchema>;
export type FailureCode = z.infer<typeof FailureCodeSchema>;
export type TaskAttempt = z.infer<typeof TaskAttemptSchema>;
export type RuntimeLeaseState = z.infer<typeof RuntimeLeaseStateSchema>;
export type RuntimeLease = z.infer<typeof RuntimeLeaseSchema>;
export type ReviewDecision = z.infer<typeof ReviewDecisionSchema>;
