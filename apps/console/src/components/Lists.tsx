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
      <div className="divide-y divide-zinc-900/50">
        {currentTasks.map(task => (
          <div 
            key={task.id} 
            className="group relative p-4 border-l-2 border-transparent hover:border-primary/60 hover:bg-zinc-900/30 transition-all duration-300"
          >
            <div className="flex justify-between items-start mb-2">
              <div className="flex flex-col gap-2 flex-1 min-w-0">
                <div className="flex items-center gap-3">
                  <span className="text-primary/60 font-mono text-[11px] font-bold tracking-tighter group-hover:text-primary transition-colors">
                    [{task.id}]
                  </span>
                  <span className="text-zinc-300 group-hover:text-zinc-100 text-[14px] font-semibold tracking-wide transition-colors">
                    {task.title}
                  </span>
                </div>
                <div className="flex gap-5 text-[10px] text-zinc-600 font-mono">
                  <span className="flex gap-1.5 items-center">
                    <span className="text-zinc-700 uppercase">{t('worker')}</span>
                    <span className="text-zinc-400">{task.assignedWorkerId || t('unassigned')}</span>
                  </span>
                  <span className="flex gap-1.5 items-center">
                    <span className="text-zinc-700 uppercase">{t('branch')}</span>
                    <span className="text-zinc-400 truncate max-w-[200px]">{task.branchName || '-'}</span>
                  </span>
                </div>
              </div>

              <div className="flex flex-col items-end gap-2 ml-4 shrink-0">
                <Badge status={task.status}>{t(`status.${task.status}`)}</Badge>
                {(task.updatedAt || task.createdAt) && (
                  <span className="text-[11px] font-bold font-mono text-zinc-300 bg-zinc-900 border border-zinc-700/50 px-2 py-1 rounded shadow-lg">
                    {(task.updatedAt || task.createdAt)?.split('T')[1]?.split('.')[0] || '--:--:--'}
                  </span>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
      
      {totalPages > 1 && (
        <div className="p-3 border-t border-zinc-900 flex justify-between items-center bg-[#050505] mt-auto">
          <button
            disabled={currentPage === 1}
            onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
            className="px-4 py-1.5 text-[10px] uppercase font-bold border border-zinc-800 rounded bg-zinc-900 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            {t('previous')}
          </button>
          <span data-testid="page-indicator" className="text-[10px] font-mono text-primary/70 tracking-widest bg-primary/10 px-3 py-1 rounded-full">
            {currentPage} / {totalPages}
          </span>
          <button
            disabled={currentPage === totalPages}
            onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
            className="px-4 py-1.5 text-[10px] uppercase font-bold border border-zinc-800 rounded bg-zinc-900 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
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
    <div className="divide-y divide-zinc-900/50 grid grid-cols-1">
      {workers.map(w => (
        <div key={w.id} className="group p-4 border-l-2 border-transparent hover:border-zinc-500/50 hover:bg-zinc-900/30 transition-all duration-300">
          <div className="flex justify-between items-center mb-2">
            <div className="flex items-center gap-3">
              <span className="text-zinc-500 font-mono text-[11px] font-bold tracking-tighter group-hover:text-zinc-300 transition-colors">
                [{w.id}]
              </span>
              <span className="px-2 py-0.5 bg-zinc-900 border border-zinc-800 rounded text-zinc-400 text-[9px] uppercase tracking-wider">
                Pool: {w.pool}
              </span>
            </div>
            <Badge status={w.status}>{t(`status.${w.status}`)}</Badge>
          </div>
          
          <div className="flex justify-between items-end mt-2">
            <div className="flex gap-5 text-[10px] text-zinc-600 font-mono">
              <span className="flex gap-1.5 items-center">
                <span className="text-zinc-700 uppercase">{t('task')}</span>
                <span className={`${w.currentTaskId ? 'text-primary/80' : 'text-zinc-500'}`}>{w.currentTaskId || t('none')}</span>
              </span>
              <span className="flex gap-1.5 items-center">
                <span className="text-zinc-700 uppercase">{t('host')}</span>
                <span className="text-zinc-400">{w.hostname || '-'}</span>
              </span>
            </div>
            
            <button
              onClick={() => onAction(w.id, w.status === 'disabled')}
              className={`px-3 py-1 rounded border text-[9px] uppercase font-bold tracking-widest transition-all duration-300
                ${w.status === 'disabled' 
                  ? 'border-emerald-900/50 bg-emerald-950/20 text-emerald-500 hover:bg-emerald-500 hover:text-black hover:shadow-[0_0_10px_rgba(16,185,129,0.4)]' 
                  : 'border-zinc-700 bg-zinc-900 text-zinc-400 hover:bg-rose-500 hover:border-rose-500 hover:text-white hover:shadow-[0_0_10px_rgba(244,63,94,0.4)]'}`}
            >
              {w.status === 'disabled' ? t('enable') : t('disable')}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
};
