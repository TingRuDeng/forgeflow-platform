import React from 'react';
import { useTranslation } from '@/lib/i18n';
import { Users, LayoutList } from 'lucide-react';

interface MetricsGridProps {
  stats: {
    workers: { total: number; idle: number; busy: number; disabled: number };
    tasks: { total: number; review: number; merged: number };
  };
  metrics: {
    queueDepth: number;
    plannedTasks: number;
    reviewBacklog: number;
    avgAssignmentLagMs: number;
    maxAssignmentLagMs: number;
    submitResultRetryCount: number;
    retryRatePct: number;
    deliveryFailedCount: number;
    cleanupFailureCount: number;
  };
}

export const MetricsGrid: React.FC<MetricsGridProps> = ({ stats, metrics }) => {
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
        <div className="text-xs text-white/50">
          {t('idle')} / {t('busy')}: {stats.workers.idle} / {stats.workers.busy}
        </div>
      </div>

      <div className="glass rounded-2xl p-4 flex flex-col gap-2 transition-all duration-300 hover:scale-[1.02] hover:shadow-xl cursor-default">
        <div className="flex justify-between items-start">
          <span className="text-xs font-semibold text-white/70 uppercase tracking-wide">{t('queueDepth')}</span>
          <div className="w-8 h-8 rounded-lg bg-emerald-500/20 flex items-center justify-center">
            <Users className="w-4 h-4 text-emerald-400" />
          </div>
        </div>
        <div className="text-3xl font-bold text-white">
          {metrics.queueDepth} <span className="text-lg text-white/40">/</span> {metrics.reviewBacklog}
        </div>
        <div className="text-xs text-white/50">
          {t('planned')}: {metrics.plannedTasks}
        </div>
      </div>

      <div className="glass rounded-2xl p-4 flex flex-col gap-2 transition-all duration-300 hover:scale-[1.02] hover:shadow-xl cursor-default">
        <div className="flex justify-between items-start">
          <span className="text-xs font-semibold text-white/70 uppercase tracking-wide">{t('assignmentLag')}</span>
          <div className="w-8 h-8 rounded-lg bg-purple-500/20 flex items-center justify-center">
            <LayoutList className="w-4 h-4 text-purple-400" />
          </div>
        </div>
        <div className="text-3xl font-bold text-white">{Math.round(metrics.avgAssignmentLagMs / 1000)}s</div>
        <div className="text-xs text-white/50">
          max {Math.round(metrics.maxAssignmentLagMs / 1000)}s
        </div>
      </div>

      <div className="glass rounded-2xl p-4 flex flex-col gap-2 transition-all duration-300 hover:scale-[1.02] hover:shadow-xl cursor-default">
        <div className="flex justify-between items-start">
          <span className="text-xs font-semibold text-white/70 uppercase tracking-wide">{t('retryRate')}</span>
          <div className="w-8 h-8 rounded-lg bg-orange-500/20 flex items-center justify-center">
            <LayoutList className="w-4 h-4 text-orange-400" />
          </div>
        </div>
        <div className="text-3xl font-bold text-white">
          {metrics.retryRatePct.toFixed(1)}%
        </div>
        <div className="text-xs text-white/50">
          {t('deliveryFailures')}: {metrics.deliveryFailedCount} · {t('cleanupFailures')}: {metrics.cleanupFailureCount}
        </div>
      </div>
    </div>
  );
};
