import React from 'react';
import useSWR from 'swr';
import { Layout } from './components/Layout';
import { MetricsGrid } from './components/MetricsGrid';
import { TaskList, WorkerList } from './components/Lists';
import { TerminalPanel } from './components/TerminalPanel';
import { Panel } from './components/UI';
import { useTranslation } from './lib/i18n';

const fetcher = (url: string) => fetch(url).then(res => res.json());

const App: React.FC = () => {
  const { t } = useTranslation();
  const { data, error, isLoading } = useSWR('/api/dashboard/snapshot', fetcher, {
    refreshInterval: 4000,
    dedupingInterval: 2000,
  });

  const handleWorkerAction = async (workerId: string, isEnable: boolean) => {
    if (!isEnable) {
      if (!confirm(`${t('confirmDisable')} ${workerId}?`)) return;
    }
    
    try {
      const endpoint = isEnable 
        ? `/api/workers/${encodeURIComponent(workerId)}/enable` 
        : `/api/workers/${encodeURIComponent(workerId)}/disable`;
      
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ at: new Date().toISOString() })
      });
      
      if (!res.ok) throw new Error('Failed to update worker');
    } catch (err) {
      console.error(err);
      alert('Action failed');
    }
  };

  return (
    <Layout 
      updatedAt={data?.updatedAt} 
      isConnecting={isLoading && !data}
    >
      {error && (
        <div className="bg-rose-950/20 border border-rose-900 text-rose-400 p-4 rounded-lg text-sm mb-6">
          {t('connectionError')}: {error.message}
        </div>
      )}

      {data && (
        <>
          {/* Metrics Overview at the top */}
          <MetricsGrid stats={data.stats} />

          <div className="grid grid-cols-1 lg:grid-cols-4 gap-8 items-start">
            {/* Main Column: Tasks and Terminal */}
            <div className="lg:col-span-3 flex flex-col gap-8">
              <Panel title={t('tasks')}>
                <TaskList tasks={data.tasks} />
              </Panel>

              <TerminalPanel events={data.events} />
            </div>

            {/* Sidebar Column: Workers */}
            <div className="lg:col-span-1 flex flex-col gap-8">
              <Panel title={t('workers')}>
                <WorkerList workers={data.workers} onAction={handleWorkerAction} />
              </Panel>
            </div>
          </div>
        </>
      )}
    </Layout>
  );
};

export default App;
