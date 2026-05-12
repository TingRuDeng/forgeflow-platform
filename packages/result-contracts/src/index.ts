import { z } from "zod";

export const RunCommandSchema = z.enum(["run", "review"]);
export const DecisionSchema = z.enum(["PASS", "FAIL", "INCONCLUSIVE"]);
export const TerminalStateSchema = z.enum([
  "completed",
  "partial_success",
  "failed",
  "cancelled",
  "expired",
]);

export const WorkerFailureTypeSchema = z.enum([
  "preflight",
  "execution",
  "verification",
  "unknown",
]);

export const ReviewReasonCodeSchema = z.enum([
  "looks_good",
  "tests_passed",
  "minor_fix_needed",
  "incomplete_implementation",
  "test_failure",
  "policy_violation",
  "security_risk",
  "unclear_diff",
  "requires_pairing",
  "needs_redrive",
  "other",
]);

export const ReviewFindingSchema = z.object({
  finding_id: z.string().min(1).default("finding"),
  severity: z.enum(["critical", "high", "medium", "low"]),
  category: z.enum([
    "bug",
    "security",
    "performance",
    "maintainability",
    "test-gap",
  ]),
  title: z.string().min(1),
  evidence: z.object({
    file: z.string().min(1),
    line: z.number().int().positive().nullable(),
    symbol: z.string().nullable(),
    snippet: z.string().min(1),
  }),
  recommendation: z.string().min(1),
  confidence: z.number().min(0).max(1),
  fingerprint: z.string().min(1),
  detected_by: z.array(z.string()).default([]),
});

export const WorkerFailureSchema = z.object({
  kind: WorkerFailureTypeSchema,
  code: z.string(),
  message: z.string(),
  details: z.record(z.unknown()).optional(),
});

export const WorkerEvidenceSchema = z.object({
  failureType: WorkerFailureTypeSchema.optional(),
  failureSummary: z.string().optional(),
  blockers: z.array(WorkerFailureSchema).default([]),
  findings: z.array(ReviewFindingSchema).default([]),
  artifacts: z.record(z.string()).optional(),
});

export const ReviewDecisionEvidenceSchema = z.object({
  reasonCode: z.union([ReviewReasonCodeSchema, z.string().min(1)]).optional(),
  mustFix: z.array(z.string()).default([]),
  canRedrive: z.boolean().optional(),
  redriveStrategy: z.string().optional(),
});

export const ArtifactChangedFileSchema = z.object({
  path: z.string().min(1),
  changeType: z.enum(["added", "modified", "deleted", "renamed"]),
  additions: z.number().int().nonnegative().optional(),
  deletions: z.number().int().nonnegative().optional(),
});

export const ArtifactBundleSchema = z.object({
  bundleId: z.string().min(1).optional(),
  taskId: z.string().min(1),
  attemptId: z.string().min(1),
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
    name: z.string().min(1),
    status: z.enum(["passed", "failed", "skipped", "unknown"]),
    durationMs: z.number().nonnegative().optional(),
    outputRef: z.string().optional(),
  })).optional(),
  riskNotes: z.array(z.string()).default([]),
  nextActions: z.array(z.string()).default([]),
  createdAt: z.string().optional(),
});

export const RunResultSchema = z.object({
  command: RunCommandSchema,
  task_id: z.string().min(1),
  artifact_root: z.string().min(1),
  decision: DecisionSchema,
  terminal_state: TerminalStateSchema,
  provider_success_count: z.number().int().nonnegative(),
  provider_failure_count: z.number().int().nonnegative(),
  findings_count: z.number().int().nonnegative(),
  parse_success_count: z.number().int().nonnegative(),
  parse_failure_count: z.number().int().nonnegative(),
  schema_valid_count: z.number().int().nonnegative(),
  dropped_findings_count: z.number().int().nonnegative(),
  created_new_task: z.boolean(),
  evidence: WorkerEvidenceSchema.optional(),
});

export type RunResult = z.infer<typeof RunResultSchema>;
export type ReviewFinding = z.infer<typeof ReviewFindingSchema>;
export type WorkerFailure = z.infer<typeof WorkerFailureSchema>;
export type WorkerFailureType = z.infer<typeof WorkerFailureTypeSchema>;
export type ReviewReasonCode = z.infer<typeof ReviewReasonCodeSchema>;
export type WorkerEvidence = z.infer<typeof WorkerEvidenceSchema>;
export type ReviewDecisionEvidence = z.infer<typeof ReviewDecisionEvidenceSchema>;
export type ArtifactChangedFile = z.infer<typeof ArtifactChangedFileSchema>;
export type ArtifactBundle = z.infer<typeof ArtifactBundleSchema>;
