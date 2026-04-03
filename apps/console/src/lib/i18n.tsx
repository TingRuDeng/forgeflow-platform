import React, { createContext, useContext, useState, useEffect } from 'react';

type Language = 'zh' | 'en';

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

interface LanguageContextType {
  lang: Language;
  setLang: (lang: Language) => void;
  t: (key: string) => any;
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

export const LanguageProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [lang, setLang] = useState<Language>(() => {
    return (localStorage.getItem('forgeflow-lang') as Language) || 'zh';
  });

  useEffect(() => {
    localStorage.setItem('forgeflow-lang', lang);
  }, [lang]);

  const t = (key: string) => {
    const keys = key.split('.');
    let value: any = I18N[lang];
    for (const k of keys) {
      if (value && typeof value === 'object' && k in value) {
        value = value[k];
      } else {
        return key;
      }
    }
    return value || key;
  };

  return (
    <LanguageContext.Provider value={{ lang, setLang, t }}>
      {children}
    </LanguageContext.Provider>
  );
};

export const useTranslation = () => {
  const context = useContext(LanguageContext);
  if (!context) throw new Error('useTranslation must be used within LanguageProvider');
  return context;
};
