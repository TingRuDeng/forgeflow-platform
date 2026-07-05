import React from 'react';
import { Search } from 'lucide-react';
import { useTranslation } from '@/lib/i18n';
import type { ArtifactBundle } from './TaskTimeline';
import { ArtifactWorkbenchRefs } from './ArtifactWorkbenchRefs';
import { ArtifactWorkbenchTrajectory } from './ArtifactWorkbenchTrajectory';
import { ArtifactWorkbenchTrajectoryComparison } from './ArtifactWorkbenchTrajectoryComparison';
import { RuntimeEventWorkbench } from './RuntimeEventWorkbench';
import { flattenTrajectorySearchTerms } from './artifactTrajectorySummaryModel';
import { flattenArtifactRefs } from './artifactWorkbenchRefsModel';

interface TaskSummary {
  id: string;
  title?: string;
  status?: string;
  repo?: string;
}

interface ReviewSummary {
  taskId: string;
  evidence?: {
    reasonCode?: string;
    mustFix?: string[];
  } | null;
  riskAssessment?: {
    level?: string | null;
    reasons?: string[];
  } | null;
}

interface RuntimeEvent {
  taskId: string;
  type: string;
  at?: string;
  summary?: string;
  payload?: {
    message?: string;
    failureCode?: string;
    data?: {
      message?: string;
      failureCode?: string;
    } | null;
  } | null;
}

interface ArtifactWorkbenchProps {
  bundles: ArtifactBundle[];
  tasks: TaskSummary[];
  reviews?: ReviewSummary[];
  events?: RuntimeEvent[];
  selectedTaskId?: string | null;
  onSelectTask?: (taskId: string) => void;
}

function normalize(value: unknown): string {
  return String(value ?? '').toLowerCase();
}

function countRefs(bundle: ArtifactBundle): number {
  return flattenArtifactRefs(bundle).length;
}

function latestReview(reviews: ReviewSummary[], taskId: string): ReviewSummary | undefined {
  return reviews.filter((review) => review.taskId === taskId).at(-1);
}

function bundleMatches(bundle: ArtifactBundle, task: TaskSummary | undefined, review: ReviewSummary | undefined, query: string): boolean {
  if (!query) return true;
  const searchable = [
    bundle.bundleId,
    bundle.taskId,
    bundle.attemptId,
    bundle.summary,
    task?.title,
    task?.status,
    task?.repo,
    review?.evidence?.reasonCode,
    review?.riskAssessment?.level,
    ...(review?.evidence?.mustFix ?? []),
    ...(review?.riskAssessment?.reasons ?? []),
    ...(bundle.changedFiles ?? []).map((file) => file.path),
    ...Object.keys(bundle.refs ?? {}),
    ...flattenArtifactRefs(bundle).map((entry) => entry.ref),
    ...flattenTrajectorySearchTerms(bundle),
  ].map(normalize).join(' ');
  return searchable.includes(query);
}

function countValues(values: Array<string | null | undefined>): Array<[string, number]> {
  const counts = new Map<string, number>();
  values.filter(Boolean).forEach((value) => {
    const key = String(value);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  });
  return [...counts.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));
}

function evidenceCountClass(hasDifference: boolean): string {
  return hasDifference
    ? 'rounded border border-amber-300/30 bg-amber-300/10 px-2 py-1 font-mono text-amber-100'
    : 'rounded border border-white/10 bg-white/5 px-2 py-1 font-mono';
}

const EvidenceComparison: React.FC<{
  bundles: ArtifactBundle[];
  reviewByTask: Map<string, ReviewSummary | undefined>;
  taskById: Map<string, TaskSummary>;
}> = ({ bundles, reviewByTask, taskById }) => {
  const { t } = useTranslation();
  if (bundles.length < 2) return null;
  const reviews = bundles.map((bundle) => reviewByTask.get(bundle.taskId));
  const reasonCounts = countValues(reviews.map((review) => review?.evidence?.reasonCode));
  const riskCounts = countValues(reviews.map((review) => review?.riskAssessment?.level));
  if (reasonCounts.length === 0 && riskCounts.length === 0) return null;
  const hasReasonDiff = reasonCounts.length > 1;
  const hasRiskDiff = riskCounts.length > 1;
  return (
    <div className="rounded-lg border border-white/10 bg-black/15 p-3">
      <div className="text-[11px] uppercase tracking-wide text-white/45">{t('artifactEvidenceComparison')}</div>
      {(hasReasonDiff || hasRiskDiff) && (
        <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-amber-100">
          <span>{t('artifactEvidenceDifferences')}</span>
          {hasReasonDiff && <span>{t('reasonCode')}: {reasonCounts.length}</span>}
          {hasRiskDiff && <span>{t('riskLevelLabel')}: {riskCounts.length}</span>}
        </div>
      )}
      <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-white/60">
        {reasonCounts.map(([reason, count]) => (
          <span key={`reason-${reason}`} className={evidenceCountClass(hasReasonDiff)}>{reason} {count}</span>
        ))}
        {riskCounts.map(([risk, count]) => (
          <span key={`risk-${risk}`} className={evidenceCountClass(hasRiskDiff)}>{risk} {count}</span>
        ))}
      </div>
      <div className="mt-3">
        <div className="text-[11px] uppercase tracking-wide text-white/45">{t('artifactEvidenceSideBySide')}</div>
        <div className="mt-2 grid grid-cols-1 gap-1 md:grid-cols-2">
          {bundles.map((bundle) => {
            const task = taskById.get(bundle.taskId);
            const review = reviewByTask.get(bundle.taskId);
            return (
              <div key={`evidence-row-${bundle.bundleId || bundle.taskId}`} className="rounded border border-white/10 bg-white/[0.03] px-2 py-1 text-[11px] text-white/60">
                {task?.title || bundle.taskId} | {review?.evidence?.reasonCode || '--'} | {review?.riskAssessment?.level || '--'}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

const ReviewEvidenceBadges: React.FC<{ review?: ReviewSummary }> = ({ review }) => {
  const { t } = useTranslation();
  const mustFix = review?.evidence?.mustFix ?? [];
  const riskReasons = review?.riskAssessment?.reasons ?? [];
  if (!review?.evidence?.reasonCode && !review?.riskAssessment?.level && mustFix.length === 0) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-white/55">
      {review?.evidence?.reasonCode && <span className="font-mono">{t('reasonCode')}: {review.evidence.reasonCode}</span>}
      {review?.riskAssessment?.level && <span className="font-mono">{t('riskLevelLabel')}: {review.riskAssessment.level}</span>}
      {mustFix.slice(0, 2).map((item) => <span key={item} className="break-all">{t('mustFix')}: {item}</span>)}
      {riskReasons[0] && <span className="break-all">{t('riskReasons')}: {riskReasons[0]}</span>}
    </div>
  );
};

export const ArtifactWorkbench: React.FC<ArtifactWorkbenchProps> = ({
  bundles,
  tasks,
  reviews = [],
  events = [],
  selectedTaskId,
  onSelectTask,
}) => {
  const { t } = useTranslation();
  const [query, setQuery] = React.useState('');
  const normalizedQuery = query.trim().toLowerCase();
  const taskById = React.useMemo(() => new Map(tasks.map((task) => [task.id, task])), [tasks]);
  const reviewByTask = React.useMemo(() => new Map(tasks.map((task) => [task.id, latestReview(reviews, task.id)])), [reviews, tasks]);
  const filteredBundles = React.useMemo(() => {
    return bundles
      .filter((bundle) => bundleMatches(bundle, taskById.get(bundle.taskId), reviewByTask.get(bundle.taskId), normalizedQuery))
      .slice()
      .reverse();
  }, [bundles, normalizedQuery, reviewByTask, taskById]);

  return (
    <div className="p-4 space-y-4">
      <RuntimeEventWorkbench events={events} tasks={tasks} onSelectTask={onSelectTask} />

      <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-3">
        <label className="relative block">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-white/35" aria-hidden="true" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('artifactSearchPlaceholder')}
            className="w-full rounded-lg border border-white/10 bg-black/20 py-2 pl-9 pr-3 text-sm text-white/85 outline-none placeholder:text-white/35 focus:border-cyan-300/60"
          />
        </label>
        <div className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-xs font-mono text-white/60">
          {filteredBundles.length} / {bundles.length}
        </div>
      </div>

      {filteredBundles.length > 0 ? (
        <div className="grid grid-cols-1 gap-2">
          <EvidenceComparison bundles={filteredBundles} reviewByTask={reviewByTask} taskById={taskById} />
          <ArtifactWorkbenchTrajectoryComparison bundles={filteredBundles} taskById={taskById} onSelectTask={onSelectTask} />
          {filteredBundles.map((bundle) => {
            const task = taskById.get(bundle.taskId);
            const review = reviewByTask.get(bundle.taskId);
            const active = selectedTaskId === bundle.taskId;
            return (
              <div
                key={`${bundle.bundleId || bundle.taskId}-${bundle.attemptId || 'attempt'}`}
                className={`rounded-lg border p-3 text-left transition-colors ${active ? 'border-cyan-300/55 bg-cyan-300/10' : 'border-white/10 bg-black/15 hover:border-white/25 hover:bg-white/5'}`}
              >
                <button
                  type="button"
                  onClick={() => onSelectTask?.(bundle.taskId)}
                  className="w-full text-left"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-white/85 break-all">{task?.title || bundle.taskId}</div>
                      <div className="mt-1 text-xs font-mono text-white/45 break-all">{bundle.bundleId || bundle.attemptId || bundle.taskId}</div>
                    </div>
                    <div className="shrink-0 rounded-md border border-white/10 px-2 py-1 text-[11px] uppercase tracking-wide text-white/55">
                      {task?.status || '--'}
                    </div>
                  </div>
                  <div className="mt-2 text-xs text-white/60 break-all">{bundle.summary || t('noSummary')}</div>
                  <ReviewEvidenceBadges review={review} />
                  <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-white/45">
                    <span>{t('changedFiles')}: {(bundle.changedFiles ?? []).length}</span>
                    <span>{t('artifactRefs')}: {countRefs(bundle)}</span>
                    {task?.repo && <span>{t('repo')}: {task.repo}</span>}
                  </div>
                </button>
                <ArtifactWorkbenchTrajectory bundle={bundle} />
                <ArtifactWorkbenchRefs bundle={bundle} />
              </div>
            );
          })}
        </div>
      ) : (
        <div className="rounded-lg border border-white/10 bg-black/15 p-4 text-center text-sm text-white/45">
          {t('noMatchingArtifacts')}
        </div>
      )}
    </div>
  );
};
