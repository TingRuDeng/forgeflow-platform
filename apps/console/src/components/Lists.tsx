import React, { useState, useMemo } from 'react';
import { useTranslation } from '@/lib/i18n';
import { Badge } from './UI';

interface Task {
  id: string;
  title: string;
  status: string;
  assignedWorkerId?: string;
  branchName?: string;
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

  if (!tasks.length) return <div className="p-10 text-center text-sm text-zinc-600 italic">{t('noActiveTasks')}</div>;

  return (
    <div className="flex flex-col">
      <div className="divide-y divide-zinc-900">
        {currentTasks.map(task => (
          <div key={task.id} className="p-4 hover:bg-zinc-900/40 transition-colors">
            <div className="flex justify-between items-center mb-2">
              <div className="flex items-center gap-3">
                <span className="text-primary font-bold text-xs tracking-tighter">[{task.id}]</span>
                <span className="text-zinc-200 text-sm font-medium">{task.title}</span>
              </div>
              <Badge status={task.status}>{t(`status.${task.status}`)}</Badge>
            </div>
            <div className="flex gap-4 text-[10px] text-zinc-500 font-mono">
              <span>{t('worker')}: <span className="text-zinc-400">{task.assignedWorkerId || t('unassigned')}</span></span>
              <span>{t('branch')}: <span className="text-zinc-400">{task.branchName || '-'}</span></span>
            </div>
          </div>
        ))}
      </div>
      
      {totalPages > 1 && (
        <div className="p-4 border-t border-zinc-900 flex justify-between items-center bg-zinc-950/50">
          <button
            disabled={currentPage === 1}
            onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
            className="px-3 py-1 text-[10px] uppercase font-bold border border-zinc-800 rounded bg-zinc-900 text-zinc-400 hover:bg-zinc-800 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            {t('previous')}
          </button>
          <span className="text-[10px] font-mono text-zinc-500">
            {t('page')} {currentPage} / {totalPages}
          </span>
          <button
            disabled={currentPage === totalPages}
            onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
            className="px-3 py-1 text-[10px] uppercase font-bold border border-zinc-800 rounded bg-zinc-900 text-zinc-400 hover:bg-zinc-800 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
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
  if (!workers.length) return <div className="p-10 text-center text-sm text-zinc-600 italic">{t('noActiveWorkers')}</div>;

  return (
    <div className="divide-y divide-zinc-900">
      {workers.map(w => (
        <div key={w.id} className="p-4 hover:bg-zinc-900/40 transition-colors group">
          <div className="flex justify-between items-center mb-2">
            <div className="flex items-center gap-3">
              <span className="text-zinc-400 font-bold text-xs tracking-tighter">[{w.id}]</span>
              <span className="text-zinc-500 text-[10px] uppercase">Pool: {w.pool}</span>
            </div>
            <Badge status={w.status}>{t(`status.${w.status}`)}</Badge>
          </div>
          <div className="flex justify-between items-end">
            <div className="flex gap-4 text-[10px] text-zinc-500 font-mono">
              <span>{t('task')}: <span className="text-zinc-400">{w.currentTaskId || t('none')}</span></span>
              <span>{t('host')}: <span className="text-zinc-400">{w.hostname || '-'}</span></span>
            </div>
            <button
              onClick={() => onAction(w.id, w.status === 'disabled')}
              className="px-2 py-0.5 rounded border border-zinc-800 bg-zinc-900 text-[9px] text-zinc-400 hover:bg-primary hover:text-black transition-colors uppercase font-bold"
            >
              {w.status === 'disabled' ? t('enable') : t('disable')}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
};
