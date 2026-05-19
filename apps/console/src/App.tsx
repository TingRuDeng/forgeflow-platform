import React, { startTransition, useEffect, useMemo, useState } from 'react';
import useSWR from 'swr';
import { Layout } from './components/Layout';
import { MetricsGrid } from './components/MetricsGrid';
import { TaskDetailsPanel, TaskList, WorkerList } from './components/Lists';
import { TerminalPanel } from './components/TerminalPanel';
import { Panel } from './components/UI';
import { useTranslation } from './lib/i18n';

async function parseJsonResponse(res: Response) {
  const text = await res.text();
  if (!text.trim()) {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

const fetcher = async (url: string) => {
  const res = await fetch(url);
  const body = await parseJsonResponse(res);
  if (!res.ok) {
    const message = body && typeof body === 'object' && 'message' in body
      ? String((body as { message?: unknown }).message || res.statusText)
      : res.statusText;
    throw new Error(message || `HTTP ${res.status}`);
  }
  return body;
};

const App: React.FC = () => {
  const { t } = useTranslation();
  const { data, error, isLoading, mutate } = useSWR('/api/dashboard/snapshot', fetcher, {
    refreshInterval: 4000,
    dedupingInterval: 2000,
  });
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [cancellingTaskId, setCancellingTaskId] = useState<string | null>(null);
  const [updatingWorkerId, setUpdatingWorkerId] = useState<string | null>(null);

  const selectedTask = useMemo(() => {
    const tasks = Array.isArray(data?.tasks) ? data.tasks : [];
    if (tasks.length === 0) {
      return null;
    }
    return tasks.find((task: { id: string }) => task.id === selectedTaskId) || tasks[0];
  }, [data?.tasks, selectedTaskId]);

  const selectedAssignment = useMemo(() => {
    if (!selectedTask?.id || !Array.isArray(data?.assignments)) {
      return null;
    }
    return data.assignments.find((assignment: { taskId: string }) => assignment.taskId === selectedTask.id) || null;
  }, [data?.assignments, selectedTask?.id]);

  const selectedReviews = useMemo(() => {
    if (!selectedTask?.id || !Array.isArray(data?.reviews)) {
      return [];
    }
    return data.reviews.filter((review: { taskId: string }) => review.taskId === selectedTask.id);
  }, [data?.reviews, selectedTask?.id]);

  const selectedReview = selectedReviews.length > 0 ? selectedReviews[selectedReviews.length - 1] : null;

  const selectedPullRequest = useMemo(() => {
    if (!selectedTask?.id || !Array.isArray(data?.pullRequests)) {
      return null;
    }
    return data.pullRequests.find((pullRequest: { taskId: string }) => pullRequest.taskId === selectedTask.id) || null;
  }, [data?.pullRequests, selectedTask?.id]);

  const selectedEvents = useMemo(() => {
    if (!selectedTask?.id || !Array.isArray(data?.events)) {
      return [];
    }
    return data.events.filter((event: { taskId: string }) => event.taskId === selectedTask.id);
  }, [data?.events, selectedTask?.id]);

  const selectedAttempts = useMemo(() => {
    if (!selectedTask?.id || !Array.isArray(data?.taskAttempts)) {
      return [];
    }
    return data.taskAttempts.filter((attempt: { taskId: string }) => attempt.taskId === selectedTask.id);
  }, [data?.taskAttempts, selectedTask?.id]);

  const selectedArtifactBundles = useMemo(() => {
    if (!selectedTask?.id || !Array.isArray(data?.artifactBundles)) {
      return [];
    }
    return data.artifactBundles.filter((bundle: { taskId: string }) => bundle.taskId === selectedTask.id);
  }, [data?.artifactBundles, selectedTask?.id]);

  useEffect(() => {
    const tasks = Array.isArray(data?.tasks) ? data.tasks : [];
    if (tasks.length === 0) {
      if (selectedTaskId !== null) {
        startTransition(() => setSelectedTaskId(null));
      }
      return;
    }
    const hasSelectedTask = selectedTaskId && tasks.some((task: { id: string }) => task.id === selectedTaskId);
    if (!hasSelectedTask) {
      startTransition(() => setSelectedTaskId(tasks[0].id));
    }
  }, [data?.tasks, selectedTaskId]);

  const handleWorkerAction = async (workerId: string, isEnable: boolean) => {
    if (!isEnable) {
      if (!confirm(`${t('confirmDisable')} ${workerId}?`)) return;
    }
    
    try {
      setUpdatingWorkerId(workerId);
      const endpoint = isEnable 
        ? `/api/workers/${encodeURIComponent(workerId)}/enable` 
        : `/api/workers/${encodeURIComponent(workerId)}/disable`;
      
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ at: new Date().toISOString() })
      });
      
      if (!res.ok) throw new Error('Failed to update worker');
      await mutate();
    } catch (err) {
      console.error(err);
      alert(t('workerActionFailed'));
    } finally {
      setUpdatingWorkerId(null);
    }
  };

  const handleTaskCancel = async (task: { id: string; title?: string }) => {
    if (!confirm(`${t('confirmCancelTask')} ${task.title || task.id}?`)) return;
    const reason = prompt(t('cancelReasonPrompt'), t('cancelReasonDefault'))?.trim();

    try {
      setCancellingTaskId(task.id);
      const res = await fetch(`/api/tasks/${encodeURIComponent(task.id)}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          at: new Date().toISOString(),
          actor: 'console-ui',
          reason: reason || t('cancelReasonDefault'),
        }),
      });

      if (!res.ok) {
        throw new Error('Failed to cancel task');
      }

      await mutate();
    } catch (err) {
      console.error(err);
      alert(t('taskActionFailed'));
    } finally {
      setCancellingTaskId(null);
    }
  };

  return (
    <Layout 
      updatedAt={data?.updatedAt} 
      isConnecting={isLoading && !data}
    >
      {error && (
        <div className="glass rounded-lg p-4 text-sm mb-6 border-rose-500/30 bg-rose-500/10 text-rose-300 animate-fade-in">
          {t('connectionError')}: {error.message}
        </div>
      )}

      {data && (
        <div className="animate-fade-in">
          {/* Metrics Overview at the top */}
          <MetricsGrid stats={data.stats} metrics={data.metrics} />

          <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 items-start">
            {/* Main Column: Tasks and Terminal */}
            <div className="lg:col-span-3 flex flex-col gap-6">
              <Panel title={t('tasks')}>
                <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.65fr)_minmax(340px,1fr)]">
                  <TaskList
                    tasks={data.tasks}
                    selectedTaskId={selectedTask?.id || null}
                    onSelect={setSelectedTaskId}
                  />
                  <TaskDetailsPanel
                    task={selectedTask}
                    assignment={selectedAssignment}
                    review={selectedReview}
                    pullRequest={selectedPullRequest}
                    events={selectedEvents}
                    attempts={selectedAttempts}
                    artifactBundles={selectedArtifactBundles}
                    cancellingTaskId={cancellingTaskId}
                    onCancel={handleTaskCancel}
                  />
                </div>
              </Panel>

              <TerminalPanel events={data.events} />
            </div>

            {/* Sidebar Column: Workers */}
            <div className="lg:col-span-1 flex flex-col gap-6">
              <Panel title={t('workers')}>
                <WorkerList
                  workers={data.workers}
                  updatingWorkerId={updatingWorkerId}
                  onAction={handleWorkerAction}
                />
              </Panel>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
};

export default App;
