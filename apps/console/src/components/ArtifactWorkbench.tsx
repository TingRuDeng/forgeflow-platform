import React from 'react';
import { Search } from 'lucide-react';
import { useTranslation } from '@/lib/i18n';
import type { ArtifactBundle } from './TaskTimeline';

interface TaskSummary {
  id: string;
  title?: string;
  status?: string;
  repo?: string;
}

interface ArtifactWorkbenchProps {
  bundles: ArtifactBundle[];
  tasks: TaskSummary[];
  selectedTaskId?: string | null;
  onSelectTask?: (taskId: string) => void;
}

function normalize(value: unknown): string {
  return String(value ?? '').toLowerCase();
}

function countRefs(bundle: ArtifactBundle): number {
  return Object.values(bundle.refs ?? {}).reduce((total, value) => {
    if (Array.isArray(value)) return total + value.length;
    return value ? total + 1 : total;
  }, 0);
}

function bundleMatches(bundle: ArtifactBundle, task: TaskSummary | undefined, query: string): boolean {
  if (!query) return true;
  const searchable = [
    bundle.bundleId,
    bundle.taskId,
    bundle.attemptId,
    bundle.summary,
    task?.title,
    task?.status,
    task?.repo,
    ...(bundle.changedFiles ?? []).map((file) => file.path),
    ...Object.keys(bundle.refs ?? {}),
  ].map(normalize).join(' ');
  return searchable.includes(query);
}

export const ArtifactWorkbench: React.FC<ArtifactWorkbenchProps> = ({
  bundles,
  tasks,
  selectedTaskId,
  onSelectTask,
}) => {
  const { t } = useTranslation();
  const [query, setQuery] = React.useState('');
  const normalizedQuery = query.trim().toLowerCase();
  const taskById = React.useMemo(() => new Map(tasks.map((task) => [task.id, task])), [tasks]);
  const filteredBundles = React.useMemo(() => {
    return bundles
      .filter((bundle) => bundleMatches(bundle, taskById.get(bundle.taskId), normalizedQuery))
      .slice()
      .reverse();
  }, [bundles, normalizedQuery, taskById]);

  return (
    <div className="p-4 space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-3">
        <label className="relative block">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-white/35" aria-hidden="true" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('artifactSearchPlaceholder')}
            className="w-full rounded-lg border border-white/10 bg-black/20 py-2 pl-9 pr-3 text-sm text-white/85 outline-none placeholder:text-white/35 focus:border-cyan-300/60"
          />
        </label>
        <div className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-xs font-mono text-white/60">
          {filteredBundles.length} / {bundles.length}
        </div>
      </div>

      {filteredBundles.length > 0 ? (
        <div className="grid grid-cols-1 gap-2">
          {filteredBundles.map((bundle) => {
            const task = taskById.get(bundle.taskId);
            const active = selectedTaskId === bundle.taskId;
            return (
              <button
                key={`${bundle.bundleId || bundle.taskId}-${bundle.attemptId || 'attempt'}`}
                type="button"
                onClick={() => onSelectTask?.(bundle.taskId)}
                className={`rounded-lg border p-3 text-left transition-colors ${active ? 'border-cyan-300/55 bg-cyan-300/10' : 'border-white/10 bg-black/15 hover:border-white/25 hover:bg-white/5'}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-white/85 break-all">{task?.title || bundle.taskId}</div>
                    <div className="mt-1 text-xs font-mono text-white/45 break-all">{bundle.bundleId || bundle.attemptId || bundle.taskId}</div>
                  </div>
                  <div className="shrink-0 rounded-md border border-white/10 px-2 py-1 text-[11px] uppercase tracking-wide text-white/55">
                    {task?.status || '--'}
                  </div>
                </div>
                <div className="mt-2 text-xs text-white/60 break-all">{bundle.summary || t('noSummary')}</div>
                <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-white/45">
                  <span>{t('changedFiles')}: {(bundle.changedFiles ?? []).length}</span>
                  <span>{t('artifactRefs')}: {countRefs(bundle)}</span>
                  {task?.repo && <span>{t('repo')}: {task.repo}</span>}
                </div>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="rounded-lg border border-white/10 bg-black/15 p-4 text-center text-sm text-white/45">
          {t('noMatchingArtifacts')}
        </div>
      )}
    </div>
  );
};
