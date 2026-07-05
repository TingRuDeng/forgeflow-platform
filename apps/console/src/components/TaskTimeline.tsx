import React, { useState } from 'react';
import { ChevronsDown, ChevronsUp } from 'lucide-react';
import { useTranslation } from '@/lib/i18n';
export { ArtifactSummary, type ArtifactBundle } from './ArtifactSummary';

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

const RUNTIME_EVENT_PREVIEW_LIMIT = 10;

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
  const [expanded, setExpanded] = useState(false);
  const [eventTypeFilter, setEventTypeFilter] = useState('all');
  const eventTypes = [...new Set(events.map((event) => event.type).filter(Boolean))].sort();
  const filteredEvents = eventTypeFilter === 'all'
    ? events
    : events.filter((event) => event.type === eventTypeFilter);
  const hasOverflow = filteredEvents.length > RUNTIME_EVENT_PREVIEW_LIMIT;
  const visibleEvents = expanded ? filteredEvents : filteredEvents.slice(0, RUNTIME_EVENT_PREVIEW_LIMIT);

  return (
    <section className="glass-card rounded-xl p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <div className="text-[11px] uppercase tracking-wide text-white/45">{t('runtimeEvents')}</div>
          {events.length > 0 && (
            <div className="mt-1 text-xs text-white/45">
              {t('runtimeEventCount')}: <span className="font-mono">{visibleEvents.length} / {filteredEvents.length}</span>
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {eventTypes.length > 1 && (
            <label className="flex items-center gap-2 text-xs text-white/55">
              <span>{t('runtimeEventTypeFilter')}</span>
              <select
                value={eventTypeFilter}
                onChange={(event) => {
                  setEventTypeFilter(event.target.value);
                  setExpanded(false);
                }}
                className="rounded-lg border border-white/10 bg-black/30 px-2 py-1.5 font-mono text-xs text-white outline-none focus:border-cyan-300/60"
              >
                <option value="all">{t('allRuntimeEventTypes')}</option>
                {eventTypes.map((eventType) => (
                  <option key={eventType} value={eventType}>{eventType}</option>
                ))}
              </select>
            </label>
          )}
          {hasOverflow && (
            <button
              type="button"
              onClick={() => setExpanded((value) => !value)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-400/25 bg-cyan-400/10 px-2.5 py-1.5 text-xs font-semibold text-cyan-100 transition-colors hover:bg-cyan-400/20"
            >
              {expanded ? <ChevronsUp size={14} aria-hidden="true" /> : <ChevronsDown size={14} aria-hidden="true" />}
              {expanded ? t('collapseRuntimeEvents') : t('showAllRuntimeEvents')}
            </button>
          )}
        </div>
      </div>
      <div className="space-y-3">
        {visibleEvents.length > 0 ? visibleEvents.map((event) => (
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
