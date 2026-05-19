import React from 'react';
import { useTranslation } from '@/lib/i18n';
import { Badge } from './UI';
import { ArtifactSummary, AttemptTimeline, RuntimeEventList, type ArtifactBundle, type TaskAttempt } from './TaskTimeline';

interface Task {
  id: string;
  traceId?: string | null;
  title: string;
  status: string;
  assignedWorkerId?: string;
  branchName?: string;
  repo?: string;
  pool?: string;
  continueFromTaskId?: string;
  followUpOfTaskId?: string;
  lastAssignedWorkerId?: string;
}

interface Assignment {
  taskId: string;
  workerId?: string;
  branchName?: string;
  repo?: string;
  pool?: string;
}

interface Review {
  taskId: string;
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
  latestWorkerResult?: {
    evidence?: {
      failureType?: string;
      blockers?: Array<{ code?: string }>;
      failureSummary?: string;
    } | null;
  } | null;
}

interface PullRequest {
  taskId: string;
  url?: string;
  status?: string;
  number?: number;
}

interface EventRecord {
  taskId: string;
  type: string;
  at?: string;
  summary?: string;
  payload?: {
    message?: string;
    failureSummary?: string;
  } | null;
}

interface TaskDetailsPanelProps {
  task: Task | null;
  assignment?: Assignment | null;
  review?: Review | null;
  pullRequest?: PullRequest | null;
  events?: EventRecord[];
  attempts?: TaskAttempt[];
  artifactBundles?: ArtifactBundle[];
  cancellingTaskId?: string | null;
  onCancel?: (task: Task) => void;
}

function formatTime(isoString?: string): string {
  if (!isoString) return '--:--:--';
  const date = new Date(isoString);
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  return `${hours}:${minutes}:${seconds}`;
}

function extractFailureSummary(review: Review | null, events: EventRecord[]) {
  const reviewFailure = review?.latestWorkerResult?.evidence?.failureSummary?.trim();
  if (reviewFailure) return reviewFailure;
  const event = events.find((item) => item.type === 'status_changed' && item.payload?.failureSummary);
  return event?.payload?.failureSummary?.trim() || null;
}

function canCancelTask(status?: string) {
  return !['merged', 'failed', 'cancelled'].includes(String(status || '').toLowerCase());
}

const DetailRow: React.FC<{ label: string; value: React.ReactNode; mono?: boolean }> = ({ label, value, mono }) => (
  <div className="text-sm text-white/80">
    {label}: <span className={`${mono ? 'font-mono ' : ''}break-all`}>{value || '--'}</span>
  </div>
);

const DetailCard: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => {
  const displayValue = value || '--';
  return (
    <div className="glass-card rounded-xl p-3">
      <div className="text-[11px] uppercase tracking-wide text-white/45">{label}</div>
      <div className="mt-1 font-mono text-white/80 break-all">{displayValue}</div>
    </div>
  );
};

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <section className="glass-card rounded-xl p-4 space-y-2">
    <div className="text-[11px] uppercase tracking-wide text-white/45">{title}</div>
    {children}
  </section>
);

const TaskHeader: React.FC<{
  task: Task;
  cancellingTaskId?: string | null;
  onCancel?: (task: Task) => void;
}> = ({ task, cancellingTaskId, onCancel }) => {
  const { t } = useTranslation();
  const canCancel = canCancelTask(task.status) && onCancel;

  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <div className="text-[11px] uppercase tracking-[0.24em] text-cyan-300/60 font-semibold">{t('taskDetails')}</div>
        <h3 className="mt-2 text-lg font-semibold text-white break-all">{task.title || task.id}</h3>
        <div className="mt-2 text-xs font-mono text-white/45">{task.id}</div>
      </div>
      <div className="flex flex-col items-end gap-2">
        <Badge status={task.status}>{t(`status.${task.status}`)}</Badge>
        {canCancel && (
          <button
            type="button"
            onClick={() => onCancel(task)}
            disabled={cancellingTaskId === task.id}
            className="px-3 py-1.5 rounded-lg border border-rose-500/30 bg-rose-500/10 text-rose-200 text-xs font-semibold uppercase tracking-wide transition-colors hover:bg-rose-500/20 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {cancellingTaskId === task.id ? t('cancellingTask') : t('cancelTask')}
          </button>
        )}
      </div>
    </div>
  );
};

const TaskMetadataGrid: React.FC<{ task: Task; assignment?: Assignment | null; workerId: string }> = ({ task, assignment, workerId }) => {
  const { t } = useTranslation();
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
      <DetailCard label={t('worker')} value={workerId} />
      <DetailCard label={t('branch')} value={task.branchName || assignment?.branchName} />
      <DetailCard label={t('repo')} value={task.repo || assignment?.repo} />
      <DetailCard label={t('pool')} value={task.pool || assignment?.pool} />
    </div>
  );
};

const LineageSection: React.FC<{ task: Task; parentTaskId: string | null }> = ({ task, parentTaskId }) => {
  const { t } = useTranslation();
  return (
    <Section title={t('lineage')}>
      <DetailRow label={t('traceId')} value={task.traceId} mono />
      <DetailRow label={t('parentTask')} value={parentTaskId} mono />
      <DetailRow label={t('continueFrom')} value={task.continueFromTaskId} mono />
      <DetailRow label={t('followUpOf')} value={task.followUpOfTaskId} mono />
    </Section>
  );
};

const ReviewSection: React.FC<{ review?: Review | null; mustFix: string[]; canRedriveValue: string }> = ({ review, mustFix, canRedriveValue }) => {
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

const FailureSection: React.FC<{ review?: Review | null; events: EventRecord[] }> = ({ review, events }) => {
  const { t } = useTranslation();
  const latestProgress = events.find((event) => event.type === 'progress_reported') || null;
  const failureType = review?.latestWorkerResult?.evidence?.failureType || null;
  const failureCode = review?.latestWorkerResult?.evidence?.blockers?.[0]?.code || null;

  return (
    <Section title={t('latestFailure')}>
      <DetailRow label={t('failureType')} value={failureType} mono />
      <DetailRow label={t('failureCode')} value={failureCode} mono />
      <DetailRow label={t('failureSummary')} value={extractFailureSummary(review || null, events)} />
      <DetailRow label={t('latestProgress')} value={latestProgress?.payload?.message || latestProgress?.summary} />
    </Section>
  );
};

const PullRequestSection: React.FC<{ pullRequest?: PullRequest | null }> = ({ pullRequest }) => {
  const { t } = useTranslation();
  const url = pullRequest?.url;

  return (
    <Section title="PR">
      <DetailRow label={t('statusLabel')} value={pullRequest?.status} mono />
      <DetailRow label={t('prNumber')} value={pullRequest?.number ?? '--'} mono />
      <div className="text-sm text-white/80">
        {t('url')}: {url ? <a className="text-cyan-300 underline break-all" href={url} target="_blank" rel="noreferrer">{url}</a> : '--'}
      </div>
    </Section>
  );
};

export const TaskDetailsPanel: React.FC<TaskDetailsPanelProps> = ({
  task,
  assignment,
  review,
  pullRequest,
  events = [],
  attempts = [],
  artifactBundles = [],
  cancellingTaskId,
  onCancel,
}) => {
  const { t } = useTranslation();
  if (!task) {
    return <div className="h-full border-l border-white/10 p-5 text-sm text-white/45">{t('selectTaskHint')}</div>;
  }

  const workerId = assignment?.workerId || task.lastAssignedWorkerId || task.assignedWorkerId || '--';
  const mustFix = review?.evidence?.mustFix || [];
  const canRedriveValue = typeof review?.evidence?.canRedrive === 'boolean'
    ? (review.evidence.canRedrive ? t('yes') : t('no'))
    : '--';

  return (
    <aside className="border-t xl:border-t-0 xl:border-l border-white/10 bg-black/10 p-5 flex flex-col gap-5">
      <TaskHeader task={task} cancellingTaskId={cancellingTaskId} onCancel={onCancel} />
      <TaskMetadataGrid task={task} assignment={assignment} workerId={workerId} />
      <LineageSection task={task} parentTaskId={task.continueFromTaskId || task.followUpOfTaskId || null} />
      <ReviewSection review={review} mustFix={mustFix} canRedriveValue={canRedriveValue} />
      <FailureSection review={review} events={events} />
      <PullRequestSection pullRequest={pullRequest} />
      <AttemptTimeline attempts={attempts} />
      <ArtifactSummary bundles={artifactBundles} />
      <RuntimeEventList events={events} />
    </aside>
  );
};
