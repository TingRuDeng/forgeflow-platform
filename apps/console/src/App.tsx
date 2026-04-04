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
        <div className="glass rounded-lg p-4 text-sm mb-6 border-rose-500/30 bg-rose-500/10 text-rose-300 animate-fade-in">
          {t('connectionError')}: {error.message}
        </div>
      )}

      {data && (
        <div className="animate-fade-in">
          {/* Metrics Overview at the top */}
          <MetricsGrid stats={data.stats} />

          <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 items-start">
            {/* Main Column: Tasks and Terminal */}
            <div className="lg:col-span-3 flex flex-col gap-6">
              <Panel title={t('tasks')}>
                <TaskList tasks={data.tasks} />
              </Panel>

              <TerminalPanel events={data.events} />
            </div>

            {/* Sidebar Column: Workers */}
            <div className="lg:col-span-1 flex flex-col gap-6">
              <Panel title={t('workers')}>
                <WorkerList workers={data.workers} onAction={handleWorkerAction} />
              </Panel>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
};

export default App;
