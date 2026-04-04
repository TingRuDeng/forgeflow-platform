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
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
      <div className="bg-zinc-950 border border-zinc-800 rounded-xl p-4 flex flex-col gap-2 shadow-xl group hover:border-primary/30 transition-colors">
        <div className="flex justify-between items-start">
          <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">{t('activeWorkers')}</span>
          <Users className="w-3 h-3 text-primary opacity-50 group-hover:opacity-100 transition-opacity" />
        </div>
        <div className="text-2xl font-black text-white">{stats.workers.total}</div>
      </div>

      <div className="bg-zinc-950 border border-zinc-800 rounded-xl p-4 flex flex-col gap-2 shadow-xl group hover:border-primary/30 transition-colors">
        <div className="flex justify-between items-start">
          <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">{t('idle')} / {t('busy')}</span>
          <Users className="w-3 h-3 text-emerald-500 opacity-50 group-hover:opacity-100 transition-opacity" />
        </div>
        <div className="text-2xl font-black text-white">
          {stats.workers.idle} <span className="text-zinc-600 text-sm">/</span> {stats.workers.busy}
        </div>
      </div>

      <div className="bg-zinc-950 border border-zinc-800 rounded-xl p-4 flex flex-col gap-2 shadow-xl group hover:border-primary/30 transition-colors">
        <div className="flex justify-between items-start">
          <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">{t('totalTasks')}</span>
          <LayoutList className="w-3 h-3 text-primary opacity-50 group-hover:opacity-100 transition-opacity" />
        </div>
        <div className="text-2xl font-black text-white">{stats.tasks.total}</div>
      </div>

      <div className="bg-zinc-950 border border-zinc-800 rounded-xl p-4 flex flex-col gap-2 shadow-xl group hover:border-primary/30 transition-colors">
        <div className="flex justify-between items-start">
          <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">{t('review')} / {t('merged')}</span>
          <LayoutList className="w-3 h-3 text-amber-500 opacity-50 group-hover:opacity-100 transition-opacity" />
        </div>
        <div className="text-2xl font-black text-white">
          {stats.tasks.review} <span className="text-zinc-600 text-sm">/</span> {stats.tasks.merged}
        </div>
      </div>
    </div>
  );
};
