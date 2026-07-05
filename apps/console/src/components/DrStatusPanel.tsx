import React from 'react';
import { Activity, Database, ShieldCheck } from 'lucide-react';
import { useTranslation } from '@/lib/i18n';

type ShadowHealth = {
  status?: string;
  lastError?: string | null;
};

type ShadowReconciler = {
  status?: 'unknown' | 'ok' | 'failed';
  runCount?: number;
  failedRunCount?: number;
  updatedAt?: string | null;
  lastError?: string | null;
};

type ProjectionHealth = {
  matches?: boolean;
};

type PrimaryCutover = {
  status?: 'unknown' | 'ready' | 'blocked' | 'failed';
  primaryBackend?: {
    selected?: boolean;
    configured?: boolean;
  };
  approval?: {
    exists?: boolean;
  };
  ready?: {
    exists?: boolean;
  };
  revocation?: {
    exists?: boolean;
    reason?: string | null;
  };
  lastError?: string | null;
};

export type DrStatus = {
  readOnly?: boolean;
  structuredReads?: boolean;
  shadowMode?: string;
  shadowWrite?: ShadowHealth;
  shadowReconciler?: ShadowReconciler;
  primaryCutover?: PrimaryCutover;
  projectionHealth?: ProjectionHealth;
  backups?: unknown[];
};

function statusTone(status?: string, isOk = false): string {
  if (status === 'failed' || status === 'critical' || status === 'blocked') {
    return 'border-rose-400/40 bg-rose-500/10 text-rose-200';
  }
  if (status === 'unknown' || status === 'skipped') {
    return 'border-amber-400/40 bg-amber-500/10 text-amber-100';
  }
  if (isOk || status === 'ok' || status === 'matched' || status === 'ready') {
    return 'border-emerald-400/40 bg-emerald-500/10 text-emerald-100';
  }
  return 'border-white/10 bg-white/5 text-white/70';
}

function formatBoolean(value: boolean | undefined, yes: string, no: string): string {
  return value ? yes : no;
}

export const DrStatusPanel: React.FC<{ status?: DrStatus | null }> = ({ status }) => {
  const { t } = useTranslation();
  if (!status) {
    return null;
  }

  const shadowWriteStatus = status.shadowWrite?.status || 'unknown';
  const reconcilerStatus = status.shadowReconciler?.status || 'unknown';
  const primaryCutoverStatus = status.primaryCutover?.status || 'unknown';
  const projectionMatches = status.projectionHealth?.matches === true;

  return (
    <section className="glass rounded-2xl p-4 mb-6" aria-label={t('drStatus')}>
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-cyan-500/20 flex items-center justify-center">
              <ShieldCheck className="w-4 h-4 text-cyan-300" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-white">{t('drStatus')}</h2>
              <p className="text-xs text-white/50">{t('shadowMode')}: {status.shadowMode || 'unknown'}</p>
            </div>
          </div>
          <span className={`px-3 py-1 rounded-md border text-xs ${statusTone(reconcilerStatus, reconcilerStatus === 'ok')}`}>
            {t('shadowReconciler')}: {reconcilerStatus}
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3 text-xs">
          <div className={`rounded-lg border p-3 ${statusTone(shadowWriteStatus, shadowWriteStatus === 'ok')}`}>
            <div className="flex items-center gap-2 font-semibold">
              <Activity className="w-4 h-4" />
              {t('shadowWrite')}
            </div>
            <div className="mt-1">{shadowWriteStatus}</div>
            {status.shadowWrite?.lastError && (
              <div className="mt-1 text-white/60 break-words">{status.shadowWrite.lastError}</div>
            )}
          </div>

          <div className={`rounded-lg border p-3 ${statusTone(reconcilerStatus, reconcilerStatus === 'ok')}`}>
            <div className="flex items-center gap-2 font-semibold">
              <Activity className="w-4 h-4" />
              {t('shadowReconciler')}
            </div>
            <div className="mt-1">
              {t('runs')}: {status.shadowReconciler?.runCount ?? 0} · {t('failed')}: {status.shadowReconciler?.failedRunCount ?? 0}
            </div>
            {status.shadowReconciler?.lastError && (
              <div className="mt-1 text-white/60 break-words">{status.shadowReconciler.lastError}</div>
            )}
          </div>

          <div className={`rounded-lg border p-3 ${statusTone(primaryCutoverStatus, primaryCutoverStatus === 'ready')}`}>
            <div className="flex items-center gap-2 font-semibold">
              <ShieldCheck className="w-4 h-4" />
              {t('primaryCutover')}
            </div>
            <div className="mt-1">{primaryCutoverStatus}</div>
            <div className="mt-1 text-white/60">
              {t('approvalEvidence')}: {formatBoolean(status.primaryCutover?.approval?.exists, t('yes'), t('no'))} · {t('readyEvidence')}: {formatBoolean(status.primaryCutover?.ready?.exists, t('yes'), t('no'))}
            </div>
            <div className="mt-1 text-white/60">
              {t('primaryBackend')}: {formatBoolean(status.primaryCutover?.primaryBackend?.selected && status.primaryCutover?.primaryBackend?.configured, t('yes'), t('no'))}
            </div>
            {status.primaryCutover?.revocation?.exists && (
              <div className="mt-1 text-white/60 break-words">{t('revoked')}: {status.primaryCutover.revocation.reason || primaryCutoverStatus}</div>
            )}
            {status.primaryCutover?.lastError && (
              <div className="mt-1 text-white/60 break-words">{status.primaryCutover.lastError}</div>
            )}
          </div>

          <div className={`rounded-lg border p-3 ${statusTone(projectionMatches ? 'ok' : 'unknown', projectionMatches)}`}>
            <div className="flex items-center gap-2 font-semibold">
              <Database className="w-4 h-4" />
              {t('projectionHealth')}
            </div>
            <div className="mt-1">
              {formatBoolean(projectionMatches, t('matched'), t('unknown'))} · {t('backups')}: {status.backups?.length ?? 0}
            </div>
            <div className="mt-1 text-white/60">
              {t('readOnly')}: {formatBoolean(status.readOnly, t('yes'), t('no'))} · {t('structuredReads')}: {formatBoolean(status.structuredReads, t('yes'), t('no'))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};
