import React from 'react';
import { useTranslation } from '@/lib/i18n';
import { Users, LayoutList } from 'lucide-react';

interface MetricsGridProps {
  stats: {
    workers: { total: number; idle: number; busy: number; disabled: number };
    tasks: { total: number; review: number; merged: number };
  };
}

export const MetricsGrid: React.FC<MetricsGridProps> = ({ stats }) => {
  const { t } = useTranslation();
  const activeWorkers = stats.workers.total - stats.workers.disabled;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
      <div className="glass rounded-2xl p-4 flex flex-col gap-2 transition-all duration-300 hover:scale-[1.02] hover:shadow-xl cursor-default">
        <div className="flex justify-between items-start">
          <span className="text-xs font-semibold text-white/70 uppercase tracking-wide">{t('activeWorkers')}</span>
          <div className="w-8 h-8 rounded-lg bg-blue-500/20 flex items-center justify-center">
            <Users className="w-4 h-4 text-blue-400" />
          </div>
        </div>
        <div className="text-3xl font-bold text-white">{activeWorkers}</div>
        <div className="text-xs text-white/50">Total capacity: 20</div>
      </div>

      <div className="glass rounded-2xl p-4 flex flex-col gap-2 transition-all duration-300 hover:scale-[1.02] hover:shadow-xl cursor-default">
        <div className="flex justify-between items-start">
          <span className="text-xs font-semibold text-white/70 uppercase tracking-wide">{t('idle')} / {t('busy')}</span>
          <div className="w-8 h-8 rounded-lg bg-emerald-500/20 flex items-center justify-center">
            <Users className="w-4 h-4 text-emerald-400" />
          </div>
        </div>
        <div className="text-3xl font-bold text-white">
          {stats.workers.idle} <span className="text-lg text-white/40">/</span> {stats.workers.busy}
        </div>
        <div className="text-xs text-white/50">Utilization: {activeWorkers > 0 ? Math.round((stats.workers.busy / activeWorkers) * 100) : 0}%</div>
      </div>

      <div className="glass rounded-2xl p-4 flex flex-col gap-2 transition-all duration-300 hover:scale-[1.02] hover:shadow-xl cursor-default">
        <div className="flex justify-between items-start">
          <span className="text-xs font-semibold text-white/70 uppercase tracking-wide">{t('totalTasks')}</span>
          <div className="w-8 h-8 rounded-lg bg-purple-500/20 flex items-center justify-center">
            <LayoutList className="w-4 h-4 text-purple-400" />
          </div>
        </div>
        <div className="text-3xl font-bold text-white">{stats.tasks.total}</div>
        <div className="text-xs text-white/50">This week: +23</div>
      </div>

      <div className="glass rounded-2xl p-4 flex flex-col gap-2 transition-all duration-300 hover:scale-[1.02] hover:shadow-xl cursor-default">
        <div className="flex justify-between items-start">
          <span className="text-xs font-semibold text-white/70 uppercase tracking-wide">{t('review')} / {t('merged')}</span>
          <div className="w-8 h-8 rounded-lg bg-orange-500/20 flex items-center justify-center">
            <LayoutList className="w-4 h-4 text-orange-400" />
          </div>
        </div>
        <div className="text-3xl font-bold text-white">
          {stats.tasks.review} <span className="text-lg text-white/40">/</span> {stats.tasks.merged}
        </div>
        <div className="text-xs text-white/50">Completion: {Math.round((stats.tasks.merged / stats.tasks.total) * 100)}%</div>
      </div>
    </div>
  );
};
