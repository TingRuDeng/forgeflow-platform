export function buildDashboardHtml(): string {
  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>ForgeFlow Console</title>
    <style>
      :root {
        --bg-color: #f7f9fa;
        --panel-bg: #ffffff;
        --text-primary: #111827;
        --text-secondary: #6b7280;
        --border-color: #e5e7eb;
        --accent-color: #2563eb;
        --status-success: #10b981;
        --status-warning: #f59e0b;
        --status-error: #ef4444;
        --status-idle: #e5e7eb;
        --status-assigned: #3b82f6;
        --status-review: #8b5cf6;
        --status-busy: #f59e0b;
        --status-merged: #10b981;
        --font-sans: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      }
      @media (prefers-color-scheme: dark) {
        :root {
          --bg-color: #0f1115;
          --panel-bg: #1f232b;
          --text-primary: #f3f4f6;
          --text-secondary: #9ca3af;
          --border-color: #374151;
        }
      }
      body {
        margin: 0;
        background-color: var(--bg-color);
        color: var(--text-primary);
        font-family: var(--font-sans);
        -webkit-font-smoothing: antialiased;
        line-height: 1.5;
      }
      .container {
        max-width: 1400px;
        margin: 0 auto;
        padding: 32px 24px;
        display: flex;
        flex-direction: column;
        gap: 32px;
      }
      header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding-bottom: 24px;
        border-bottom: 1px solid var(--border-color);
      }
      header h1 {
        margin: 0;
        font-size: 28px;
        font-weight: 600;
        letter-spacing: -0.02em;
      }
      .header-controls {
        display: flex;
        align-items: center;
        gap: 16px;
      }
      .lang-toggle {
        background: var(--panel-bg);
        border: 1px solid var(--border-color);
        padding: 6px 12px;
        border-radius: 6px;
        font-size: 13px;
        color: var(--text-primary);
        cursor: pointer;
        font-family: var(--font-sans);
        transition: all 0.2s;
      }
      .lang-toggle:hover {
        background: var(--accent-color);
        color: white;
        border-color: var(--accent-color);
      }
      .updated-pill {
        background-color: var(--panel-bg);
        border: 1px solid var(--border-color);
        padding: 4px 12px;
        border-radius: 9999px;
        font-size: 13px;
        color: var(--text-secondary);
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .updated-indicator {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background-color: var(--status-success);
        box-shadow: 0 0 0 2px rgba(16, 185, 129, 0.2);
        animation: pulse 2s infinite;
      }
      @keyframes pulse {
        0% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.4); }
        70% { transform: scale(1); box-shadow: 0 0 0 6px rgba(16, 185, 129, 0); }
        100% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(16, 185, 129, 0); }
      }
      
      .kpi-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
        gap: 20px;
      }
      .kpi-card {
        background: var(--panel-bg);
        border: 1px solid var(--border-color);
        border-radius: 12px;
        padding: 20px;
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      .kpi-label {
        font-size: 14px;
        font-weight: 500;
        color: var(--text-secondary);
        text-transform: uppercase;
        letter-spacing: 0.05em;
      }
      .kpi-value {
        font-size: 32px;
        font-weight: 700;
        line-height: 1;
      }
      .kpi-details {
        font-size: 13px;
        color: var(--text-secondary);
        margin-top: 4px;
      }

      .main-grid {
        display: grid;
        grid-template-columns: 2fr 1fr;
        gap: 24px;
      }
      @media (max-width: 1024px) {
        .main-grid { grid-template-columns: 1fr; }
      }

      .panel {
        background: var(--panel-bg);
        border: 1px solid var(--border-color);
        border-radius: 12px;
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
        overflow: hidden;
        display: flex;
        flex-direction: column;
      }
      .panel-header {
        padding: 16px 20px;
        border-bottom: 1px solid var(--border-color);
        background: rgba(0, 0, 0, 0.02);
      }
      .panel-header h2 {
        margin: 0;
        font-size: 16px;
        font-weight: 600;
      }
      .panel-body {
        padding: 0;
        overflow-y: auto;
        max-height: 500px;
      }
      .panel-body.padded {
        padding: 16px 20px;
      }

      .empty-state {
        padding: 40px 20px;
        text-align: center;
        color: var(--text-secondary);
        font-size: 14px;
      }

      /* List and Table Styles */
      .item-list {
        display: flex;
        flex-direction: column;
        gap: 0;
      }
      .item-row {
        display: grid;
        grid-template-columns: 1fr;
        padding: 16px 20px;
        border-bottom: 1px solid var(--border-color);
        gap: 8px;
      }
      .item-row:last-child {
        border-bottom: none;
      }
      .item-row-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
      }
      .item-title-group {
        display: flex;
        align-items: center;
        gap: 12px;
      }
      .item-id {
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
        font-size: 13px;
        font-weight: 500;
      }
      .item-meta {
        display: flex;
        gap: 16px;
        font-size: 13px;
        color: var(--text-secondary);
      }

      /* Event Feed */
      .event-feed {
        display: flex;
        flex-direction: column;
        gap: 16px;
        padding: 20px;
      }
      .event-card {
        display: flex;
        flex-direction: column;
        gap: 4px;
        font-size: 13px;
        border-left: 2px solid var(--border-color);
        padding-left: 12px;
      }
      .event-header {
        display: flex;
        justify-content: space-between;
        color: var(--text-secondary);
        font-size: 12px;
      }
      .event-title {
        font-weight: 600;
        color: var(--text-primary);
      }
      .event-payload {
        font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
        background: rgba(0, 0, 0, 0.04);
        padding: 8px;
        border-radius: 6px;
        margin-top: 4px;
        overflow-x: auto;
        white-space: pre-wrap;
        word-break: break-all;
        color: var(--text-secondary);
      }
      @media (prefers-color-scheme: dark) {
        .event-payload { background: rgba(255, 255, 255, 0.05); }
      }

      /* Badges */
      .badge {
        display: inline-flex;
        align-items: center;
        padding: 2px 8px;
        border-radius: 9999px;
        font-size: 12px;
        font-weight: 600;
        text-transform: capitalize;
      }
      .badge.idle { background: #e5e7eb; color: #374151; }
      .badge.busy { background: #fef3c7; color: #92400e; }
      .badge.assigned { background: #dbeafe; color: #1e40af; }
      .badge.in_progress { background: #dbeafe; color: #1e40af; }
      .badge.review { background: #ede9fe; color: #5b21b6; }
      .badge.merged { background: #d1fae5; color: #065f46; }
      .badge.failed { background: #fee2e2; color: #991b1b; }
      .badge.blocked { background: #fee2e2; color: #991b1b; }
      .badge.disabled { background: #f3f4f6; color: #6b7280; text-decoration: line-through; }
      @media (prefers-color-scheme: dark) {
        .badge.idle { background: #374151; color: #d1d5db; }
        .badge.busy { background: #92400e; color: #fef3c7; }
        .badge.assigned { background: #1e3a8a; color: #dbeafe; }
        .badge.in_progress { background: #1e3a8a; color: #dbeafe; }
        .badge.review { background: #4c1d95; color: #ede9fe; }
        .badge.merged { background: #064e3b; color: #d1fae5; }
        .badge.failed { background: #7f1d1d; color: #fee2e2; }
        .badge.blocked { background: #7f1d1d; color: #fee2e2; }
        .badge.disabled { background: #1f2937; color: #9ca3af; }
      }
    </style>
  </head>
  <body>
    <div class="container">
      <header>
        <h1 id="page-title">ForgeFlow 控制平面</h1>
        <div class="header-controls">
          <button class="lang-toggle" id="lang-toggle" onclick="toggleLanguage()">English</button>
          <div class="updated-pill">
            <div class="updated-indicator"></div>
            <span id="updated-text">连接中...</span>
          </div>
        </div>
      </header>

      <section class="kpi-grid" id="stats-grid"></section>

      <div class="main-grid">
        <div class="left-col" style="display: flex; flex-direction: column; gap: 24px;">
          <section class="panel">
            <div class="panel-header"><h2 id="tasks-title">任务</h2></div>
            <div class="panel-body">
              <div id="tasks-list" class="item-list"></div>
            </div>
          </section>

          <section class="panel">
            <div class="panel-header"><h2 id="workers-title">工作节点</h2></div>
            <div class="panel-body">
              <div id="workers-list" class="item-list"></div>
            </div>
          </section>
          
          <section class="panel">
            <div class="panel-header"><h2 id="prs-title">合并请求</h2></div>
            <div class="panel-body">
              <div id="prs-list" class="item-list"></div>
            </div>
          </section>
        </div>

        <div class="right-col">
          <section class="panel">
            <div class="panel-header"><h2 id="events-title">最近事件</h2></div>
            <div class="panel-body">
              <div id="events-feed" class="event-feed"></div>
            </div>
          </section>
        </div>
      </div>
    </div>

    <script>
      const I18N = {
        zh: {
          pageTitle: 'ForgeFlow 控制平面',
          tasks: '任务',
          workers: '工作节点',
          prs: '合并请求',
          events: '最近事件',
          activeWorkers: '活跃工作节点',
          totalTasks: '任务总数',
          idle: '空闲',
          busy: '忙碌',
          disabled: '已禁用',
          review: '待审查',
          merged: '已合并',
          noActiveTasks: '暂无活跃任务',
          noActiveWorkers: '暂无活跃工作节点',
          noActivePRs: '暂无活跃合并请求',
          noRecentEvents: '暂无最近事件',
          worker: '工作节点',
          unassigned: '未分配',
          branch: '分支',
          task: '任务',
          host: '主机',
          none: '无',
          enable: '启用',
          disable: '禁用',
          connecting: '连接中...',
          lastUpdate: '最后更新',
          connectionError: '连接错误',
          confirmDisable: '确定要禁用工作节点',
          status: {
            idle: '空闲',
            busy: '忙碌',
            assigned: '已分配',
            in_progress: '进行中',
            review: '待审查',
            merged: '已合并',
            failed: '失败',
            blocked: '阻塞',
            offline: '离线',
            ready: '就绪',
            pending: '待处理',
            disabled: '已禁用'
          },
          eventType: {
            created: '已创建',
            status_changed: '状态变更',
            assigned: '已分配',
            started: '已开始',
            result_recorded: '结果已记录',
            review_decision: '审查决策',
            progress_reported: '进度报告'
          }
        },
        en: {
          pageTitle: 'ForgeFlow Control Plane',
          tasks: 'Tasks',
          workers: 'Workers',
          prs: 'Pull Requests',
          events: 'Recent Events',
          activeWorkers: 'Active Workers',
          totalTasks: 'Total Tasks',
          idle: 'Idle',
          busy: 'Busy',
          disabled: 'Disabled',
          review: 'Review',
          merged: 'Merged',
          noActiveTasks: 'No active tasks',
          noActiveWorkers: 'No active workers',
          noActivePRs: 'No active PRs',
          noRecentEvents: 'No recent events',
          worker: 'Worker',
          unassigned: 'Unassigned',
          branch: 'Branch',
          task: 'Task',
          host: 'Host',
          none: 'None',
          enable: 'Enable',
          disable: 'Disable',
          connecting: 'Connecting...',
          lastUpdate: 'Last update',
          connectionError: 'Connection error',
          confirmDisable: 'Are you sure you want to disable worker',
          status: {
            idle: 'Idle',
            busy: 'Busy',
            assigned: 'Assigned',
            in_progress: 'In Progress',
            review: 'Review',
            merged: 'Merged',
            failed: 'Failed',
            blocked: 'Blocked',
            offline: 'Offline',
            ready: 'Ready',
            pending: 'Pending',
            disabled: 'Disabled'
          },
          eventType: {
            created: 'Created',
            status_changed: 'Status Changed',
            assigned: 'Assigned',
            started: 'Started',
            result_recorded: 'Result Recorded',
            review_decision: 'Review Decision',
            progress_reported: 'Progress Reported'
          }
        }
      };

      let currentLang = localStorage.getItem('forgeflow-lang') || 'zh';

      function t(key) {
        const keys = key.split('.');
        let value = I18N[currentLang];
        for (const k of keys) {
          value = value[k];
        }
        return value || key;
      }

      function toggleLanguage() {
        currentLang = currentLang === 'zh' ? 'en' : 'zh';
        localStorage.setItem('forgeflow-lang', currentLang);
        updateUILanguage();
        updateDashboard();
      }

      function updateUILanguage() {
        document.getElementById('page-title').textContent = t('pageTitle');
        document.getElementById('tasks-title').textContent = t('tasks');
        document.getElementById('workers-title').textContent = t('workers');
        document.getElementById('prs-title').textContent = t('prs');
        document.getElementById('events-title').textContent = t('events');
        document.getElementById('lang-toggle').textContent = currentLang === 'zh' ? 'English' : '中文';
      }

      function statusLabel(val) { return I18N[currentLang].status[val] || val; }
      function eventTypeLabel(val) { return I18N[currentLang].eventType[val] || val; }

      function formatTime(isoString) {
        if (!isoString) return '';
        const date = new Date(isoString);
        return date.toLocaleTimeString(currentLang === 'zh' ? 'zh-CN' : 'en-US', { hour12: false }) + '.' + String(date.getMilliseconds()).padStart(3, '0');
      }

      function clearNode(node) { node.textContent = ''; }
      function create(tag, classNames, text) {
        const el = document.createElement(tag);
        if (classNames) el.className = classNames;
        if (text) el.textContent = text;
        return el;
      }
      function createBadge(status) {
        const badge = create('span', 'badge ' + (status || '').toLowerCase(), statusLabel(status));
        return badge;
      }
      function createEmpty(message) {
        return create('div', 'empty-state', message);
      }

      function renderStats(stats) {
        const container = document.getElementById('stats-grid');
        clearNode(container);

        const wCard = create('div', 'kpi-card');
        wCard.appendChild(create('div', 'kpi-label', t('activeWorkers')));
        wCard.appendChild(create('div', 'kpi-value', String(stats.workers.total)));
        wCard.appendChild(create('div', 'kpi-details', t('idle') + ': ' + stats.workers.idle + ' / ' + t('busy') + ': ' + stats.workers.busy + ' / ' + t('disabled') + ': ' + stats.workers.disabled));
        
        const tCard = create('div', 'kpi-card');
        tCard.appendChild(create('div', 'kpi-label', t('totalTasks')));
        tCard.appendChild(create('div', 'kpi-value', String(stats.tasks.total)));
        tCard.appendChild(create('div', 'kpi-details', t('review') + ': ' + stats.tasks.review + ' / ' + t('merged') + ': ' + stats.tasks.merged));
        
        container.appendChild(wCard);
        container.appendChild(tCard);
      }

      function renderTasks(tasks) {
        const list = document.getElementById('tasks-list');
        clearNode(list);
        if (!tasks.length) return list.appendChild(createEmpty(t('noActiveTasks')));

        tasks.forEach(task => {
          const row = create('div', 'item-row');
          
          const headerRow = create('div', 'item-row-header');
          const titleGrp = create('div', 'item-title-group');
          titleGrp.appendChild(create('span', 'item-id', task.id));
          titleGrp.appendChild(create('span', '', task.title));
          headerRow.appendChild(titleGrp);
          headerRow.appendChild(createBadge(task.status));
          
          const meta = create('div', 'item-meta');
          meta.appendChild(create('span', '', t('worker') + ': ' + (task.assignedWorkerId || t('unassigned'))));
          meta.appendChild(create('span', '', t('branch') + ': ' + (task.branchName || '-')));
          
          row.appendChild(headerRow);
          row.appendChild(meta);
          list.appendChild(row);
        });
      }

      function renderWorkers(workers) {
        const list = document.getElementById('workers-list');
        clearNode(list);
        if (!workers.length) return list.appendChild(createEmpty(t('noActiveWorkers')));

        workers.forEach(w => {
          const row = create('div', 'item-row');
          
          const headerRow = create('div', 'item-row-header');
          const titleGrp = create('div', 'item-title-group');
          titleGrp.appendChild(create('span', 'item-id', w.id));
          titleGrp.appendChild(create('span', '', 'Pool: ' + w.pool));
          headerRow.appendChild(titleGrp);
          headerRow.appendChild(createBadge(w.status));

          const meta = create('div', 'item-meta');
          meta.appendChild(create('span', '', t('task') + ': ' + (w.currentTaskId || t('none'))));
          meta.appendChild(create('span', '', t('host') + ': ' + (w.hostname || '-')));
          
          const actions = create('div', 'item-meta');
          const isDisabled = w.status === 'disabled';
          const actionBtn = create('button', '', isDisabled ? t('enable') : t('disable'));
          actionBtn.style.cssText = 'padding: 4px 12px; border-radius: 6px; border: 1px solid var(--border-color); background: var(--panel-bg); color: var(--text-primary); cursor: pointer; font-size: 12px;';
          actionBtn.onclick = function() {
            handleWorkerAction(w.id, isDisabled);
          };
          actions.appendChild(actionBtn);
          
          row.appendChild(headerRow);
          row.appendChild(meta);
          row.appendChild(actions);
          list.appendChild(row);
        });
      }

      function renderPRs(prs) {
        const list = document.getElementById('prs-list');
        clearNode(list);
        if (!prs || !prs.length) return list.appendChild(createEmpty(t('noActivePRs')));

        prs.forEach(pr => {
          const row = create('div', 'item-row');
          
          const headerRow = create('div', 'item-row-header');
          const titleGrp = create('div', 'item-title-group');
          titleGrp.appendChild(create('span', 'item-id', pr.taskId));
          if (pr.url) {
            const link = create('a', '', '#' + pr.number);
            link.href = pr.url;
            link.target = '_blank';
            titleGrp.appendChild(link);
          }
          headerRow.appendChild(titleGrp);
          headerRow.appendChild(createBadge(pr.status));

          const meta = create('div', 'item-meta');
          meta.appendChild(create('span', '', t('branch') + ': ' + (pr.headBranch || '-')));
          
          row.appendChild(headerRow);
          row.appendChild(meta);
          list.appendChild(row);
        });
      }

      function renderEvents(events) {
        const feed = document.getElementById('events-feed');
        clearNode(feed);
        if (!events || !events.length) return feed.appendChild(createEmpty(t('noRecentEvents')));

        events.forEach(ev => {
          const card = create('div', 'event-card');
          
          const hdr = create('div', 'event-header');
          hdr.appendChild(create('span', 'event-title', ev.taskId));
          hdr.appendChild(create('span', '', eventTypeLabel(ev.type)));
          
          const payloadStr = typeof ev.payload === 'string' ? ev.payload : JSON.stringify(ev.payload);
          const payload = create('div', 'event-payload', payloadStr);
          
          card.appendChild(hdr);
          card.appendChild(payload);
          feed.appendChild(card);
        });
      }

      async function handleWorkerAction(workerId, isDisabled) {
        if (!isDisabled) {
          const confirmed = confirm(t('confirmDisable') + ' ' + workerId + '?');
          if (!confirmed) return;
        }
        
        try {
          const endpoint = isDisabled ? '/api/workers/' + encodeURIComponent(workerId) + '/enable' : '/api/workers/' + encodeURIComponent(workerId) + '/disable';
          const res = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ at: new Date().toISOString() })
          });
          
          if (res.ok) {
            await updateDashboard();
          } else {
            console.error('Failed to update worker status');
          }
        } catch (err) {
          console.error('Error updating worker status:', err);
        }
      }

      async function updateDashboard() {
        try {
          const res = await fetch('/api/dashboard/snapshot');
          const data = await res.json();
          
          document.getElementById('updated-text').textContent = t('lastUpdate') + ' ' + formatTime(data.updatedAt);
          
          renderStats(data.stats);
          renderTasks(data.tasks);
          renderWorkers(data.workers);
          renderPRs(data.pullRequests || []);
          renderEvents(data.events || []);
        } catch (err) {
          console.error(err);
          document.getElementById('updated-text').textContent = t('connectionError');
        }
      }

      updateUILanguage();
      updateDashboard();
      setInterval(updateDashboard, 4000);
    </script>
  </body>
</html>`;
}
