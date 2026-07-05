import { useTranslation } from '@/lib/i18n';
import { Badge } from './UI';
import type { ReviewSummary, TaskSummary } from './ReviewQueue';

export function ReviewTaskList(props: {
  tasks: TaskSummary[];
  selected: Set<string>;
  selectedTaskId?: string | null;
  reviewByTask: Map<string, ReviewSummary>;
  onToggleTask: (taskId: string) => void;
  onSelectTask?: (taskId: string) => void;
}) {
  const { t } = useTranslation();
  if (props.tasks.length === 0) {
    return (
      <div className="rounded-lg border border-white/10 bg-black/15 p-4 text-center text-sm text-white/45">
        {t('noReviewTasks')}
      </div>
    );
  }
  return (
    <div className="grid grid-cols-1 gap-2">
      {props.tasks.map((task) => (
        <ReviewTaskCard
          key={task.id}
          task={task}
          review={props.reviewByTask.get(task.id)}
          selected={props.selected.has(task.id)}
          active={props.selectedTaskId === task.id}
          onToggleTask={props.onToggleTask}
          onSelectTask={props.onSelectTask}
        />
      ))}
    </div>
  );
}

function ReviewTaskCard(props: {
  task: TaskSummary;
  review?: ReviewSummary;
  selected: boolean;
  active: boolean;
  onToggleTask: (taskId: string) => void;
  onSelectTask?: (taskId: string) => void;
}) {
  const { t } = useTranslation();
  const status = props.task.status || 'review';
  return (
    <div className={`rounded-lg border p-3 transition-colors ${props.active ? 'border-cyan-300/55 bg-cyan-300/10' : 'border-white/10 bg-black/15'}`}>
      <div className="flex items-start gap-3">
        <input
          type="checkbox"
          aria-label={`${t('selectReviewTask')} ${props.task.id}`}
          checked={props.selected}
          onChange={() => props.onToggleTask(props.task.id)}
          className="mt-1"
        />
        <button type="button" className="min-w-0 flex-1 text-left" onClick={() => props.onSelectTask?.(props.task.id)}>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-white/85 break-all">{props.task.title || props.task.id}</span>
            <Badge status={status}>{t(`status.${status}`)}</Badge>
          </div>
          <div className="mt-1 text-xs font-mono text-white/45 break-all">{props.task.id}</div>
          <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-white/45">
            {props.task.repo && <span>{t('repo')}: {props.task.repo}</span>}
            {props.task.branchName && <span>{t('branch')}: {props.task.branchName}</span>}
            {props.review?.riskAssessment?.level && <span>{t('riskLevelLabel')}: {props.review.riskAssessment.level}</span>}
            {props.review?.evidence?.reasonCode && <span>{t('reasonCode')}: {props.review.evidence.reasonCode}</span>}
          </div>
        </button>
      </div>
    </div>
  );
}
