import { z } from "zod";

const NonEmptyStringSchema = z.string().min(1);

export const ArtifactChangedFileSchema = z.object({
  path: NonEmptyStringSchema,
  changeType: z.enum(["added", "modified", "deleted", "renamed"]),
  additions: z.number().int().nonnegative().optional(),
  deletions: z.number().int().nonnegative().optional(),
});

export const ArtifactTrajectoryStepSchema = z.object({
  stepId: z.string().optional(),
  sequence: z.number().int().nonnegative(),
  phase: z.enum(["preflight", "action", "observation", "verification", "result", "cleanup"]),
  action: NonEmptyStringSchema,
  observation: z.string().optional(),
  status: z.enum(["pending", "running", "succeeded", "failed", "skipped", "unknown"]),
  startedAt: z.string().optional(),
  endedAt: z.string().optional(),
  command: z.string().optional(),
  cwd: z.string().optional(),
  exitCode: z.number().int().optional(),
  artifactRef: z.string().optional(),
});

export const ArtifactTrajectorySchema = z.object({
  schemaVersion: z.literal("artifact-trajectory/v1"),
  steps: z.array(ArtifactTrajectoryStepSchema).default([]),
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
    trajectory: z.string().optional(),
    traj: z.string().optional(),
  }),
  trajectory: ArtifactTrajectorySchema.optional(),
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

export type ArtifactChangedFile = z.infer<typeof ArtifactChangedFileSchema>;
export type ArtifactTrajectoryStep = z.infer<typeof ArtifactTrajectoryStepSchema>;
export type ArtifactTrajectory = z.infer<typeof ArtifactTrajectorySchema>;
export type ArtifactBundle = z.infer<typeof ArtifactBundleSchema>;
