import React, { useState, useMemo } from 'react';
import { useTranslation } from '@/lib/i18n';
import { Badge } from './UI';

interface Task {
  id: string;
  title: string;
  status: string;
  assignedWorkerId?: string;
  branchName?: string;
  updatedAt?: string; // ISO timestamp
  createdAt?: string; // ISO timestamp
}

interface Worker {
  id: string;
  pool: string;
  status: string;
  currentTaskId?: string;
  hostname?: string;
}

export const TaskList: React.FC<{ tasks: Task[] }> = ({ tasks }) => {
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
            className="group relative p-4 border-l-[3px] border-transparent hover:border-cyan-400 hover:bg-white/5 transition-all duration-200"
          >
            <div className="flex justify-between items-start mb-2">
              <div className="flex flex-col gap-2 flex-1 min-w-0">
                <div className="flex items-center gap-3">
                  <span className="text-cyan-400/60 font-mono text-xs font-bold tracking-tight group-hover:text-cyan-400 transition-colors">
                    [{task.id}]
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
                    {(task.updatedAt || task.createdAt)?.split('T')[1]?.split('.')[0] || '--:--:--'}
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

export const WorkerList: React.FC<{ workers: Worker[]; onAction: (id: string, enable: boolean) => void }> = ({ workers, onAction }) => {
  const { t } = useTranslation();
  if (!workers.length) return <div className="p-10 text-center text-sm text-zinc-600 italic font-mono">{t('noActiveWorkers')}</div>;

  return (
    <div className="divide-y divide-white/5 grid grid-cols-1">
      {workers.map(w => (
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
