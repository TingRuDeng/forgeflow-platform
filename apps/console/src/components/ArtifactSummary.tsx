import React from 'react';
import { Copy, Download, FileText } from 'lucide-react';
import { useTranslation } from '@/lib/i18n';
import { ArtifactTrajectory } from './ArtifactTrajectory';
import { downloadTextFile, parseArtifactRef, readArtifactRefFile } from './artifactFileAccess';

export interface ArtifactBundle {
  taskId: string;
  attemptId?: string;
  bundleId?: string;
  summary?: string;
  changedFiles?: Array<{ path?: string; changeType?: string }>;
  refs?: Record<string, string | string[] | undefined>;
  trajectory?: {
    schemaVersion: 'artifact-trajectory/v1';
    steps: Array<{
      stepId?: string;
      sequence: number;
      phase: string;
      action: string;
      observation?: string;
      status: string;
      startedAt?: string;
      endedAt?: string;
      command?: string;
      cwd?: string;
      exitCode?: number;
      artifactRef?: string;
    }>;
  };
  retainedContent?: {
    diff?: string;
    logs?: string;
    testResults?: string;
    trajectory?: string;
  };
  riskNotes?: string[];
  nextActions?: string[];
}

type ArtifactTab = 'summary' | 'refs' | 'retained' | 'trajectory';

function flattenRefs(refs: Array<[string, string | string[] | undefined]>) {
  return refs.flatMap(([key, value]) => {
    if (Array.isArray(value)) {
      return value.map((ref, index) => ({ key: `${key}.${index + 1}`, ref }));
    }
    return value ? [{ key, ref: value }] : [];
  });
}

function removeRecordKey(record: Record<string, string>, key: string) {
  const next = { ...record };
  delete next[key];
  return next;
}

const ArtifactTabButton: React.FC<{
  tab: ArtifactTab;
  activeTab: ArtifactTab;
  label: string;
  onSelect: (tab: ArtifactTab) => void;
}> = ({ tab, activeTab, label, onSelect }) => (
  <button
    type="button"
    role="tab"
    aria-selected={activeTab === tab}
    className={`rounded-md border px-3 py-1 text-xs ${activeTab === tab ? 'border-cyan-300/70 bg-cyan-300/15 text-cyan-100' : 'border-white/10 text-white/60 hover:border-white/25'}`}
    onClick={() => onSelect(tab)}
  >
    {label}
  </button>
);

const ArtifactSummaryDetails: React.FC<{ bundle: ArtifactBundle }> = ({ bundle }) => {
  const { t } = useTranslation();
  return (
    <div className="space-y-2">
      <div className="text-sm text-white/80">{t('artifactBundle')}: <span className="font-mono break-all">{bundle.bundleId || '--'}</span></div>
      <div className="text-sm text-white/80">{t('summary')}: <span className="break-all">{bundle.summary || '--'}</span></div>
      <div className="text-sm text-white/80">{t('changedFiles')}: <span className="break-all">{(bundle.changedFiles || []).map((file) => file.path).filter(Boolean).join('; ') || '--'}</span></div>
      <div className="text-sm text-white/80">{t('riskNotes')}: <span className="break-all">{(bundle.riskNotes || []).join('; ') || '--'}</span></div>
      <div className="text-sm text-white/80">{t('nextActions')}: <span className="break-all">{(bundle.nextActions || []).join('; ') || '--'}</span></div>
    </div>
  );
};

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

const ArtifactRefRow: React.FC<{
  entry: { key: string; ref: string };
  openedFile?: string;
  error?: string;
  copied: boolean;
  onCopy: (ref: string) => void;
  onOpen: (ref: string) => void;
  onDownload: (ref: string) => void;
}> = ({ entry, openedFile, error, copied, onCopy, onOpen, onDownload }) => {
  const { t } = useTranslation();
  const parsed = parseArtifactRef(entry.ref);
  const copyLabel = copied ? t('copied') : t('copyArtifactRef');

  return (
    <div className="space-y-2 rounded-lg border border-white/10 bg-black/15 p-2">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1 text-sm text-white/80">
          <span className="font-mono text-white/55">{entry.key}</span>: <span className="font-mono break-all">{entry.ref}</span>
        </div>
        <div className="flex shrink-0 gap-1">
          <IconButton label={copyLabel} onClick={() => onCopy(entry.ref)}>
            <Copy size={14} aria-hidden="true" />
          </IconButton>
          {parsed && (
            <>
              <IconButton label={t('openArtifactFile')} onClick={() => onOpen(entry.ref)}>
                <FileText size={14} aria-hidden="true" />
              </IconButton>
              <IconButton label={t('downloadArtifactFile')} onClick={() => onDownload(entry.ref)}>
                <Download size={14} aria-hidden="true" />
              </IconButton>
            </>
          )}
        </div>
      </div>
      {openedFile && (
        <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-white/10 bg-black/25 p-3 text-xs text-white/80">{openedFile}</pre>
      )}
      {error && (
        <div className="text-xs text-rose-200 break-all">{t('artifactFileLoadFailed')}: {error}</div>
      )}
    </div>
  );
};

const ArtifactRefs: React.FC<{ refs: Array<[string, string | string[] | undefined]> }> = ({ refs }) => {
  const { t } = useTranslation();
  const [openedFiles, setOpenedFiles] = React.useState<Record<string, string>>({});
  const [errorRefs, setErrorRefs] = React.useState<Record<string, string>>({});
  const [copiedRef, setCopiedRef] = React.useState<string | null>(null);
  const entries = flattenRefs(refs);

  const handleCopy = async (ref: string) => {
    await navigator.clipboard?.writeText(ref);
    setCopiedRef(ref);
  };

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
    <div className="space-y-2">
      {entries.length > 0 ? entries.map((entry) => (
        <ArtifactRefRow
          key={`${entry.key}-${entry.ref}`}
          entry={entry}
          openedFile={openedFiles[entry.ref]}
          error={errorRefs[entry.ref]}
          copied={copiedRef === entry.ref}
          onCopy={(ref) => void handleCopy(ref)}
          onOpen={handleOpen}
          onDownload={handleDownload}
        />
      )) : (
        <div className="text-sm text-white/45">{t('noArtifactRefs')}</div>
      )}
    </div>
  );
};

const ArtifactRetainedContent: React.FC<{ entries: Array<[string, string | undefined]> }> = ({ entries }) => {
  const { t } = useTranslation();
  return (
    <div className="space-y-3">
      {entries.length > 0 ? entries.map(([key, value]) => (
        <div key={key} className="space-y-1">
          <div className="font-mono text-xs text-white/55">{key}</div>
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-white/10 bg-black/25 p-3 text-xs text-white/80">{value}</pre>
        </div>
      )) : (
        <div className="text-sm text-white/45">{t('noRetainedContent')}</div>
      )}
    </div>
  );
};

export const ArtifactSummary: React.FC<{ bundles: ArtifactBundle[] }> = ({ bundles }) => {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = React.useState<ArtifactTab>('summary');
  const latestBundle = bundles[bundles.length - 1] || null;
  const refs = latestBundle?.refs ? Object.entries(latestBundle.refs).filter(([, value]) => {
    return Array.isArray(value) ? value.length > 0 : Boolean(value);
  }) : [];
  const retainedEntries = latestBundle?.retainedContent ? Object.entries(latestBundle.retainedContent).filter(([, value]) => {
    return Boolean(value);
  }) : [];

  return (
    <section className="glass-card rounded-xl p-4 space-y-3">
      <div className="text-[11px] uppercase tracking-wide text-white/45">{t('artifactSummary')}</div>
      {latestBundle ? (
        <>
          <div className="flex gap-2" role="tablist" aria-label={t('artifactSummary')}>
            {(['summary', 'refs', 'retained', 'trajectory'] as const).map((tab) => (
              <ArtifactTabButton
                key={tab}
                tab={tab}
                activeTab={activeTab}
                label={tab === 'summary' ? t('summary') : tab === 'refs' ? t('artifactRefs') : tab === 'retained' ? t('artifactRetainedContent') : t('artifactTrajectory')}
                onSelect={setActiveTab}
              />
            ))}
          </div>
          {activeTab === 'summary' && <ArtifactSummaryDetails bundle={latestBundle} />}
          {activeTab === 'refs' && <ArtifactRefs refs={refs} />}
          {activeTab === 'retained' && <ArtifactRetainedContent entries={retainedEntries} />}
          {activeTab === 'trajectory' && <ArtifactTrajectory bundle={latestBundle} />}
        </>
      ) : (
        <div className="text-sm text-white/45">{t('noArtifacts')}</div>
      )}
    </section>
  );
};
