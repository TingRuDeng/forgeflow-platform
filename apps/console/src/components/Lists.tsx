import React, { useState, useMemo } from 'react';
import { useTranslation } from '@/lib/i18n';
import { Badge } from './UI';
import { ArtifactSummary, AttemptTimeline, RuntimeEventList, type ArtifactBundle, type TaskAttempt } from './TaskTimeline';

interface Task {
  id: string;
  traceId?: string | null;
  title: string;
  status: string;
  assignedWorkerId?: string;
  branchName?: string;
  updatedAt?: string;
  createdAt?: string;
  repo?: string;
  pool?: string;
  continueFromTaskId?: string;
  followUpOfTaskId?: string;
  lastAssignedWorkerId?: string;
}

interface Worker {
  id: string;
  pool: string;
  status: string;
  currentTaskId?: string;
  hostname?: string;
}

interface Assignment {
  taskId: string;
  workerId?: string;
  branchName?: string;
  repo?: string;
  pool?: string;
  status?: string;
  targetWorkerId?: string;
}

interface Review {
  taskId: string;
  decision?: string | null;
  actor?: string | null;
  decidedAt?: string;
  at?: string;
  notes?: string | null;
  evidence?: {
    reasonCode?: string;
    mustFix?: string[];
    canRedrive?: boolean;
    redriveStrategy?: string;
  } | null;
  latestWorkerResult?: {
    evidence?: {
      failureType?: string;
      blockers?: Array<{ code?: string }>;
      failureSummary?: string;
    } | null;
  } | null;
}

interface PullRequest {
  taskId: string;
  url?: string;
  status?: string;
  number?: number;
}

interface EventRecord {
  taskId: string;
  type: string;
  at?: string;
  summary?: string;
  payload?: {
    message?: string;
    traceId?: string;
    sessionId?: string;
    failureCode?: string;
    failureSummary?: string;
    data?: {
      message?: string;
      traceId?: string;
      sessionId?: string;
      failureCode?: string;
    } | null;
  } | null;
}

const formatTime = (isoString?: string): string => {
  if (!isoString) return '--:--:--';
  const date = new Date(isoString);
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  return `${hours}:${minutes}:${seconds}`;
};

function extractFailureSummary(review: Review | null, events: EventRecord[]): string | null {
  const reviewFailure = review?.latestWorkerResult?.evidence?.failureSummary?.trim();
  if (reviewFailure) {
    return reviewFailure;
  }

  const failedStatusEvent = [...events].find((event) => event.type === 'status_changed' && event.payload?.failureSummary);
  return failedStatusEvent?.payload?.failureSummary?.trim() || null;
}

function extractLatestProgress(events: EventRecord[]) {
  return [...events].find((event) => event.type === 'progress_reported') || null;
}

function canCancelTask(status?: string) {
  return !['merged', 'failed', 'cancelled'].includes(String(status || '').toLowerCase());
}

export const TaskList: React.FC<{
  tasks: Task[];
  selectedTaskId?: string | null;
  onSelect?: (taskId: string) => void;
}> = ({ tasks, selectedTaskId, onSelect }) => {
  const { t } = useTranslation();
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 10;

  const { currentTasks, totalPages } = useMemo(() => {
    const total = Math.ceil(tasks.length / pageSize);
    const start = (currentPage - 1) * pageSize;
    return {
      currentTasks: tasks.slice(start, start + pageSize),
      totalPages: Math.max(1, total)
    };
  }, [tasks, currentPage]);

  if (!tasks.length) return <div className="p-10 text-center text-sm text-zinc-600 italic font-mono">{t('noActiveTasks')}</div>;

  return (
    <div className="flex flex-col h-full">
      <div className="divide-y divide-white/5">
        {currentTasks.map(task => (
          <div
            key={task.id}
            className={`group relative p-4 border-l-[3px] transition-all duration-200 ${selectedTaskId === task.id ? 'border-cyan-400 bg-cyan-500/10' : 'border-transparent hover:border-cyan-400 hover:bg-white/5'} ${onSelect ? 'cursor-pointer' : ''}`}
            onClick={() => onSelect?.(task.id)}
          >
            <div className="flex justify-between items-start mb-2">
              <div className="flex flex-col gap-2 flex-1 min-w-0">
                <div className="flex items-center gap-3">
                  <span className="text-cyan-400/60 font-mono text-xs font-bold tracking-tight group-hover:text-cyan-400 transition-colors">
                    [{task.id.split(':')[0]}]
                  </span>
                  <span className="text-white group-hover:text-white text-sm font-semibold tracking-wide transition-colors">
                    {task.title}
                  </span>
                </div>
                <div className="flex gap-5 text-xs text-white/50 font-mono">
                  <span className="flex gap-1.5 items-center">
                    <span className="text-white/40 uppercase">{t('worker')}</span>
                    <span className="text-white/70">{task.assignedWorkerId || t('unassigned')}</span>
                  </span>
                  <span className="flex gap-1.5 items-center">
                    <span className="text-white/40 uppercase">{t('branch')}</span>
                    <span className="text-white/70 truncate max-w-[200px]">{task.branchName || '-'}</span>
                  </span>
                </div>
              </div>

              <div className="flex flex-col items-end gap-2 ml-4 shrink-0">
                <Badge status={task.status}>{t(`status.${task.status}`)}</Badge>
                {(task.updatedAt || task.createdAt) && (
                  <span className="text-xs font-bold font-mono text-white/70 glass-button px-2 py-1 rounded">
                    {formatTime(task.updatedAt || task.createdAt)}
                  </span>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {totalPages > 1 && (
        <div className="p-3 border-t border-white/10 flex justify-between items-center glass-card mt-auto">
          <button
            disabled={currentPage === 1}
            onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
            className="glass-button px-4 py-2 text-xs uppercase font-semibold rounded-lg text-white/70 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed"
          >
            {t('previous')}
          </button>
          <span data-testid="page-indicator" className="text-xs font-mono text-cyan-400/70 tracking-widest glass-button px-3 py-1 rounded-full">
            {currentPage} / {totalPages}
          </span>
          <button
            disabled={currentPage === totalPages}
            onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
            className="glass-button px-4 py-2 text-xs uppercase font-semibold rounded-lg text-white/70 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed"
          >
            {t('next')}
          </button>
        </div>
      )}
    </div>
  );
};

export const TaskDetailsPanel: React.FC<{
  task: Task | null;
  assignment?: Assignment | null;
  review?: Review | null;
  pullRequest?: PullRequest | null;
  events?: EventRecord[];
  attempts?: TaskAttempt[];
  artifactBundles?: ArtifactBundle[];
  cancellingTaskId?: string | null;
  onCancel?: (task: Task) => void;
}> = ({ task, assignment, review, pullRequest, events = [], attempts = [], artifactBundles = [], cancellingTaskId, onCancel }) => {
  const { t } = useTranslation();

  if (!task) {
    return (
      <div className="h-full border-l border-white/10 p-5 text-sm text-white/45">
        {t('selectTaskHint')}
      </div>
    );
  }

  const latestProgress = extractLatestProgress(events);
  const failureSummary = extractFailureSummary(review || null, events);
  const failureType = review?.latestWorkerResult?.evidence?.failureType || null;
  const failureCode = review?.latestWorkerResult?.evidence?.blockers?.[0]?.code || null;
  const reasonCode = review?.evidence?.reasonCode || null;
  const mustFix = review?.evidence?.mustFix || [];
  const canRedriveValue = typeof review?.evidence?.canRedrive === 'boolean'
    ? (review?.evidence?.canRedrive ? t('yes') : t('no'))
    : '--';
  const workerId = assignment?.workerId || task.lastAssignedWorkerId || task.assignedWorkerId || '--';
  const parentTaskId = task.continueFromTaskId || task.followUpOfTaskId || null;

  return (
    <aside className="border-l border-white/10 bg-black/10 p-5 flex flex-col gap-5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="text-[11px] uppercase tracking-[0.24em] text-cyan-300/60 font-semibold">{t('taskDetails')}</div>
          <h3 className="mt-2 text-lg font-semibold text-white break-all">{task.title || task.id}</h3>
          <div className="mt-2 text-xs font-mono text-white/45">{task.id}</div>
        </div>
        <div className="flex flex-col items-end gap-2">
          <Badge status={task.status}>{t(`status.${task.status}`)}</Badge>
          {canCancelTask(task.status) && onCancel && (
            <button
              type="button"
              onClick={() => onCancel(task)}
              disabled={cancellingTaskId === task.id}
              className="px-3 py-1.5 rounded-lg border border-rose-500/30 bg-rose-500/10 text-rose-200 text-xs font-semibold uppercase tracking-wide transition-colors hover:bg-rose-500/20 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {cancellingTaskId === task.id ? t('cancellingTask') : t('cancelTask')}
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 text-sm">
        <div className="glass-card rounded-xl p-3">
          <div className="text-[11px] uppercase tracking-wide text-white/45">{t('worker')}</div>
          <div className="mt-1 font-mono text-white/80 break-all">{workerId}</div>
        </div>
        <div className="glass-card rounded-xl p-3">
          <div className="text-[11px] uppercase tracking-wide text-white/45">{t('branch')}</div>
          <div className="mt-1 font-mono text-white/80 break-all">{task.branchName || assignment?.branchName || '--'}</div>
        </div>
        <div className="glass-card rounded-xl p-3">
          <div className="text-[11px] uppercase tracking-wide text-white/45">{t('repo')}</div>
          <div className="mt-1 font-mono text-white/80 break-all">{task.repo || assignment?.repo || '--'}</div>
        </div>
        <div className="glass-card rounded-xl p-3">
          <div className="text-[11px] uppercase tracking-wide text-white/45">{t('pool')}</div>
          <div className="mt-1 font-mono text-white/80 break-all">{task.pool || assignment?.pool || '--'}</div>
        </div>
      </div>

      <section className="glass-card rounded-xl p-4 space-y-2">
        <div className="text-[11px] uppercase tracking-wide text-white/45">{t('lineage')}</div>
        <div className="text-sm text-white/80">{t('traceId')}: <span className="font-mono break-all">{task.traceId || '--'}</span></div>
        <div className="text-sm text-white/80">{t('parentTask')}: <span className="font-mono break-all">{parentTaskId || '--'}</span></div>
        <div className="text-sm text-white/80">{t('continueFrom')}: <span className="font-mono break-all">{task.continueFromTaskId || '--'}</span></div>
        <div className="text-sm text-white/80">{t('followUpOf')}: <span className="font-mono break-all">{task.followUpOfTaskId || '--'}</span></div>
      </section>

      <section className="glass-card rounded-xl p-4 space-y-2">
        <div className="text-[11px] uppercase tracking-wide text-white/45">{t('latestReview')}</div>
        <div className="text-sm text-white/80">{t('decision')}: <span className="font-mono">{review?.decision || '--'}</span></div>
        <div className="text-sm text-white/80">{t('actor')}: <span className="font-mono break-all">{review?.actor || '--'}</span></div>
        <div className="text-sm text-white/80">{t('updatedAtLabel')}: <span className="font-mono">{formatTime(review?.decidedAt || review?.at)}</span></div>
        <div className="text-sm text-white/80">{t('reasonCode')}: <span className="font-mono break-all">{reasonCode || '--'}</span></div>
        <div className="text-sm text-white/80">{t('canRedrive')}: <span className="font-mono">{canRedriveValue}</span></div>
        <div className="text-sm text-white/80">{t('redriveStrategy')}: <span className="font-mono break-all">{review?.evidence?.redriveStrategy || '--'}</span></div>
        <div className="text-sm text-white/80">{t('notes')}: <span className="break-all">{review?.notes || '--'}</span></div>
        <div className="text-sm text-white/80">{t('mustFix')}: <span className="break-all">{mustFix.length > 0 ? mustFix.join('; ') : '--'}</span></div>
      </section>

      <section className="glass-card rounded-xl p-4 space-y-2">
        <div className="text-[11px] uppercase tracking-wide text-white/45">{t('latestFailure')}</div>
        <div className="text-sm text-white/80">{t('failureType')}: <span className="font-mono">{failureType || '--'}</span></div>
        <div className="text-sm text-white/80">{t('failureCode')}: <span className="font-mono">{failureCode || '--'}</span></div>
        <div className="text-sm text-white/80">{t('failureSummary')}: <span className="break-all">{failureSummary || '--'}</span></div>
        <div className="text-sm text-white/80">{t('latestProgress')}: <span className="break-all">{latestProgress?.payload?.message || latestProgress?.summary || '--'}</span></div>
      </section>

      <section className="glass-card rounded-xl p-4 space-y-2">
        <div className="text-[11px] uppercase tracking-wide text-white/45">PR</div>
        <div className="text-sm text-white/80">{t('statusLabel')}: <span className="font-mono">{pullRequest?.status || '--'}</span></div>
        <div className="text-sm text-white/80">{t('prNumber')}: <span className="font-mono">{pullRequest?.number ?? '--'}</span></div>
        <div className="text-sm text-white/80">{t('url')}: {pullRequest?.url ? <a className="text-cyan-300 underline break-all" href={pullRequest.url} target="_blank" rel="noreferrer">{pullRequest.url}</a> : '--'}</div>
      </section>

      <AttemptTimeline attempts={attempts} />

      <ArtifactSummary bundles={artifactBundles} />

      <RuntimeEventList events={events} />
    </aside>
  );
};

export const WorkerList: React.FC<{ workers: Worker[]; onAction: (id: string, enable: boolean) => void }> = ({ workers, onAction }) => {
  const { t } = useTranslation();
  if (!workers.length) return <div className="p-10 text-center text-sm text-zinc-600 italic font-mono">{t('noActiveWorkers')}</div>;

  const sortedWorkers = [...workers].sort((a, b) => {
    if (a.status === 'disabled' && b.status !== 'disabled') return 1;
    if (a.status !== 'disabled' && b.status === 'disabled') return -1;
    return 0;
  });

  return (
    <div className="divide-y divide-white/5 grid grid-cols-1">
      {sortedWorkers.map(w => (
        <div key={w.id} className="group p-4 border-l-[3px] border-transparent hover:border-white/30 hover:bg-white/5 transition-all duration-200">
          <div className="flex justify-between items-center mb-2">
            <div className="flex items-center gap-3">
              <span className="text-white/50 font-mono text-xs font-bold tracking-tight group-hover:text-white/80 transition-colors">
                [{w.id}]
              </span>
              <span className="glass-button px-2 py-0.5 rounded text-white/60 text-xs uppercase tracking-wide">
                Pool: {w.pool}
              </span>
            </div>
            <Badge status={w.status}>{t(`status.${w.status}`)}</Badge>
          </div>

          <div className="flex justify-between items-end mt-2">
            <div className="flex gap-5 text-xs text-white/50 font-mono">
              <span className="flex gap-1.5 items-center">
                <span className="text-white/40 uppercase">{t('task')}</span>
                <span className={`${w.currentTaskId ? 'text-cyan-400/80' : 'text-white/50'}`}>{w.currentTaskId || t('none')}</span>
              </span>
              <span className="flex gap-1.5 items-center">
                <span className="text-white/40 uppercase">{t('host')}</span>
                <span className="text-white/70">{w.hostname || '-'}</span>
              </span>
            </div>

            <button
              onClick={() => onAction(w.id, w.status === 'disabled')}
              className={`px-3 py-1.5 rounded-lg border text-xs uppercase font-semibold tracking-wide transition-all duration-200
                ${w.status === 'disabled'
                  ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 hover:border-emerald-500/50'
                  : 'border-white/20 bg-white/5 text-white/70 hover:bg-rose-500/20 hover:border-rose-500/30 hover:text-rose-300'}`}
            >
              {w.status === 'disabled' ? t('enable') : t('disable')}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
};
