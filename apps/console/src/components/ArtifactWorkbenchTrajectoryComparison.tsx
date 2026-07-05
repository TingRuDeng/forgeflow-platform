import React from 'react';
import { Download, FileText } from 'lucide-react';
import { useTranslation } from '@/lib/i18n';
import type { ArtifactBundle } from './TaskTimeline';
import { downloadTextFile, parseArtifactRef, readArtifactRefFile } from './artifactFileAccess';
import { sortedTrajectorySteps } from './artifactTrajectorySummaryModel';

interface TaskSummary {
  id: string;
  title?: string;
  status?: string;
  repo?: string;
}

interface ArtifactWorkbenchTrajectoryComparisonProps {
  bundles: ArtifactBundle[];
  taskById: Map<string, TaskSummary>;
  onSelectTask?: (taskId: string) => void;
}

const IconButton: React.FC<{
  children: React.ReactNode;
  label: string;
  onClick: () => void;
}> = ({ children, label, onClick }) => (
  <button
    type="button"
    aria-label={label}
    title={label}
    className="grid h-6 w-6 place-items-center rounded border border-white/10 text-white/60 hover:border-cyan-300/45 hover:text-cyan-100"
    onClick={onClick}
  >
    {children}
  </button>
);

function removeRecordKey(record: Record<string, string>, key: string) {
  const next = { ...record };
  delete next[key];
  return next;
}

export const ArtifactWorkbenchTrajectoryComparison: React.FC<ArtifactWorkbenchTrajectoryComparisonProps> = ({
  bundles,
  taskById,
  onSelectTask,
}) => {
  const { t } = useTranslation();
  const [openedFiles, setOpenedFiles] = React.useState<Record<string, string>>({});
  const [errorRefs, setErrorRefs] = React.useState<Record<string, string>>({});
  const bundlesWithTrajectory = bundles
    .map((bundle) => ({ bundle, steps: sortedTrajectorySteps(bundle) }))
    .filter((entry) => entry.steps.length > 0);

  if (bundlesWithTrajectory.length === 0) return null;

  const handleOpen = (ref: string) => {
    readArtifactRefFile(ref).then((file) => {
      setOpenedFiles((current) => ({ ...current, [ref]: file.content }));
      setErrorRefs((current) => removeRecordKey(current, ref));
    }).catch((error: unknown) => {
      setErrorRefs((current) => ({
        ...current,
        [ref]: error instanceof Error ? error.message : t('artifactFileLoadFailed'),
      }));
    });
  };

  const handleDownload = (ref: string) => {
    readArtifactRefFile(ref).then((file) => {
      downloadTextFile(file.fileName, file.content);
      setErrorRefs((current) => removeRecordKey(current, ref));
    }).catch((error: unknown) => {
      setErrorRefs((current) => ({
        ...current,
        [ref]: error instanceof Error ? error.message : t('artifactFileLoadFailed'),
      }));
    });
  };

  return (
    <section
      data-testid="artifact-workbench-trajectory-comparison"
      className="rounded-lg border border-white/10 bg-black/15 p-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-[11px] uppercase tracking-wide text-white/45">{t('trajectorySideBySide')}</div>
        <div className="font-mono text-[11px] text-white/45">
          {bundlesWithTrajectory.length} / {bundles.length}
        </div>
      </div>
      <div className="mt-3 grid grid-cols-1 gap-2 lg:grid-cols-2">
        {bundlesWithTrajectory.map(({ bundle, steps }) => {
          const task = taskById.get(bundle.taskId);
          return (
            <article
              key={`trajectory-compare-${bundle.bundleId || bundle.attemptId || bundle.taskId}`}
              className="min-w-0 rounded-lg border border-white/10 bg-white/[0.03] p-3"
            >
              <button
                type="button"
                className="w-full text-left"
                onClick={() => onSelectTask?.(bundle.taskId)}
              >
                <div className="text-sm font-semibold text-white/80 break-all">{task?.title || bundle.taskId}</div>
                <div className="mt-1 flex flex-wrap gap-2 text-[11px] text-white/45">
                  <span className="font-mono break-all">{bundle.bundleId || bundle.attemptId || bundle.taskId}</span>
                  {task?.status && <span>{task.status}</span>}
                  {task?.repo && <span className="break-all">{task.repo}</span>}
                </div>
              </button>
              <div className="mt-3 max-h-72 space-y-2 overflow-auto pr-1">
                {steps.map((step) => (
                  <div
                    key={step.stepId || `${step.sequence}-${step.phase}-${step.action}`}
                    className="rounded border border-white/10 bg-black/20 px-2 py-2 text-xs text-white/60"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-cyan-200">{step.sequence}. {step.phase}</span>
                      <span className="uppercase tracking-wide text-white/40">{step.status}</span>
                    </div>
                    <div className="mt-1 break-all text-white/75">{step.action || t('noSummary')}</div>
                    {step.observation && <div className="mt-1 break-all text-white/50">{step.observation}</div>}
                    {step.command && <div className="mt-1 break-all font-mono text-white/45">command: {step.command}</div>}
                    {step.artifactRef && (
                      <div className="mt-1 space-y-2">
                        <div className="break-all font-mono text-white/45">artifact: {step.artifactRef}</div>
                        {parseArtifactRef(step.artifactRef) && (
                          <div className="flex gap-1">
                            <IconButton label={`${t('openTrajectoryFile')} ${step.sequence}`} onClick={() => handleOpen(step.artifactRef || '')}>
                              <FileText size={13} aria-hidden="true" />
                            </IconButton>
                            <IconButton label={`${t('downloadTrajectoryFile')} ${step.sequence}`} onClick={() => handleDownload(step.artifactRef || '')}>
                              <Download size={13} aria-hidden="true" />
                            </IconButton>
                          </div>
                        )}
                        {openedFiles[step.artifactRef] && (
                          <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-white/10 bg-black/25 p-2 text-xs text-white/80">
                            {openedFiles[step.artifactRef]}
                          </pre>
                        )}
                        {errorRefs[step.artifactRef] && (
                          <div className="break-all text-xs text-rose-200">{t('artifactFileLoadFailed')}: {errorRefs[step.artifactRef]}</div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
};
