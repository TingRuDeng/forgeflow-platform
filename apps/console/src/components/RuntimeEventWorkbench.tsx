import React from 'react';
import { Search } from 'lucide-react';
import { useTranslation } from '@/lib/i18n';

interface TaskSummary {
  id: string;
  title?: string;
  status?: string;
  repo?: string;
}

interface RuntimeEvent {
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

interface RuntimeEventWorkbenchProps {
  events: RuntimeEvent[];
  tasks: TaskSummary[];
  onSelectTask?: (taskId: string) => void;
}

function normalize(value: unknown): string {
  return String(value ?? '').toLowerCase();
}

function formatTime(isoString?: string): string {
  if (!isoString) return '--:--:--';
  const date = new Date(isoString);
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  return `${hours}:${minutes}:${seconds}`;
}

function extractEventSummary(event: RuntimeEvent): string {
  return event.summary
    || event.payload?.message
    || event.payload?.data?.message
    || event.payload?.failureCode
    || event.payload?.data?.failureCode
    || '--';
}

function countEventTypes(events: RuntimeEvent[]): Array<[string, number]> {
  const counts = new Map<string, number>();
  events.forEach((event) => {
    if (!event.type) return;
    counts.set(event.type, (counts.get(event.type) ?? 0) + 1);
  });
  return [...counts.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));
}

function eventMatches(event: RuntimeEvent, task: TaskSummary | undefined, query: string): boolean {
  if (!query) return true;
  const searchable = [
    event.taskId,
    event.type,
    event.at,
    extractEventSummary(event),
    task?.title,
    task?.status,
    task?.repo,
  ].map(normalize).join(' ');
  return searchable.includes(query);
}

export const RuntimeEventWorkbench: React.FC<RuntimeEventWorkbenchProps> = ({
  events,
  tasks,
  onSelectTask,
}) => {
  const { t } = useTranslation();
  const [query, setQuery] = React.useState('');
  const [eventTypeFilter, setEventTypeFilter] = React.useState('all');
  const normalizedQuery = query.trim().toLowerCase();
  const taskById = React.useMemo(() => new Map(tasks.map((task) => [task.id, task])), [tasks]);
  const eventTypeCounts = React.useMemo(() => countEventTypes(events), [events]);
  const filteredEvents = React.useMemo(() => {
    return events
      .filter((event) => eventTypeFilter === 'all' || event.type === eventTypeFilter)
      .filter((event) => eventMatches(event, taskById.get(event.taskId), normalizedQuery))
      .slice()
      .sort((left, right) => String(right.at ?? '').localeCompare(String(left.at ?? '')));
  }, [eventTypeFilter, events, normalizedQuery, taskById]);

  if (events.length === 0) return null;

  return (
    <section className="rounded-lg border border-white/10 bg-black/15 p-3">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="text-[11px] uppercase tracking-wide text-white/45">{t('runtimeEventSearch')}</div>
          <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-white/55">
            {eventTypeCounts.map(([eventType, count]) => (
              <span key={eventType} className="rounded border border-white/10 bg-white/5 px-2 py-1 font-mono">
                {eventType} {count}
              </span>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(180px,1fr)_auto]">
          <label className="relative block">
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-white/35" aria-hidden="true" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('runtimeEventSearchPlaceholder')}
              className="w-full rounded-lg border border-white/10 bg-black/20 py-2 pl-9 pr-3 text-sm text-white/85 outline-none placeholder:text-white/35 focus:border-cyan-300/60"
            />
          </label>
          <label className="flex items-center gap-2 text-xs text-white/55">
            <span>{t('runtimeEventTypeFilter')}</span>
            <select
              value={eventTypeFilter}
              onChange={(event) => setEventTypeFilter(event.target.value)}
              className="rounded-lg border border-white/10 bg-black/30 px-2 py-2 font-mono text-xs text-white outline-none focus:border-cyan-300/60"
            >
              <option value="all">{t('allRuntimeEventTypes')}</option>
              {eventTypeCounts.map(([eventType]) => (
                <option key={eventType} value={eventType}>{eventType}</option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-2">
        {filteredEvents.length > 0 ? filteredEvents.map((event) => {
          const task = taskById.get(event.taskId);
          return (
            <button
              key={`${event.taskId}-${event.type}-${event.at ?? 'unknown'}`}
              type="button"
              onClick={() => onSelectTask?.(event.taskId)}
              className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-left transition-colors hover:border-cyan-300/45 hover:bg-cyan-300/10"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-semibold text-white/85 break-all">{task?.title || event.taskId}</span>
                <span className="font-mono text-[11px] text-white/45">{formatTime(event.at)}</span>
              </div>
              <div className="mt-1 font-mono text-xs text-cyan-100">{event.type}</div>
              <div className="mt-1 text-xs text-white/55 break-all">{extractEventSummary(event)}</div>
            </button>
          );
        }) : (
          <div className="rounded border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-white/45">
            {t('noMatchingRuntimeEvents')}
          </div>
        )}
      </div>
    </section>
  );
};
