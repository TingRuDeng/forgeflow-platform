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

export const WorkerFailureKindSchema = z.enum([
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
  kind: WorkerFailureKindSchema,
  code: z.string(),
  message: z.string(),
  details: z.record(z.unknown()).optional(),
});

export const WorkerEvidenceSchema = z.object({
  failures: z.array(WorkerFailureSchema).default([]),
  testOutput: z.string().optional(),
  risks: z.array(z.string()).default([]),
  branchName: z.string().optional(),
  commitSha: z.string().optional(),
  pushStatus: z.string().optional(),
  pushError: z.string().optional(),
  prNumber: z.number().optional(),
  prUrl: z.string().optional(),
});

export const ReviewDecisionEvidenceSchema = z.object({
  decision: z.enum(["merge", "block", "rework", "changes_requested"]),
  actor: z.string().optional(),
  notes: z.string().optional(),
  findings: z.array(ReviewFindingSchema).default([]),
  blockedReason: z.string().optional(),
  reworkPrompt: z.string().optional(),
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
export type WorkerEvidence = z.infer<typeof WorkerEvidenceSchema>;
export type ReviewDecisionEvidence = z.infer<typeof ReviewDecisionEvidenceSchema>;
