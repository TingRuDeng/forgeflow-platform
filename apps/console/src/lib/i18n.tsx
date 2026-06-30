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
    repo: '仓库',
    pool: '池',
    none: '无',
    yes: '是',
    no: '否',
    enable: '启用',
    disable: '禁用',
    cancelTask: '作废任务',
    cancellingTask: '作废中',
    confirmCancelTask: '确定要作废任务',
    cancelReasonPrompt: '请输入作废原因',
    cancelReasonDefault: 'Cancelled from console UI',
    taskActionFailed: '任务操作失败',
    workerActionFailed: '工作节点操作失败',
    updating: '更新中',
    connecting: '连接中...',
    lastUpdate: '最后更新',
    connectionError: '连接错误',
    confirmDisable: '确定要禁用工作节点',
    previous: '上一页',
    next: '下一页',
    page: '页',
    taskDetails: '任务详情',
    selectTaskHint: '选择左侧任务以查看失败原因、审查状态、lineage 与最近事件。',
    lineage: '任务血缘',
    parentTask: '父任务',
    continueFrom: '继续自',
    followUpOf: '跟进自',
    latestReview: '最新审查',
    reviewActions: '审查操作',
    mergeDecision: '合并',
    reworkDecision: '返工',
    blockDecision: '阻塞',
    reviewActionFailed: '审查操作失败',
    latestFailure: '最新失败',
    failureType: '失败类型',
    failureSummary: '失败摘要',
    latestProgress: '最新进度',
    reasonCode: '原因码',
    canRedrive: '可重驱动',
    redriveStrategy: '重驱策略',
    traceId: '追踪 ID',
    failureCode: '失败码',
    queueDepth: '排队 / 审查',
    planned: '待依赖',
    assignmentLag: '分配延迟',
    retryRate: '重试率',
    deliveryFailures: '交付失败',
    cleanupFailures: '清理失败',
    shadowFailures: 'shadow 失败',
    notes: '备注',
    mustFix: '必须修复',
    actor: '操作者',
    decision: '决策',
    updatedAtLabel: '更新时间',
    recentTaskEvents: '最近任务事件',
    runtimeEvents: '运行时事件',
    attemptTimeline: '执行尝试时间线',
    attemptNo: '尝试序号',
    startedAt: '开始时间',
    endedAt: '结束时间',
    artifactBundle: '产物包',
    artifactSummary: '产物摘要',
    artifactRefs: '引用',
    artifactRetainedContent: '正文',
    summary: '摘要',
    changedFiles: '变更文件',
    riskNotes: '风险备注',
    nextActions: '后续动作',
    noAttempts: '暂无执行尝试',
    noArtifacts: '暂无产物包',
    noArtifactRefs: '暂无产物引用',
    noRetainedContent: '暂无保留正文',
    prNumber: 'PR 编号',
    url: '链接',
    statusLabel: '状态',
    status: {
      idle: '空闲',
      busy: '忙碌',
      assigned: '已分配',
      in_progress: '进行中',
      review: '待审查',
      merged: '已合并',
      failed: '失败',
      blocked: '阻塞',
      cancelled: '已作废',
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
    repo: 'Repo',
    pool: 'Pool',
    none: 'None',
    yes: 'Yes',
    no: 'No',
    enable: 'Enable',
    disable: 'Disable',
    cancelTask: 'Cancel Task',
    cancellingTask: 'Cancelling',
    confirmCancelTask: 'Cancel task',
    cancelReasonPrompt: 'Provide a cancellation reason',
    cancelReasonDefault: 'Cancelled from console UI',
    taskActionFailed: 'Task action failed',
    workerActionFailed: 'Worker action failed',
    updating: 'Updating',
    connecting: 'Connecting...',
    lastUpdate: 'Last update',
    connectionError: 'Connection error',
    confirmDisable: 'Are you sure you want to disable worker',
    previous: 'Previous',
    next: 'Next',
    page: 'Page',
    taskDetails: 'Task Details',
    selectTaskHint: 'Select a task to inspect failure, review, lineage, and recent events.',
    lineage: 'Lineage',
    parentTask: 'Parent',
    continueFrom: 'Continue From',
    followUpOf: 'Follow-up Of',
    latestReview: 'Latest Review',
    reviewActions: 'Review Actions',
    mergeDecision: 'Merge',
    reworkDecision: 'Rework',
    blockDecision: 'Block',
    reviewActionFailed: 'Review action failed',
    latestFailure: 'Latest Failure',
    failureType: 'Failure Type',
    failureSummary: 'Failure Summary',
    latestProgress: 'Latest Progress',
    reasonCode: 'Reason Code',
    canRedrive: 'Can Redrive',
    redriveStrategy: 'Redrive Strategy',
    traceId: 'Trace ID',
    failureCode: 'Failure Code',
    queueDepth: 'Queue / Review',
    planned: 'Planned',
    assignmentLag: 'Assignment Lag',
    retryRate: 'Retry Rate',
    deliveryFailures: 'Delivery Failures',
    cleanupFailures: 'Cleanup Failures',
    shadowFailures: 'Shadow Failures',
    notes: 'Notes',
    mustFix: 'Must Fix',
    actor: 'Actor',
    decision: 'Decision',
    updatedAtLabel: 'Updated',
    recentTaskEvents: 'Recent Task Events',
    runtimeEvents: 'Runtime Events',
    attemptTimeline: 'Attempt Timeline',
    attemptNo: 'Attempt No',
    startedAt: 'Started At',
    endedAt: 'Ended At',
    artifactBundle: 'Artifact Bundle',
    artifactSummary: 'Artifact Summary',
    artifactRefs: 'Refs',
    artifactRetainedContent: 'Retained',
    summary: 'Summary',
    changedFiles: 'Changed Files',
    riskNotes: 'Risk Notes',
    nextActions: 'Next Actions',
    noAttempts: 'No attempts',
    noArtifacts: 'No artifacts',
    noArtifactRefs: 'No artifact refs',
    noRetainedContent: 'No retained content',
    prNumber: 'PR Number',
    url: 'URL',
    statusLabel: 'Status',
    status: {
      idle: 'Idle',
      busy: 'Busy',
      assigned: 'Assigned',
      in_progress: 'In Progress',
      review: 'Review',
      merged: 'Merged',
      failed: 'Failed',
      blocked: 'Blocked',
      cancelled: 'Cancelled',
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
  t: (key: string) => string;
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
    let value: unknown = I18N[lang];
    for (const k of keys) {
      if (value && typeof value === 'object' && k in value) {
        value = (value as Record<string, unknown>)[k];
      } else {
        return key;
      }
    }
    return (value as string) || key;
  };

  return (
    <LanguageContext.Provider value={{ lang, setLang, t }}>
      {children}
    </LanguageContext.Provider>
  );
};

// eslint-disable-next-line react-refresh/only-export-components
export const useTranslation = () => {
  const context = useContext(LanguageContext);
  if (!context) throw new Error('useTranslation must be used within LanguageProvider');
  return context;
};
