import React from 'react';
import { useTranslation } from '@/lib/i18n';
import type { ArtifactBundle } from './TaskTimeline';
import { summarizeTrajectory } from './artifactTrajectorySummaryModel';

export const ArtifactWorkbenchTrajectory: React.FC<{ bundle: ArtifactBundle }> = ({ bundle }) => {
  const { t } = useTranslation();
  const summary = summarizeTrajectory(bundle);
  if (!summary) return null;

  return (
    <div
      data-testid={`artifact-workbench-trajectory-${bundle.bundleId || bundle.attemptId || bundle.taskId}`}
      className="mt-2 rounded-lg border border-white/10 bg-black/15 px-2 py-2 text-[11px] text-white/55"
    >
      <div className="flex flex-wrap gap-2">
        <span>{t('artifactTrajectory')}: <span className="font-mono">{summary.stepCount}</span></span>
        <span>{t('trajectoryFailedSteps')}: <span className="font-mono">{summary.failedCount}</span></span>
      </div>
      {summary.lastStep && (
        <div className="mt-1 break-all text-white/60">
          {t('trajectoryLastStep')}: <span className="font-mono">{summary.lastStep.phase}</span> / {summary.lastStep.status} / {summary.lastStep.action}
        </div>
      )}
    </div>
  );
};
