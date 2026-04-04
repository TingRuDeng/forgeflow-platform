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
});

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

export const WorkerResultEvidenceSchema = z.object({
  findings: z.array(ReviewFindingSchema).default([]),
  test_failures: z.array(z.object({
    command: z.string(),
    exit_code: z.number().int(),
    output_snippet: z.string(),
  })).default([]),
  static_analysis_issues: z.array(z.object({
    tool: z.string(),
    file: z.string().nullable(),
    line: z.number().int().nullable(),
    message: z.string(),
    severity: z.enum(["error", "warning", "info"]),
  })).default([]),
  coverage_summary: z.object({
    lines_covered: z.number().int().nonnegative().default(0),
    lines_total: z.number().int().nonnegative().default(0),
    branches_covered: z.number().int().nonnegative().default(0),
    branches_total: z.number().int().nonnegative().default(0),
  }).optional(),
});

export const ReviewDecisionEvidenceSchema = z.object({
  rework_required: z.boolean().default(false),
  failure_reasons: z.array(z.object({
    category: z.enum(["test", "lint", "typecheck", "build", "coverage", "security", "other"]),
    description: z.string(),
    file: z.string().nullable(),
    line: z.number().int().nullable(),
  })).default([]),
  blocked_by: z.array(z.string()).default([]),
  pending_feedback: z.array(z.object({
    from_actor: z.string(),
    topic: z.string(),
    status: z.enum(["open", "resolved"]),
  })).default([]),
  additional_notes: z.string().default(""),
});

export type RunResult = z.infer<typeof RunResultSchema>;
export type ReviewFinding = z.infer<typeof ReviewFindingSchema>;
export type WorkerResultEvidence = z.infer<typeof WorkerResultEvidenceSchema>;
export type ReviewDecisionEvidence = z.infer<typeof ReviewDecisionEvidenceSchema>;
