import React from 'react';
import { ChevronLeft, ChevronRight, Download, FileText } from 'lucide-react';
import { useTranslation } from '@/lib/i18n';
import type { ArtifactBundle } from './ArtifactSummary';
import { downloadTextFile, parseArtifactRef, readArtifactRefFile } from './artifactFileAccess';

type TrajectoryStep = NonNullable<ArtifactBundle['trajectory']>['steps'][number];

const IconButton: React.FC<{
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}> = ({ label, onClick, children }) => (
  <button
    type="button"
    aria-label={label}
    title={label}
    className="grid h-7 w-7 place-items-center rounded-md border border-white/10 text-white/65 hover:border-cyan-300/45 hover:text-cyan-100"
    onClick={onClick}
  >
    {children}
  </button>
);

const StepNavButton: React.FC<{
  label: string;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}> = ({ label, disabled, onClick, children }) => (
  <button
    type="button"
    aria-label={label}
    title={label}
    disabled={disabled}
    className="grid h-8 w-8 place-items-center rounded-md border border-white/10 text-white/65 hover:border-cyan-300/45 hover:text-cyan-100 disabled:cursor-not-allowed disabled:opacity-35"
    onClick={onClick}
  >
    {children}
  </button>
);

const StepSelector: React.FC<{
  step: TrajectoryStep;
  selected: boolean;
  index: number;
  onSelect: () => void;
}> = ({ step, selected, index, onSelect }) => {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      aria-label={`${t('selectTrajectoryStep')} ${index + 1}`}
      className={`min-w-0 rounded-lg border px-3 py-2 text-left ${selected ? 'border-cyan-300/60 bg-cyan-300/15 text-cyan-100' : 'border-white/10 bg-black/15 text-white/65 hover:border-white/25'}`}
      onClick={onSelect}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-xs">{step.sequence}</span>
        <span className="text-[10px] uppercase text-white/45">{step.status}</span>
      </div>
      <div className="mt-1 truncate text-xs">{step.phase}</div>
    </button>
  );
};

const StepDetail: React.FC<{
  step: TrajectoryStep;
  openedFile?: string;
  error?: string;
  onOpen: (ref: string) => void;
  onDownload: (ref: string) => void;
}> = ({ step, openedFile, error, onOpen, onDownload }) => {
  const { t } = useTranslation();
  const parsedArtifactRef = step.artifactRef ? parseArtifactRef(step.artifactRef) : null;

  return (
    <div data-testid="trajectory-step-detail" className="rounded-lg border border-white/10 bg-black/20 p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="font-mono text-xs text-cyan-200">{step.sequence}. {step.phase}</div>
        <div className="text-xs uppercase tracking-wide text-white/55">{step.status}</div>
      </div>
      <div className="mt-2 text-sm text-white/85 break-all">{step.action}</div>
      {step.observation && <div className="mt-1 text-xs text-white/60 break-all">{step.observation}</div>}
      {(step.command || step.exitCode !== undefined || step.artifactRef) && (
        <div className="mt-2 grid grid-cols-1 gap-1 text-xs text-white/50">
          {step.command && <div><span className="font-mono">command</span>: <span className="break-all">{step.command}</span></div>}
          {step.exitCode !== undefined && <div><span className="font-mono">exitCode</span>: {step.exitCode}</div>}
          {step.artifactRef && (
            <div className="space-y-2">
              <div><span className="font-mono">artifact</span>: <span className="break-all">{step.artifactRef}</span></div>
              {parsedArtifactRef && (
                <div className="flex gap-1">
                  <IconButton label={t('openTrajectoryFile')} onClick={() => onOpen(step.artifactRef || '')}>
                    <FileText size={14} aria-hidden="true" />
                  </IconButton>
                  <IconButton label={t('downloadTrajectoryFile')} onClick={() => onDownload(step.artifactRef || '')}>
                    <Download size={14} aria-hidden="true" />
                  </IconButton>
                </div>
              )}
              {openedFile && (
                <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-white/10 bg-black/25 p-3 text-xs text-white/80">{openedFile}</pre>
              )}
              {error && (
                <div className="text-xs text-rose-200 break-all">{t('artifactFileLoadFailed')}: {error}</div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

function removeRecordKey(record: Record<string, string>, key: string) {
  const next = { ...record };
  delete next[key];
  return next;
}

export const ArtifactTrajectory: React.FC<{ bundle: ArtifactBundle }> = ({ bundle }) => {
  const { t } = useTranslation();
  const [openedFiles, setOpenedFiles] = React.useState<Record<string, string>>({});
  const [errorRefs, setErrorRefs] = React.useState<Record<string, string>>({});
  const [selectedStepIndex, setSelectedStepIndex] = React.useState(0);
  const steps = [...(bundle.trajectory?.steps ?? [])].sort((a, b) => a.sequence - b.sequence);
  const selectedStep = steps[selectedStepIndex] ?? steps[0] ?? null;

  React.useEffect(() => {
    setSelectedStepIndex((current) => Math.min(current, Math.max(steps.length - 1, 0)));
  }, [steps.length]);

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
    <div className="space-y-3">
      {selectedStep ? (
        <>
          <div className="flex items-center justify-between gap-3">
            <div className="font-mono text-xs text-white/65">{t('trajectoryStep')} {selectedStepIndex + 1} / {steps.length}</div>
            <div className="flex gap-1">
              <StepNavButton
                label={t('previousStep')}
                disabled={selectedStepIndex === 0}
                onClick={() => setSelectedStepIndex((current) => Math.max(current - 1, 0))}
              >
                <ChevronLeft size={15} aria-hidden="true" />
              </StepNavButton>
              <StepNavButton
                label={t('nextStep')}
                disabled={selectedStepIndex >= steps.length - 1}
                onClick={() => setSelectedStepIndex((current) => Math.min(current + 1, steps.length - 1))}
              >
                <ChevronRight size={15} aria-hidden="true" />
              </StepNavButton>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {steps.map((step, index) => (
              <StepSelector
                key={step.stepId || `${step.sequence}-${step.action}`}
                step={step}
                index={index}
                selected={index === selectedStepIndex}
                onSelect={() => setSelectedStepIndex(index)}
              />
            ))}
          </div>
          <StepDetail
            step={selectedStep}
            openedFile={selectedStep.artifactRef ? openedFiles[selectedStep.artifactRef] : undefined}
            error={selectedStep.artifactRef ? errorRefs[selectedStep.artifactRef] : undefined}
            onOpen={handleOpen}
            onDownload={handleDownload}
          />
        </>
      ) : (
        <div className="text-sm text-white/45">{t('noTrajectory')}</div>
      )}
    </div>
  );
};
