import React from 'react';
import { Ban, RotateCcw } from 'lucide-react';
import { useTranslation } from '@/lib/i18n';
import { Badge } from './UI';

interface TaskSummary {
  id: string;
  title?: string;
  status?: string;
  repo?: string;
  branchName?: string;
}

interface ReviewSummary {
  taskId: string;
  evidence?: {
    reasonCode?: string;
    mustFix?: string[];
    canRedrive?: boolean;
    redriveStrategy?: string;
  } | null;
  riskAssessment?: {
    level?: string | null;
    reasons?: string[];
  } | null;
}

interface ReviewDecisionInput {
  reasonCode?: string;
  mustFix?: string[];
  canRedrive?: boolean;
  redriveStrategy?: string;
}

interface ReviewQueueProps {
  tasks: TaskSummary[];
  reviews?: ReviewSummary[];
  selectedTaskId?: string | null;
  submittingTaskIds?: string[];
  onSelectTask?: (taskId: string) => void;
  onBulkReviewDecision?: (
    decision: 'rework' | 'block',
    taskIds: string[],
    input: ReviewDecisionInput,
  ) => void;
}

function latestReviewByTask(reviews: ReviewSummary[]): Map<string, ReviewSummary> {
  return reviews.reduce((map, review) => map.set(review.taskId, review), new Map<string, ReviewSummary>());
}

function normalizeSelection(selected: Set<string>, tasks: TaskSummary[]): Set<string> {
  const reviewTaskIds = new Set(tasks.filter((task) => task.status === 'review').map((task) => task.id));
  return new Set([...selected].filter((taskId) => reviewTaskIds.has(taskId)));
}

function buildDecisionInput(input: {
  reasonCode: string;
  mustFixText: string;
  canRedrive: boolean;
  redriveStrategy: string;
}): ReviewDecisionInput {
  return {
    reasonCode: input.reasonCode.trim() || undefined,
    mustFix: input.mustFixText.split(/\r?\n/).map((item) => item.trim()).filter(Boolean),
    canRedrive: input.canRedrive,
    redriveStrategy: input.redriveStrategy,
  };
}

export const ReviewQueue: React.FC<ReviewQueueProps> = ({
  tasks,
  reviews = [],
  selectedTaskId,
  submittingTaskIds = [],
  onSelectTask,
  onBulkReviewDecision,
}) => {
  const { t } = useTranslation();
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [reasonCode, setReasonCode] = React.useState('');
  const [mustFixText, setMustFixText] = React.useState('');
  const [canRedrive, setCanRedrive] = React.useState(true);
  const [redriveStrategy, setRedriveStrategy] = React.useState('same_worker_continue');
  const reviewTasks = React.useMemo(() => tasks.filter((task) => task.status === 'review'), [tasks]);
  const reviewByTask = React.useMemo(() => latestReviewByTask(reviews), [reviews]);
  const submitting = submittingTaskIds.length > 0;
  const selectedIds = [...selected];
  const canSubmit = selectedIds.length > 0 && !submitting && Boolean(onBulkReviewDecision);

  React.useEffect(() => {
    setSelected((current) => normalizeSelection(current, tasks));
  }, [tasks]);

  const toggleTask = (taskId: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(taskId)) {
        next.delete(taskId);
      } else {
        next.add(taskId);
      }
      return next;
    });
  };

  const submit = (decision: 'rework' | 'block') => {
    if (!canSubmit) return;
    onBulkReviewDecision?.(decision, selectedIds, buildDecisionInput({
      reasonCode,
      mustFixText,
      canRedrive,
      redriveStrategy,
    }));
  };

  return (
    <div className="p-4 space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-3">
        <div>
          <div className="text-sm font-semibold text-white/85">{t('reviewQueue')}</div>
          <div className="mt-1 text-xs text-white/45">{t('reviewQueueHint')}</div>
        </div>
        <div className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-xs font-mono text-white/60">
          {t('selectedCount')}: {selectedIds.length} / {reviewTasks.length}
        </div>
      </div>

      {reviewTasks.length > 0 ? (
        <div className="grid grid-cols-1 gap-2">
          {reviewTasks.map((task) => {
            const review = reviewByTask.get(task.id);
            const active = selectedTaskId === task.id;
            return (
              <div
                key={task.id}
                className={`rounded-lg border p-3 transition-colors ${active ? 'border-cyan-300/55 bg-cyan-300/10' : 'border-white/10 bg-black/15'}`}
              >
                <div className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    aria-label={`${t('selectReviewTask')} ${task.id}`}
                    checked={selected.has(task.id)}
                    onChange={() => toggleTask(task.id)}
                    className="mt-1"
                  />
                  <button type="button" className="min-w-0 flex-1 text-left" onClick={() => onSelectTask?.(task.id)}>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold text-white/85 break-all">{task.title || task.id}</span>
                      <Badge status={task.status || 'review'}>{t(`status.${task.status || 'review'}`)}</Badge>
                    </div>
                    <div className="mt-1 text-xs font-mono text-white/45 break-all">{task.id}</div>
                    <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-white/45">
                      {task.repo && <span>{t('repo')}: {task.repo}</span>}
                      {task.branchName && <span>{t('branch')}: {task.branchName}</span>}
                      {review?.riskAssessment?.level && <span>{t('riskLevelLabel')}: {review.riskAssessment.level}</span>}
                      {review?.evidence?.reasonCode && <span>{t('reasonCode')}: {review.evidence.reasonCode}</span>}
                    </div>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="rounded-lg border border-white/10 bg-black/15 p-4 text-center text-sm text-white/45">
          {t('noReviewTasks')}
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 rounded-lg border border-white/10 bg-black/15 p-3">
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
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            disabled={!canSubmit}
            onClick={() => submit('rework')}
            className="inline-flex items-center justify-center gap-2 rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-xs font-semibold text-amber-100 hover:bg-amber-400/20 disabled:opacity-50"
          >
            <RotateCcw size={14} aria-hidden="true" />
            {t('bulkReworkDecision')}
          </button>
          <button
            type="button"
            disabled={!canSubmit}
            onClick={() => submit('block')}
            className="inline-flex items-center justify-center gap-2 rounded-lg border border-rose-400/30 bg-rose-400/10 px-3 py-2 text-xs font-semibold text-rose-100 hover:bg-rose-400/20 disabled:opacity-50"
          >
            <Ban size={14} aria-hidden="true" />
            {t('bulkBlockDecision')}
          </button>
        </div>
      </div>
    </div>
  );
};
