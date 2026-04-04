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

  if (!tasks.length) return <div className="p-10 text-center text-sm text-zinc-600 italic font-mono">{t('noActiveTasks')}</div>;

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1">
        {currentTasks.map(task => (
          <div key={task.id} className="group border-b border-zinc-900 last:border-0 hover:bg-zinc-900/30 transition-all px-5 py-3 flex items-center gap-4">
            <div className="flex-shrink-0 w-24">
              <span className="text-[10px] font-bold text-zinc-600 group-hover:text-primary transition-colors font-mono tracking-tighter block truncate">
                {task.id}
              </span>
            </div>
            
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-zinc-200 text-[13px] font-medium truncate group-hover:text-white transition-colors">
                  {task.title}
                </span>
              </div>
              <div className="flex gap-3 text-[9px] text-zinc-500 font-mono uppercase tracking-tight">
                <span className="flex items-center gap-1">
                  <span className="text-zinc-700">{t('worker')}:</span>
                  <span className="text-zinc-400 truncate max-w-[100px]">{task.assignedWorkerId || '-'}</span>
                </span>
                <span className="flex items-center gap-1">
                  <span className="text-zinc-700">{t('branch')}:</span>
                  <span className="text-zinc-400 truncate max-w-[150px]">{task.branchName || '-'}</span>
                </span>
              </div>
            </div>

            <div className="flex-shrink-0 text-right min-w-[80px]">
              <Badge status={task.status}>{t(`status.${task.status}`)}</Badge>
            </div>
          </div>
        ))}
      </div>
      
      {totalPages > 1 && (
        <div className="px-5 py-3 border-t border-zinc-900 flex justify-between items-center bg-black/20 backdrop-blur-sm mt-auto">
          <button
            disabled={currentPage === 1}
            onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
            className="px-2.5 py-1 text-[9px] uppercase font-black border border-zinc-800 rounded bg-zinc-900 text-zinc-500 hover:text-primary hover:border-primary/50 disabled:opacity-20 disabled:grayscale transition-all"
          >
            {t('previous')}
          </button>
          <span data-testid="page-indicator" className="text-[9px] font-black text-zinc-600 tracking-widest uppercase">
             {currentPage} <span className="text-zinc-800">/</span> {totalPages}
          </span>
          <button
            disabled={currentPage === totalPages}
            onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
            className="px-2.5 py-1 text-[9px] uppercase font-black border border-zinc-800 rounded bg-zinc-900 text-zinc-500 hover:text-primary hover:border-primary/50 disabled:opacity-20 disabled:grayscale transition-all"
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
    <div className="flex flex-col">
      {workers.map(w => (
        <div key={w.id} className="p-4 border-b border-zinc-900 last:border-0 hover:bg-zinc-900/30 transition-all group">
          <div className="flex justify-between items-start mb-2">
            <div className="flex items-center gap-2">
              <div className={`w-1.5 h-1.5 rounded-full ${w.status === 'busy' ? 'bg-amber-500 animate-pulse' : w.status === 'idle' ? 'bg-emerald-500' : 'bg-zinc-700'}`} />
              <span className="text-zinc-300 font-bold text-xs tracking-tighter group-hover:text-primary transition-colors">
                {w.id}
              </span>
            </div>
            <Badge status={w.status}>{t(`status.${w.status}`)}</Badge>
          </div>
          <div className="flex flex-col gap-1.5 pl-3.5 mt-1">
            <div className="flex justify-between items-center">
              <span className="text-[9px] text-zinc-600 font-mono uppercase tracking-tighter">
                Pool: <span className="text-zinc-400">{w.pool}</span>
              </span>
              <span className="text-[9px] text-zinc-600 font-mono uppercase tracking-tighter">
                Host: <span className="text-zinc-400">{w.hostname || '-'}</span>
              </span>
            </div>
            <div className="flex justify-between items-center gap-4">
              <div className="text-[9px] text-zinc-500 truncate flex-1">
                {t('task')}: <span className={w.currentTaskId ? "text-primary/70" : "text-zinc-700"}>{w.currentTaskId || t('none')}</span>
              </div>
              <button
                onClick={() => onAction(w.id, w.status === 'disabled')}
                className="opacity-0 group-hover:opacity-100 px-2 py-0.5 rounded border border-zinc-800 bg-zinc-900 text-[8px] text-zinc-500 hover:text-white hover:border-zinc-600 transition-all uppercase font-black"
              >
                {w.status === 'disabled' ? t('enable') : t('disable')}
              </button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
};
