import React, { useState, useMemo } from 'react';
import { useTranslation } from '@/lib/i18n';
import { Badge } from './UI';
export { TaskDetailsPanel } from './TaskDetailsPanel';

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

const TASK_PAGE_SIZE = 10;

const formatTime = (isoString?: string): string => {
  if (!isoString) return '--:--:--';
  const date = new Date(isoString);
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  return `${hours}:${minutes}:${seconds}`;
};

export const TaskList: React.FC<{
  tasks: Task[];
  selectedTaskId?: string | null;
  onSelect?: (taskId: string) => void;
}> = ({ tasks, selectedTaskId, onSelect }) => {
  const { t } = useTranslation();
  const [currentPage, setCurrentPage] = useState(1);

  const { currentTasks, totalPages, visiblePage } = useMemo(() => {
    const totalPages = Math.max(1, Math.ceil(tasks.length / TASK_PAGE_SIZE));
    const visiblePage = Math.min(currentPage, totalPages);
    const start = (visiblePage - 1) * TASK_PAGE_SIZE;
    return {
      currentTasks: tasks.slice(start, start + TASK_PAGE_SIZE),
      totalPages,
      visiblePage,
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
                <div className="flex items-center gap-3 min-w-0">
                  <span className="text-cyan-400/60 font-mono text-xs font-bold tracking-tight group-hover:text-cyan-400 transition-colors">
                    [{task.id.split(':')[0]}]
                  </span>
                  <span className="text-white group-hover:text-white text-sm font-semibold tracking-wide transition-colors truncate">
                    {task.title}
                  </span>
                </div>
                <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-white/50 font-mono">
                  <span className="flex gap-1.5 items-center min-w-0">
                    <span className="text-white/40 uppercase">{t('worker')}</span>
                    <span className="text-white/70 truncate">{task.assignedWorkerId || t('unassigned')}</span>
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
            disabled={visiblePage === 1}
            onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
            className="glass-button px-4 py-2 text-xs uppercase font-semibold rounded-lg text-white/70 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed"
          >
            {t('previous')}
          </button>
          <span data-testid="page-indicator" className="text-xs font-mono text-cyan-400/70 tracking-widest glass-button px-3 py-1 rounded-full">
            {visiblePage} / {totalPages}
          </span>
          <button
            disabled={visiblePage === totalPages}
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

export const WorkerList: React.FC<{
  workers: Worker[];
  updatingWorkerId?: string | null;
  onAction: (id: string, enable: boolean) => void;
}> = ({ workers, updatingWorkerId, onAction }) => {
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
          <div className="flex justify-between items-center gap-3 mb-2">
            <div className="flex items-center gap-3 min-w-0">
              <span className="text-white/50 font-mono text-xs font-bold tracking-tight group-hover:text-white/80 transition-colors truncate">
                [{w.id}]
              </span>
              <span className="glass-button px-2 py-0.5 rounded text-white/60 text-xs uppercase tracking-wide">
                Pool: {w.pool}
              </span>
            </div>
            <Badge status={w.status}>{t(`status.${w.status}`)}</Badge>
          </div>

          <div className="flex flex-col sm:flex-row sm:justify-between sm:items-end gap-3 mt-2">
            <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-white/50 font-mono min-w-0">
              <span className="flex gap-1.5 items-center min-w-0">
                <span className="text-white/40 uppercase">{t('task')}</span>
                <span className={`${w.currentTaskId ? 'text-cyan-400/80' : 'text-white/50'} truncate`}>{w.currentTaskId || t('none')}</span>
              </span>
              <span className="flex gap-1.5 items-center min-w-0">
                <span className="text-white/40 uppercase">{t('host')}</span>
                <span className="text-white/70 truncate">{w.hostname || '-'}</span>
              </span>
            </div>

            <button
              onClick={() => onAction(w.id, w.status === 'disabled')}
              disabled={updatingWorkerId === w.id}
              className={`px-3 py-1.5 rounded-lg border text-xs uppercase font-semibold tracking-wide transition-all duration-200
                ${w.status === 'disabled'
                  ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 hover:border-emerald-500/50'
                  : 'border-white/20 bg-white/5 text-white/70 hover:bg-rose-500/20 hover:border-rose-500/30 hover:text-rose-300'}
                disabled:opacity-50 disabled:cursor-not-allowed`}
            >
              {updatingWorkerId === w.id ? t('updating') : w.status === 'disabled' ? t('enable') : t('disable')}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
};
