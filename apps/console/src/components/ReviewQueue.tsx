import React from 'react';
import { useTranslation } from '@/lib/i18n';
import { Badge } from './UI';
import { ReviewBulkForm, type ReviewBulkFormValue } from './ReviewBulkForm';
import { ReviewTaskList } from './ReviewTaskList';

export interface TaskSummary {
  id: string;
  title?: string;
  status?: string;
  repo?: string;
  branchName?: string;
  waitingForInput?: {
    requestedBy?: string;
    reason?: string;
    requestedAt?: string;
  } | null;
}

export interface ReviewSummary {
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
  acknowledgeRisk?: boolean;
}

interface ReviewQueueProps {
  tasks: TaskSummary[];
  reviews?: ReviewSummary[];
  selectedTaskId?: string | null;
  submittingTaskIds?: string[];
  onSelectTask?: (taskId: string) => void;
  onBulkReviewDecision?: (
    decision: 'merge' | 'rework' | 'block',
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
  acknowledgeRisk: boolean;
}): ReviewDecisionInput {
  return {
    reasonCode: input.reasonCode.trim() || undefined,
    mustFix: input.mustFixText.split(/\r?\n/).map((item) => item.trim()).filter(Boolean),
    canRedrive: input.canRedrive,
    redriveStrategy: input.redriveStrategy,
    ...(input.acknowledgeRisk ? { acknowledgeRisk: true } : {}),
  };
}

function isRiskyReview(review?: ReviewSummary): boolean {
  const level = review?.riskAssessment?.level;
  return Boolean(level && level !== 'low');
}

function WaitingInputQueue(props: {
  tasks: TaskSummary[];
  selectedTaskId?: string | null;
  onSelectTask?: (taskId: string) => void;
}) {
  const { t } = useTranslation();
  if (props.tasks.length === 0) {
    return null;
  }
  return (
    <div className="grid grid-cols-1 gap-2">
      <div className="text-xs font-semibold uppercase tracking-wide text-white/45">{t('waitingInputQueue')}</div>
      {props.tasks.map((task) => {
        const active = props.selectedTaskId === task.id;
        return (
          <button
            key={task.id}
            type="button"
            onClick={() => props.onSelectTask?.(task.id)}
            className={`rounded-lg border p-3 text-left transition-colors ${active ? 'border-cyan-300/55 bg-cyan-300/10' : 'border-white/10 bg-black/15'}`}
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold text-white/85 break-all">{task.title || task.id}</span>
              <Badge status="waiting_for_input">{t('status.waiting_for_input')}</Badge>
            </div>
            <div className="mt-1 text-xs font-mono text-white/45 break-all">{task.id}</div>
            <div className="mt-2 grid grid-cols-1 gap-1 text-[11px] text-white/45">
              {task.waitingForInput?.requestedBy && <span>{t('requestedBy')}: {task.waitingForInput.requestedBy}</span>}
              {task.waitingForInput?.reason && <span>{t('reason')}: {task.waitingForInput.reason}</span>}
            </div>
          </button>
        );
      })}
    </div>
  );
}

function ReviewQueueHeader(props: { selectedCount: number; reviewCount: number }) {
  const { t } = useTranslation();
  return (
    <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-3">
      <div>
        <div className="text-sm font-semibold text-white/85">{t('reviewQueue')}</div>
        <div className="mt-1 text-xs text-white/45">{t('reviewQueueHint')}</div>
      </div>
      <div className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-xs font-mono text-white/60">
        {t('selectedCount')}: {props.selectedCount} / {props.reviewCount}
      </div>
    </div>
  );
}

function useReviewQueueModel(input: {
  tasks: TaskSummary[];
  reviews: ReviewSummary[];
  submittingTaskIds: string[];
  onBulkReviewDecision?: ReviewQueueProps['onBulkReviewDecision'];
}) {
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [formValue, setFormValue] = React.useState<ReviewBulkFormValue>({
    reasonCode: '',
    mustFixText: '',
    canRedrive: true,
    redriveStrategy: 'same_worker_continue',
    acknowledgeRisk: false,
  });
  const reviewTasks = React.useMemo(() => input.tasks.filter((task) => task.status === 'review'), [input.tasks]);
  const waitingInputTasks = React.useMemo(() => input.tasks.filter((task) => task.status === 'waiting_for_input'), [input.tasks]);
  const reviewByTask = React.useMemo(() => latestReviewByTask(input.reviews), [input.reviews]);
  const selectedIds = [...selected];
  const canSubmit = selectedIds.length > 0 && input.submittingTaskIds.length === 0 && Boolean(input.onBulkReviewDecision);
  const riskSelectedCount = selectedIds.filter((taskId) => isRiskyReview(reviewByTask.get(taskId))).length;

  React.useEffect(() => {
    setSelected((current) => normalizeSelection(current, input.tasks));
  }, [input.tasks]);

  const toggleTask = (taskId: string) => setSelected((current) => {
    const next = new Set(current);
    if (next.has(taskId)) next.delete(taskId);
    else next.add(taskId);
    return next;
  });
  const submit = (decision: 'merge' | 'rework' | 'block') => {
    if (!canSubmit) return;
    input.onBulkReviewDecision?.(decision, selectedIds, buildDecisionInput(formValue));
  };
  return { canSubmit, formValue, reviewByTask, reviewTasks, riskSelectedCount, selected, selectedIds, submit, toggleTask, updateForm: setFormValue, waitingInputTasks };
}

export const ReviewQueue: React.FC<ReviewQueueProps> = ({
  tasks,
  reviews = [],
  selectedTaskId,
  submittingTaskIds = [],
  onSelectTask,
  onBulkReviewDecision,
}) => {
  const model = useReviewQueueModel({ tasks, reviews, submittingTaskIds, onBulkReviewDecision });

  return (
    <div className="p-4 space-y-4">
      <ReviewQueueHeader selectedCount={model.selectedIds.length} reviewCount={model.reviewTasks.length} />

      <WaitingInputQueue
        tasks={model.waitingInputTasks}
        selectedTaskId={selectedTaskId}
        onSelectTask={onSelectTask}
      />

      <ReviewTaskList
        tasks={model.reviewTasks}
        selected={model.selected}
        selectedTaskId={selectedTaskId}
        reviewByTask={model.reviewByTask}
        onToggleTask={model.toggleTask}
        onSelectTask={onSelectTask}
      />

      <ReviewBulkForm
        value={model.formValue}
        canSubmit={model.canSubmit}
        riskSelectedCount={model.riskSelectedCount}
        onChange={model.updateForm}
        onSubmit={model.submit}
      />
    </div>
  );
};
