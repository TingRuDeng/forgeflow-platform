import React from 'react';
import { Download, FileText } from 'lucide-react';
import { useTranslation } from '@/lib/i18n';
import type { ArtifactBundle } from './ArtifactSummary';
import { downloadTextFile, parseArtifactRef, readArtifactRefFile } from './artifactFileAccess';

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

function removeRecordKey(record: Record<string, string>, key: string) {
  const next = { ...record };
  delete next[key];
  return next;
}

export const ArtifactTrajectory: React.FC<{ bundle: ArtifactBundle }> = ({ bundle }) => {
  const { t } = useTranslation();
  const [openedFiles, setOpenedFiles] = React.useState<Record<string, string>>({});
  const [errorRefs, setErrorRefs] = React.useState<Record<string, string>>({});
  const steps = [...(bundle.trajectory?.steps ?? [])].sort((a, b) => a.sequence - b.sequence);

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
      {steps.length > 0 ? steps.map((step) => {
        const parsedArtifactRef = step.artifactRef ? parseArtifactRef(step.artifactRef) : null;
        return (
          <div key={step.stepId || `${step.sequence}-${step.action}`} className="rounded-lg border border-white/10 bg-black/20 p-3">
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
                        <IconButton label={t('openTrajectoryFile')} onClick={() => handleOpen(step.artifactRef || '')}>
                          <FileText size={14} aria-hidden="true" />
                        </IconButton>
                        <IconButton label={t('downloadTrajectoryFile')} onClick={() => handleDownload(step.artifactRef || '')}>
                          <Download size={14} aria-hidden="true" />
                        </IconButton>
                      </div>
                    )}
                    {step.artifactRef && openedFiles[step.artifactRef] && (
                      <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-white/10 bg-black/25 p-3 text-xs text-white/80">{openedFiles[step.artifactRef]}</pre>
                    )}
                    {step.artifactRef && errorRefs[step.artifactRef] && (
                      <div className="text-xs text-rose-200 break-all">{t('artifactFileLoadFailed')}: {errorRefs[step.artifactRef]}</div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      }) : (
        <div className="text-sm text-white/45">{t('noTrajectory')}</div>
      )}
    </div>
  );
};
