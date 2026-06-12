import React from 'react';
import { useTranslation } from '@/lib/i18n';

export interface TaskAttempt {
  taskId: string;
  attemptId: string;
  attemptNo?: number;
  status?: string;
  workerId?: string;
  startedAt?: string;
  completedAt?: string;
  endedAt?: string;
  failureCode?: string;
  failureMessage?: string;
  artifactBundleId?: string;
}

export interface ArtifactBundle {
  taskId: string;
  attemptId?: string;
  bundleId?: string;
  summary?: string;
  changedFiles?: Array<{ path?: string; changeType?: string }>;
  refs?: Record<string, string | string[] | undefined>;
  retainedContent?: {
    diff?: string;
    logs?: string;
    testResults?: string;
  };
  riskNotes?: string[];
  nextActions?: string[];
}

type ArtifactTab = 'summary' | 'refs' | 'retained';

interface EventRecord {
  taskId: string;
  type: string;
  at?: string;
  summary?: string;
  payload?: {
    message?: string;
    failureCode?: string;
    data?: {
      message?: string;
      failureCode?: string;
    } | null;
  } | null;
}

function formatTime(isoString?: string): string {
  if (!isoString) return '--:--:--';
  const date = new Date(isoString);
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  return `${hours}:${minutes}:${seconds}`;
}

function extractEventSummary(event: EventRecord) {
  return event.summary
    || event.payload?.message
    || event.payload?.data?.message
    || event.payload?.failureCode
    || event.payload?.data?.failureCode
    || '--';
}

export const AttemptTimeline: React.FC<{ attempts: TaskAttempt[] }> = ({ attempts }) => {
  const { t } = useTranslation();
  const sortedAttempts = [...attempts].sort((a, b) => (a.attemptNo ?? 0) - (b.attemptNo ?? 0));

  return (
    <section className="glass-card rounded-xl p-4">
      <div className="text-[11px] uppercase tracking-wide text-white/45 mb-3">{t('attemptTimeline')}</div>
      <div className="space-y-3">
        {sortedAttempts.length > 0 ? sortedAttempts.map((attempt) => (
          <div key={attempt.attemptId} className="rounded-lg border border-cyan-400/20 bg-cyan-400/5 p-3">
            <div className="flex items-center justify-between gap-3">
              <div className="font-mono text-sm text-cyan-200 break-all">{attempt.attemptId}</div>
              <div className="text-xs uppercase tracking-wide text-white/55">{attempt.status || '--'}</div>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-white/65">
              <div>{t('attemptNo')}: <span className="font-mono">{attempt.attemptNo ?? '--'}</span></div>
              <div>{t('worker')}: <span className="font-mono break-all">{attempt.workerId || '--'}</span></div>
              <div>{t('startedAt')}: <span className="font-mono">{formatTime(attempt.startedAt)}</span></div>
              <div>{t('endedAt')}: <span className="font-mono">{formatTime(attempt.endedAt || attempt.completedAt)}</span></div>
              <div>{t('failureCode')}: <span className="font-mono">{attempt.failureCode || '--'}</span></div>
              <div>{t('artifactBundle')}: <span className="font-mono break-all">{attempt.artifactBundleId || '--'}</span></div>
            </div>
            {attempt.failureMessage && (
              <div className="mt-2 text-xs text-rose-200 break-all">{attempt.failureMessage}</div>
            )}
          </div>
        )) : (
          <div className="text-sm text-white/45">{t('noAttempts')}</div>
        )}
      </div>
    </section>
  );
};

export const RuntimeEventList: React.FC<{ events: EventRecord[] }> = ({ events }) => {
  const { t } = useTranslation();

  return (
    <section className="glass-card rounded-xl p-4">
      <div className="text-[11px] uppercase tracking-wide text-white/45 mb-3">{t('runtimeEvents')}</div>
      <div className="space-y-3">
        {events.length > 0 ? events.slice(0, 10).map((event) => (
          <div key={`${event.type}-${event.at || 'unknown'}`} className="border-l border-cyan-400/30 pl-3">
            <div className="text-xs font-mono text-white/45">{formatTime(event.at)}</div>
            <div className="text-sm text-white/85">{event.type}</div>
            <div className="text-xs text-white/55 break-all">{extractEventSummary(event)}</div>
          </div>
        )) : (
          <div className="text-sm text-white/45">{t('noRecentEvents')}</div>
        )}
      </div>
    </section>
  );
};

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

const ArtifactRefs: React.FC<{ refs: Array<[string, string | string[] | undefined]> }> = ({ refs }) => {
  const { t } = useTranslation();
  return (
    <div className="space-y-2">
      {refs.length > 0 ? refs.map(([key, value]) => (
        <div key={key} className="text-sm text-white/80">
          <span className="font-mono text-white/55">{key}</span>: <span className="font-mono break-all">{Array.isArray(value) ? value.join('; ') : value}</span>
        </div>
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
            {(['summary', 'refs', 'retained'] as const).map((tab) => (
              <ArtifactTabButton
                key={tab}
                tab={tab}
                activeTab={activeTab}
                label={tab === 'summary' ? t('summary') : tab === 'refs' ? t('artifactRefs') : t('artifactRetainedContent')}
                onSelect={setActiveTab}
              />
            ))}
          </div>
          {activeTab === 'summary' && <ArtifactSummaryDetails bundle={latestBundle} />}
          {activeTab === 'refs' && <ArtifactRefs refs={refs} />}
          {activeTab === 'retained' && <ArtifactRetainedContent entries={retainedEntries} />}
        </>
      ) : (
        <div className="text-sm text-white/45">{t('noArtifacts')}</div>
      )}
    </section>
  );
};
