import type { ArtifactBundle } from './TaskTimeline';

type TrajectoryStep = NonNullable<ArtifactBundle['trajectory']>['steps'][number];

export interface ArtifactTrajectorySummary {
  failedCount: number;
  lastStep?: TrajectoryStep;
  stepCount: number;
}

export function sortedTrajectorySteps(bundle: ArtifactBundle): TrajectoryStep[] {
  return [...(bundle.trajectory?.steps ?? [])].sort((left, right) => left.sequence - right.sequence);
}

export function summarizeTrajectory(bundle: ArtifactBundle): ArtifactTrajectorySummary | null {
  const steps = sortedTrajectorySteps(bundle);
  if (steps.length === 0) return null;
  return {
    failedCount: steps.filter((step) => step.status === 'failed').length,
    lastStep: steps.at(-1),
    stepCount: steps.length,
  };
}

export function flattenTrajectorySearchTerms(bundle: ArtifactBundle): string[] {
  return sortedTrajectorySteps(bundle).flatMap((step) => [
    step.stepId,
    step.sequence,
    step.phase,
    step.action,
    step.observation,
    step.status,
    step.command,
    step.cwd,
    step.exitCode,
    step.artifactRef,
  ]).map((value) => String(value ?? '')).filter(Boolean);
}
