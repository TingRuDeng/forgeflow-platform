import { Ban, RotateCcw } from 'lucide-react';
import { useTranslation } from '@/lib/i18n';

export interface ReviewBulkFormValue {
  reasonCode: string;
  mustFixText: string;
  canRedrive: boolean;
  redriveStrategy: string;
}

export function ReviewBulkForm(props: {
  value: ReviewBulkFormValue;
  canSubmit: boolean;
  onChange: (value: ReviewBulkFormValue) => void;
  onSubmit: (decision: 'rework' | 'block') => void;
}) {
  return (
    <div className="grid grid-cols-1 gap-3 rounded-lg border border-white/10 bg-black/15 p-3">
      <ReviewBulkFields value={props.value} onChange={props.onChange} />
      <ReviewBulkActions canSubmit={props.canSubmit} onSubmit={props.onSubmit} />
    </div>
  );
}

function ReviewBulkFields(props: {
  value: ReviewBulkFormValue;
  onChange: (value: ReviewBulkFormValue) => void;
}) {
  const { t } = useTranslation();
  const update = (patch: Partial<ReviewBulkFormValue>) => props.onChange({ ...props.value, ...patch });
  return (
    <>
      <label className="text-xs font-semibold text-white/70">
        {t('reasonCode')}
        <input
          value={props.value.reasonCode}
          onChange={(event) => update({ reasonCode: event.target.value })}
          className="mt-1 w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm font-mono text-white outline-none focus:border-cyan-400/60"
        />
      </label>
      <label className="text-xs font-semibold text-white/70">
        {t('mustFix')}
        <textarea
          value={props.value.mustFixText}
          onChange={(event) => update({ mustFixText: event.target.value })}
          rows={3}
          className="mt-1 w-full resize-y rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm text-white outline-none focus:border-cyan-400/60"
        />
      </label>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <label className="flex items-center gap-2 text-xs font-semibold text-white/70">
          <input type="checkbox" checked={props.value.canRedrive} onChange={(event) => update({ canRedrive: event.target.checked })} />
          {t('canRedrive')}
        </label>
        <ReviewStrategySelect value={props.value.redriveStrategy} onChange={(redriveStrategy) => update({ redriveStrategy })} />
      </div>
    </>
  );
}

function ReviewStrategySelect(props: { value: string; onChange: (value: string) => void }) {
  const { t } = useTranslation();
  return (
    <label className="text-xs font-semibold text-white/70">
      {t('redriveStrategy')}
      <select
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
        className="mt-1 w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm font-mono text-white outline-none focus:border-cyan-400/60"
      >
        <option value="same_worker_continue">same_worker_continue</option>
        <option value="new_worker_reassign">new_worker_reassign</option>
        <option value="manual_follow_up">manual_follow_up</option>
      </select>
    </label>
  );
}

function ReviewBulkActions(props: {
  canSubmit: boolean;
  onSubmit: (decision: 'rework' | 'block') => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="grid grid-cols-2 gap-2">
      <button type="button" disabled={!props.canSubmit} onClick={() => props.onSubmit('rework')} className="inline-flex items-center justify-center gap-2 rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-xs font-semibold text-amber-100 hover:bg-amber-400/20 disabled:opacity-50">
        <RotateCcw size={14} aria-hidden="true" />
        {t('bulkReworkDecision')}
      </button>
      <button type="button" disabled={!props.canSubmit} onClick={() => props.onSubmit('block')} className="inline-flex items-center justify-center gap-2 rounded-lg border border-rose-400/30 bg-rose-400/10 px-3 py-2 text-xs font-semibold text-rose-100 hover:bg-rose-400/20 disabled:opacity-50">
        <Ban size={14} aria-hidden="true" />
        {t('bulkBlockDecision')}
      </button>
    </div>
  );
}
