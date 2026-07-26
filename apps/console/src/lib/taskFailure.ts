export interface TaskFailureAttempt {
  status?: string;
  endedAt?: string;
  completedAt?: string;
  heartbeatAt?: string;
  failureCode?: string;
  failureMessage?: string;
}

export interface TaskFailureEvent {
  type: string;
  at?: string;
  summary?: string;
  payload?: {
    to?: string;
    message?: string;
    error?: string;
    failureType?: string;
    failureCode?: string;
    failureSummary?: string;
    data?: {
      message?: string;
      error?: string;
      failureType?: string;
      failureCode?: string;
      failureSummary?: string;
    } | null;
  } | null;
}

export interface TaskFailureReview {
  latestWorkerResult?: {
    generatedAt?: string;
    output?: string;
    evidence?: {
      failureType?: string;
      failureSummary?: string;
      blockers?: Array<{
        kind?: string;
        code?: string;
        message?: string;
      }>;
    } | null;
  } | null;
}

export interface ResolvedTaskFailure {
  type: string | null;
  code: string | null;
  summary: string | null;
  at: string | null;
  source: "worker_result" | "attempt" | "runtime_event" | null;
}

interface FailureCandidate extends ResolvedTaskFailure {
  order: number;
  sourcePriority: number;
}

const KNOWN_EVENT_FAILURE_TYPES = new Set([
  "attempt_expired",
  "cleanup_failed",
  "delivery_failed",
  "submit_result_retry_failed",
]);

function clean(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function timestamp(value: string | null): number {
  const parsed = Date.parse(value ?? "");
  return Number.isFinite(parsed) ? parsed : 0;
}

function inferFailureType(code: string | null): string | null {
  if (!code) return null;
  if (/preflight|workspace|worktree|branch_mismatch/.test(code)) return "preflight";
  if (/verification|test|artifact_remote/.test(code)) return "verification";
  if (/delivery|timeout|expired|execution|model|gateway/.test(code)) return "execution";
  return "unknown";
}

function eventFailureCandidate(event: TaskFailureEvent, order: number): FailureCandidate | null {
  const payload = event.payload ?? null;
  const data = payload?.data ?? null;
  const isFailedStatus = event.type === "status_changed" && payload?.to === "failed";
  const code = clean(payload?.failureCode) ?? clean(data?.failureCode);
  const summary = clean(payload?.failureSummary)
    ?? clean(data?.failureSummary)
    ?? clean(payload?.message)
    ?? clean(data?.message)
    ?? clean(payload?.error)
    ?? clean(data?.error)
    ?? clean(event.summary);
  if (!isFailedStatus && !KNOWN_EVENT_FAILURE_TYPES.has(event.type) && !event.type.endsWith("_failed") && !code) {
    return null;
  }
  return {
    type: clean(payload?.failureType) ?? clean(data?.failureType) ?? inferFailureType(code),
    code: code ?? (event.type.endsWith("_failed") || event.type === "attempt_expired" ? event.type : null),
    summary,
    at: clean(event.at),
    source: "runtime_event",
    order,
    sourcePriority: 1,
  };
}

export function resolveTaskFailure(input: {
  taskStatus?: string;
  review?: TaskFailureReview | null;
  attempts?: TaskFailureAttempt[];
  events?: TaskFailureEvent[];
}): ResolvedTaskFailure {
  const candidates: FailureCandidate[] = [];
  const result = input.review?.latestWorkerResult;
  const blocker = result?.evidence?.blockers?.find((candidate) =>
    Boolean(clean(candidate.code) || clean(candidate.message))
  );
  const hasFailureEvidence = Boolean(
    blocker
    || clean(result?.evidence?.failureType)
    || clean(result?.evidence?.failureSummary),
  );
  const includeWorkerFailure = !input.taskStatus
    || ["failed", "blocked", "review"].includes(input.taskStatus);
  if (hasFailureEvidence && includeWorkerFailure) {
    const resultSummary = clean(blocker?.message)
      ?? clean(result?.evidence?.failureSummary)
      ?? clean(result?.output);
    const code = clean(blocker?.code);
    candidates.push({
      type: clean(blocker?.kind) ?? clean(result?.evidence?.failureType) ?? inferFailureType(code),
      code,
      summary: resultSummary,
      at: clean(result?.generatedAt),
      source: "worker_result",
      order: 0,
      sourcePriority: 3,
    });
  }

  const includeHistoricalFailures = !input.taskStatus || input.taskStatus === "failed";
  if (includeHistoricalFailures) {
    (input.attempts ?? []).forEach((attempt, index) => {
      const code = clean(attempt.failureCode);
      const summary = clean(attempt.failureMessage);
      if (!code && !summary) return;
      candidates.push({
        type: inferFailureType(code),
        code,
        summary,
        at: clean(attempt.endedAt) ?? clean(attempt.completedAt) ?? clean(attempt.heartbeatAt),
        source: "attempt",
        order: index,
        sourcePriority: 2,
      });
    });

    (input.events ?? []).forEach((event, index) => {
      const candidate = eventFailureCandidate(event, index);
      if (candidate) candidates.push(candidate);
    });
  }

  const latest = candidates.sort((left, right) => {
    const timeDifference = timestamp(right.at) - timestamp(left.at);
    if (timeDifference !== 0) return timeDifference;
    const sourceDifference = right.sourcePriority - left.sourcePriority;
    if (sourceDifference !== 0) return sourceDifference;
    return right.order - left.order;
  })[0];

  if (!latest) {
    return { type: null, code: null, summary: null, at: null, source: null };
  }
  return {
    type: latest.type,
    code: latest.code,
    summary: latest.summary,
    at: latest.at,
    source: latest.source,
  };
}

export function resolveLatestProgress(events: TaskFailureEvent[]): TaskFailureEvent | null {
  return [...events]
    .filter((event) => event.type === "progress_reported")
    .sort((left, right) => timestamp(clean(right.at)) - timestamp(clean(left.at)))[0] ?? null;
}
