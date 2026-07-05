import React from 'react';
import { useTranslation } from '@/lib/i18n';

interface WaitingForInput {
  requestedBy?: string;
  reason?: string;
  requestedAt?: string;
}

interface Task {
  id: string;
  status: string;
  waitingForInput?: WaitingForInput | null;
}

interface TaskHitlSectionProps {
  task: Task;
  resumingTaskId?: string | null;
  onResume?: (task: Task, resumePayload: Record<string, unknown>) => void;
}

function parseResumePayload(value: string): Record<string, unknown> {
  const parsed = JSON.parse(value || '{}');
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('resume payload must be a JSON object');
  }
  return parsed as Record<string, unknown>;
}

export const TaskHitlSection: React.FC<TaskHitlSectionProps> = ({ task, resumingTaskId, onResume }) => {
  const { t } = useTranslation();
  const [payloadText, setPayloadText] = React.useState('{\n  "decision": ""\n}');
  const waiting = task.status === 'waiting_for_input' ? task.waitingForInput : null;
  if (!waiting) {
    return null;
  }

  const submit = () => {
    try {
      onResume?.(task, parseResumePayload(payloadText));
    } catch {
      alert(t('invalidResumePayload'));
    }
  };

  return (
    <section className="glass-card rounded-xl p-4 space-y-3">
      <div className="text-[11px] uppercase tracking-wide text-white/45">{t('hitlInput')}</div>
      <div className="grid grid-cols-1 gap-1 text-sm text-white/80">
        <div>{t('requestedBy')}: <span className="font-mono break-all">{waiting.requestedBy || '--'}</span></div>
        <div>{t('reason')}: <span className="break-all">{waiting.reason || '--'}</span></div>
        <div>{t('requestedAt')}: <span className="font-mono break-all">{waiting.requestedAt || '--'}</span></div>
      </div>
      <label className="block text-xs font-semibold text-white/70">
        {t('resumePayload')}
        <textarea
          aria-label={t('resumePayload')}
          value={payloadText}
          onChange={(event) => setPayloadText(event.target.value)}
          rows={5}
          className="mt-1 w-full resize-y rounded-lg border border-white/10 bg-black/20 px-3 py-2 font-mono text-xs text-white outline-none focus:border-cyan-400/60"
        />
      </label>
      <button
        type="button"
        disabled={!onResume || resumingTaskId === task.id}
        onClick={submit}
        className="inline-flex w-full items-center justify-center rounded-lg border border-cyan-400/30 bg-cyan-400/10 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-cyan-100 hover:bg-cyan-400/20 disabled:opacity-50"
      >
        {resumingTaskId === task.id ? t('resumingTask') : t('resumeTask')}
      </button>
    </section>
  );
};
