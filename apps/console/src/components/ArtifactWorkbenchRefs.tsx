import React from 'react';
import { Copy, Download, FileText } from 'lucide-react';
import { useTranslation } from '@/lib/i18n';
import type { ArtifactBundle } from './TaskTimeline';
import { downloadTextFile, readArtifactRefFile } from './artifactFileAccess';
import { flattenArtifactRefs } from './artifactWorkbenchRefsModel';

interface ArtifactRefEntry {
  key: string;
  ref: string;
}

function removeRecordKey(record: Record<string, string>, key: string) {
  const next = { ...record };
  delete next[key];
  return next;
}

const RefIconButton: React.FC<{
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}> = ({ label, onClick, children }) => (
  <button
    type="button"
    aria-label={label}
    title={label}
    className="grid h-6 w-6 shrink-0 place-items-center rounded border border-white/10 text-white/60 hover:border-cyan-300/45 hover:text-cyan-100"
    onClick={onClick}
  >
    {children}
  </button>
);

export const ArtifactWorkbenchRefs: React.FC<{ bundle: ArtifactBundle }> = ({ bundle }) => {
  const { t } = useTranslation();
  const [copiedRef, setCopiedRef] = React.useState<string | null>(null);
  const [openedFiles, setOpenedFiles] = React.useState<Record<string, string>>({});
  const [errorRefs, setErrorRefs] = React.useState<Record<string, string>>({});
  const refs = flattenArtifactRefs(bundle);

  if (refs.length === 0) return null;

  const readRef = (entry: ArtifactRefEntry, onRead: (fileName: string, content: string) => void) => {
    readArtifactRefFile(entry.ref).then((file) => {
      onRead(file.fileName, file.content);
      setErrorRefs((current) => removeRecordKey(current, entry.ref));
    }).catch((error: unknown) => {
      setErrorRefs((current) => ({
        ...current,
        [entry.ref]: error instanceof Error ? error.message : t('artifactFileLoadFailed'),
      }));
    });
  };

  return (
    <div className="mt-3 space-y-2">
      <div className="flex flex-wrap gap-2">
        {refs.map((entry) => {
          const copyLabel = `${copiedRef === entry.ref ? t('copied') : t('copyArtifactRef')} ${entry.key}`;
          return (
            <span key={`${entry.key}-${entry.ref}`} className="inline-flex max-w-full items-center gap-1 rounded-md border border-white/10 bg-black/20 px-2 py-1 text-[11px] text-white/55">
              <span className="font-mono text-white/45">{entry.key}</span>
              <span className="min-w-0 max-w-[16rem] truncate font-mono text-white/70">{entry.ref}</span>
              <RefIconButton label={copyLabel} onClick={() => {
                void Promise.resolve(navigator.clipboard?.writeText(entry.ref)).then(() => setCopiedRef(entry.ref));
              }}>
                <Copy size={13} aria-hidden="true" />
              </RefIconButton>
              <RefIconButton label={`${t('openArtifactFile')} ${entry.key}`} onClick={() => {
                readRef(entry, (_fileName, content) => {
                  setOpenedFiles((current) => ({ ...current, [entry.ref]: content }));
                });
              }}>
                <FileText size={13} aria-hidden="true" />
              </RefIconButton>
              <RefIconButton label={`${t('downloadArtifactFile')} ${entry.key}`} onClick={() => {
                readRef(entry, (fileName, content) => downloadTextFile(fileName, content));
              }}>
                <Download size={13} aria-hidden="true" />
              </RefIconButton>
            </span>
          );
        })}
      </div>
      {refs.map((entry) => (
        <React.Fragment key={`content-${entry.key}-${entry.ref}`}>
          {openedFiles[entry.ref] && (
            <pre className="max-h-52 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-white/10 bg-black/25 p-3 text-xs text-white/80">{openedFiles[entry.ref]}</pre>
          )}
          {errorRefs[entry.ref] && (
            <div className="text-xs text-rose-200 break-all">{t('artifactFileLoadFailed')}: {errorRefs[entry.ref]}</div>
          )}
        </React.Fragment>
      ))}
    </div>
  );
};
