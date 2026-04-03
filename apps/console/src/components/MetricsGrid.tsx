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

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      <div className="bg-zinc-950 border border-zinc-800 rounded-xl p-6 flex flex-col gap-4 shadow-xl group hover:border-primary/30 transition-colors">
        <div className="flex justify-between items-start">
          <span className="text-xs font-bold text-zinc-500 uppercase tracking-widest">{t('activeWorkers')}</span>
          <Users className="w-4 h-4 text-primary opacity-50 group-hover:opacity-100 transition-opacity" />
        </div>
        <div className="text-4xl font-black text-white">{stats.workers.total}</div>
        <div className="text-[11px] text-zinc-500 font-medium">
          {t('idle')}: <span className="text-zinc-300">{stats.workers.idle}</span> / 
          {t('busy')}: <span className="text-zinc-300">{stats.workers.busy}</span> / 
          {t('disabled')}: <span className="text-zinc-300">{stats.workers.disabled}</span>
        </div>
      </div>

      <div className="bg-zinc-950 border border-zinc-800 rounded-xl p-6 flex flex-col gap-4 shadow-xl group hover:border-primary/30 transition-colors">
        <div className="flex justify-between items-start">
          <span className="text-xs font-bold text-zinc-500 uppercase tracking-widest">{t('totalTasks')}</span>
          <LayoutList className="w-4 h-4 text-primary opacity-50 group-hover:opacity-100 transition-opacity" />
        </div>
        <div className="text-4xl font-black text-white">{stats.tasks.total}</div>
        <div className="text-[11px] text-zinc-500 font-medium">
          {t('review')}: <span className="text-zinc-300">{stats.tasks.review}</span> / 
          {t('merged')}: <span className="text-zinc-300">{stats.tasks.merged}</span>
        </div>
      </div>
    </div>
  );
};
