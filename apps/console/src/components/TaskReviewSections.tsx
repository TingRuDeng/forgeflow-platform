import React, { useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { useTranslation } from '@/lib/i18n';
import {
  resolveLatestProgress,
  resolveTaskFailure,
  type TaskFailureAttempt,
  type TaskFailureEvent,
} from '@/lib/taskFailure';

interface Task {
  id: string;
  status: string;
  redriveEligibility?: {
    canRedrive?: boolean;
    reason?: string;
    failureCode?: string | null;
    existingTaskId?: string | null;
  } | null;
}

interface Review {
  decision?: string | null;
  actor?: string | null;
  decidedAt?: string;
  at?: string;
  notes?: string | null;
  evidence?: {
    reasonCode?: string;
    mustFix?: string[];
    canRedrive?: boolean;
    redriveStrategy?: string;
  } | null;
  riskAssessment?: {
    level?: string | null;
    reasons?: string[];
    changedFileCount?: number | null;
  } | null;
  latestWorkerResult?: {
    generatedAt?: string;
    output?: string;
    evidence?: {
      failureType?: string;
      blockers?: Array<{ kind?: string; code?: string; message?: string }>;
      failureSummary?: string;
    } | null;
  } | null;
}

export interface ReviewDecisionInput {
  reasonCode?: string;
  mustFix?: string[];
  canRedrive?: boolean;
  redriveStrategy?: string;
  acknowledgeRisk?: boolean;
}

function formatTime(isoString?: string): string {
  if (!isoString) return '--:--:--';
  const date = new Date(isoString);
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  return `${hours}:${minutes}:${seconds}`;
}

const DetailRow: React.FC<{ label: string; value: React.ReactNode; mono?: boolean }> = ({ label, value, mono }) => (
  <div className="text-sm text-white/80">
    {label}: <span className={`${mono ? 'font-mono ' : ''}break-all`}>{value || '--'}</span>
  </div>
);

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <section className="glass-card rounded-xl p-4 space-y-2">
    <div className="text-[11px] uppercase tracking-wide text-white/45">{title}</div>
    {children}
  </section>
);

const RISK_LEVEL_STYLES: Record<string, string> = {
  low: 'border-emerald-400/30 bg-emerald-400/10 text-emerald-100',
  needs_human_attention: 'border-amber-400/30 bg-amber-400/10 text-amber-100',
  too_large_for_auto_review: 'border-rose-400/30 bg-rose-400/10 text-rose-100',
};

const RiskBadge: React.FC<{ level: string }> = ({ level }) => {
  const { t } = useTranslation();
  const style = RISK_LEVEL_STYLES[level] || 'border-white/20 bg-white/10 text-white/80';
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${style}`}>
      {t(`riskLevel.${level}`)}
    </span>
  );
};

export const RiskSection: React.FC<{ review?: Review | null }> = ({ review }) => {
  const { t } = useTranslation();
  const risk = review?.riskAssessment;
  if (!risk || !risk.level) {
    return null;
  }
  const reasons = Array.isArray(risk.reasons) ? risk.reasons : [];
  return (
    <Section title={t('reviewRisk')}>
      <div className="flex items-center gap-2">
        <RiskBadge level={risk.level} />
        {typeof risk.changedFileCount === 'number' && (
          <span className="text-xs text-white/55">{risk.changedFileCount} {t('changedFiles')}</span>
        )}
      </div>
      {reasons.length > 0 && (
        <ul className="mt-1 list-disc pl-5 text-sm text-white/70 space-y-0.5">
          {reasons.map((reason, index) => (
            <li key={index} className="break-all">{reason}</li>
          ))}
        </ul>
      )}
    </Section>
  );
};

export const ReviewSection: React.FC<{ review?: Review | null; mustFix: string[]; canRedriveValue: string }> = ({
  review,
  mustFix,
  canRedriveValue,
}) => {
  const { t } = useTranslation();
  return (
    <Section title={t('latestReview')}>
      <DetailRow label={t('decision')} value={review?.decision} mono />
      <DetailRow label={t('actor')} value={review?.actor} mono />
      <DetailRow label={t('updatedAtLabel')} value={formatTime(review?.decidedAt || review?.at)} mono />
      <DetailRow label={t('reasonCode')} value={review?.evidence?.reasonCode} mono />
      <DetailRow label={t('canRedrive')} value={canRedriveValue} mono />
      <DetailRow label={t('redriveStrategy')} value={review?.evidence?.redriveStrategy} mono />
      <DetailRow label={t('notes')} value={review?.notes} />
      <DetailRow label={t('mustFix')} value={mustFix.length > 0 ? mustFix.join('; ') : '--'} />
    </Section>
  );
};

export const FailureSection: React.FC<{
  taskStatus: string;
  review?: Review | null;
  events: TaskFailureEvent[];
  attempts: TaskFailureAttempt[];
}> = ({ taskStatus, review, events, attempts }) => {
  const { t } = useTranslation();
  const latestProgress = resolveLatestProgress(events);
  const failure = resolveTaskFailure({ taskStatus, review, events, attempts });
  if (!failure.type && !failure.code && !failure.summary) return null;

  return (
    <Section title={t('latestFailure')}>
      <DetailRow label={t('failureType')} value={failure.type} mono />
      <DetailRow label={t('failureCode')} value={failure.code} mono />
      <DetailRow label={t('failureSummary')} value={failure.summary} />
      <DetailRow label={t('failureSource')} value={failure.source ? t(`failureSourceValue.${failure.source}`) : null} mono />
      <DetailRow label={t('latestProgress')} value={latestProgress?.payload?.message || latestProgress?.summary} />
    </Section>
  );
};

export const RecoveryActions: React.FC<{
  task: Task;
  redrivingTaskId?: string | null;
  onRedrive?: () => void;
}> = ({ task, redrivingTaskId, onRedrive }) => {
  const { t } = useTranslation();
  const canRedrive = task.redriveEligibility?.canRedrive === true;
  if (!canRedrive || !onRedrive) return null;

  return (
    <Section title={t('recoveryActions')}>
      <button
        type="button"
        title={t('redriveTaskHint')}
        disabled={redrivingTaskId === task.id}
        onClick={onRedrive}
        className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-cyan-400/30 bg-cyan-400/10 px-3 py-2 text-sm font-semibold text-cyan-100 transition-colors hover:bg-cyan-400/20 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <RotateCcw size={16} aria-hidden="true" />
        {redrivingTaskId === task.id ? t('redrivingTask') : t('redriveTask')}
      </button>
    </Section>
  );
};

function buildReviewActionsKey(task: Task, review?: Review | null): string {
  const evidence = review?.evidence;
  return [
    task.id,
    evidence?.reasonCode || '',
    (evidence?.mustFix || []).join('\u001f'),
    String(evidence?.canRedrive ?? true),
    evidence?.redriveStrategy || '',
  ].join('\u001e');
}

const ReviewActionsForm: React.FC<{
  task: Task;
  review?: Review | null;
  reviewingTaskId?: string | null;
  onReviewDecision?: (decision: 'merge' | 'rework' | 'block', input?: ReviewDecisionInput) => void;
}> = ({ task, review, reviewingTaskId, onReviewDecision }) => {
  const { t } = useTranslation();
  const [reasonCode, setReasonCode] = useState(review?.evidence?.reasonCode || '');
  const [mustFixText, setMustFixText] = useState((review?.evidence?.mustFix || []).join('\n'));
  const [canRedrive, setCanRedrive] = useState(review?.evidence?.canRedrive ?? true);
  const [redriveStrategy, setRedriveStrategy] = useState(review?.evidence?.redriveStrategy || 'same_worker_continue');
  const [acknowledgeRisk, setAcknowledgeRisk] = useState(false);

  if (task.status !== 'review' || !onReviewDecision) {
    return null;
  }

  const disabled = reviewingTaskId === task.id;
  const riskLevel = review?.riskAssessment?.level;
  const riskAboveLow = Boolean(riskLevel && riskLevel !== 'low');
  const buildInput = (): ReviewDecisionInput => ({
    reasonCode: reasonCode.trim() || undefined,
    mustFix: mustFixText
      .split(/\r?\n/)
      .map((item) => item.trim())
      .filter(Boolean),
    canRedrive,
    redriveStrategy,
    acknowledgeRisk,
  });

  return (
    <Section title={t('reviewActions')}>
      {riskAboveLow && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-xs text-amber-100">
          <RiskBadge level={riskLevel as string} />
          <span>{t('riskMergeHint')}</span>
        </div>
      )}
      <div className="grid grid-cols-1 gap-3">
        <label className="text-xs font-semibold text-white/70">
          {t('reasonCode')}
          <input
            value={reasonCode}
            onChange={(event) => setReasonCode(event.target.value)}
            className="mt-1 w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm font-mono text-white outline-none focus:border-cyan-400/60"
          />
        </label>
        <label className="text-xs font-semibold text-white/70">
          {t('mustFix')}
          <textarea
            value={mustFixText}
            onChange={(event) => setMustFixText(event.target.value)}
            rows={3}
            className="mt-1 w-full resize-y rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm text-white outline-none focus:border-cyan-400/60"
          />
        </label>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <label className="flex items-center gap-2 text-xs font-semibold text-white/70">
            <input type="checkbox" checked={canRedrive} onChange={(event) => setCanRedrive(event.target.checked)} />
            {t('canRedrive')}
          </label>
          <label className="text-xs font-semibold text-white/70">
            {t('redriveStrategy')}
            <select
              value={redriveStrategy}
              onChange={(event) => setRedriveStrategy(event.target.value)}
              className="mt-1 w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm font-mono text-white outline-none focus:border-cyan-400/60"
            >
              <option value="same_worker_continue">same_worker_continue</option>
              <option value="new_worker_reassign">new_worker_reassign</option>
              <option value="manual_follow_up">manual_follow_up</option>
            </select>
          </label>
        </div>
        {riskAboveLow && (
          <label className="flex items-center gap-2 text-xs font-semibold text-amber-100">
            <input
              type="checkbox"
              checked={acknowledgeRisk}
              onChange={(event) => setAcknowledgeRisk(event.target.checked)}
            />
            {t('acknowledgeRisk')}
          </label>
        )}
      </div>
      <div className="grid grid-cols-3 gap-2">
        <button
          type="button"
          disabled={disabled}
          onClick={() => onReviewDecision('merge', buildInput())}
          className="rounded-lg border border-emerald-400/30 bg-emerald-400/10 px-3 py-2 text-xs font-semibold text-emerald-100 hover:bg-emerald-400/20 disabled:opacity-50"
        >
          {t('mergeDecision')}
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => onReviewDecision('rework', buildInput())}
          className="rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-xs font-semibold text-amber-100 hover:bg-amber-400/20 disabled:opacity-50"
        >
          {t('reworkDecision')}
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => onReviewDecision('block', buildInput())}
          className="rounded-lg border border-rose-400/30 bg-rose-400/10 px-3 py-2 text-xs font-semibold text-rose-100 hover:bg-rose-400/20 disabled:opacity-50"
        >
          {t('blockDecision')}
        </button>
      </div>
    </Section>
  );
};

export const ReviewActions: React.FC<{
  task: Task;
  review?: Review | null;
  reviewingTaskId?: string | null;
  onReviewDecision?: (decision: 'merge' | 'rework' | 'block', input?: ReviewDecisionInput) => void;
}> = (props) => (
  <ReviewActionsForm
    key={buildReviewActionsKey(props.task, props.review)}
    {...props}
  />
);
