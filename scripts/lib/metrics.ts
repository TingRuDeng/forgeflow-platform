interface TaskMetric {
  taskId: string;
  workerId: string;
  repo: string;
  status: "completed" | "failed" | "cancelled";
  durationMs: number;
  startedAt: string;
  completedAt: string;
}

interface MetricsSnapshot {
  tasksTotal: number;
  tasksCompleted: number;
  tasksFailed: number;
  tasksCancelled: number;
  avgDurationMs: number;
  p50DurationMs: number;
  p95DurationMs: number;
  p99DurationMs: number;
  recentTasks: TaskMetric[];
}

const metrics: TaskMetric[] = [];
const MAX_METRICS_SIZE = 10000;

export const recordTaskMetric = (metric: Omit<TaskMetric, "completedAt">) => {
  const fullMetric: TaskMetric = {
    ...metric,
    completedAt: new Date().toISOString(),
  };

  metrics.push(fullMetric);

  if (metrics.length > MAX_METRICS_SIZE) {
    metrics.splice(0, metrics.length - MAX_METRICS_SIZE);
  }
};

export const getMetricsSnapshot = (limit = 100): MetricsSnapshot => {
  const completed = metrics.filter((m) => m.status === "completed");
  const failed = metrics.filter((m) => m.status === "failed");
  const cancelled = metrics.filter((m) => m.status === "cancelled");

  const durations = [...completed, ...failed]
    .map((m) => m.durationMs)
    .sort((a, b) => a - b);

  const sum = durations.reduce((acc, d) => acc + d, 0);
  const avg = durations.length > 0 ? sum / durations.length : 0;

  const percentile = (arr: number[], p: number) => {
    if (arr.length === 0) return 0;
    const idx = Math.ceil((p / 100) * arr.length) - 1;
    return arr[Math.max(0, idx)];
  };

  const recentTasks = [...metrics]
    .reverse()
    .slice(0, limit)
    .reverse();

  return {
    tasksTotal: metrics.length,
    tasksCompleted: completed.length,
    tasksFailed: failed.length,
    tasksCancelled: cancelled.length,
    avgDurationMs: Math.round(avg),
    p50DurationMs: percentile(durations, 50),
    p95DurationMs: percentile(durations, 95),
    p99DurationMs: percentile(durations, 99),
    recentTasks,
  };
};

export const getWorkerMetrics = (workerId: string): MetricsSnapshot => {
  const workerMetrics = metrics.filter((m) => m.workerId === workerId);
  const completed = workerMetrics.filter((m) => m.status === "completed");
  const failed = workerMetrics.filter((m) => m.status === "failed");

  const durations = [...completed, ...failed]
    .map((m) => m.durationMs)
    .sort((a, b) => a - b);

  const sum = durations.reduce((acc, d) => acc + d, 0);
  const avg = durations.length > 0 ? sum / durations.length : 0;

  return {
    tasksTotal: workerMetrics.length,
    tasksCompleted: completed.length,
    tasksFailed: failed.length,
    tasksCancelled: workerMetrics.filter((m) => m.status === "cancelled").length,
    avgDurationMs: Math.round(avg),
    p50DurationMs: durations.length > 0 ? durations[Math.floor(durations.length * 0.5)] : 0,
    p95DurationMs: durations.length > 0 ? durations[Math.floor(durations.length * 0.95)] : 0,
    p99DurationMs: durations.length > 0 ? durations[Math.floor(durations.length * 0.99)] : 0,
    recentTasks: workerMetrics.slice(-100),
  };
};

export const clearMetrics = () => {
  metrics.length = 0;
};
