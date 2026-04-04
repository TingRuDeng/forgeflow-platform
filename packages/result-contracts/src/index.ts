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
  reasonCode: z.string().optional(),
  mustFix: z.array(z.string()).default([]),
  canRedrive: z.boolean().optional(),
  redriveStrategy: z.string().optional(),
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
export type WorkerEvidence = z.infer<typeof WorkerEvidenceSchema>;
export type ReviewDecisionEvidence = z.infer<typeof ReviewDecisionEvidenceSchema>;
