import React from 'react';
import { useTranslation } from '@/lib/i18n';

export interface TerminationPolicy {
  maxAttempts?: number;
  attemptLeaseTimeoutMs?: number;
  heartbeatTimeoutMs?: number;
  assignmentTimeoutMs?: number;
}

function hasPolicyValue(policy?: TerminationPolicy | null): policy is TerminationPolicy {
  return Boolean(policy && Object.values(policy).some((value) => value !== undefined && value !== null));
}

function formatDurationMs(value?: number): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '--';
  if (value < 1000) return `${value}ms`;
  if (value % 1000 === 0) return `${value / 1000}s`;
  return `${value}ms`;
}

const PolicyRow: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
  <div className="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-sm">
    <span className="text-white/60">{label}</span>
    <span className="font-mono text-white/85">{value ?? '--'}</span>
  </div>
);

export const TaskTerminationPolicySection: React.FC<{ policy?: TerminationPolicy | null }> = ({ policy }) => {
  const { t } = useTranslation();
  if (!hasPolicyValue(policy)) return null;

  return (
    <section className="glass-card rounded-xl p-4 space-y-2">
      <div className="text-[11px] uppercase tracking-wide text-white/45">{t('terminationPolicy')}</div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <PolicyRow label={t('maxAttempts')} value={policy.maxAttempts ?? '--'} />
        <PolicyRow label={t('attemptLeaseTimeout')} value={formatDurationMs(policy.attemptLeaseTimeoutMs)} />
        <PolicyRow label={t('heartbeatTimeout')} value={formatDurationMs(policy.heartbeatTimeoutMs)} />
        <PolicyRow label={t('assignmentTimeout')} value={formatDurationMs(policy.assignmentTimeoutMs)} />
      </div>
    </section>
  );
};
