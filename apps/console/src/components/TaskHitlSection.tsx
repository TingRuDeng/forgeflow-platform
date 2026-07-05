import React from 'react';
import { useTranslation } from '@/lib/i18n';
import {
  buildSchemaFields,
  buildStructuredPayload,
  initialStructuredValues,
  parseResumePayload,
} from './taskHitlSchema';
import type {
  ResumeFieldValue,
  ResumePayloadSchema,
  SchemaField,
} from './taskHitlSchema';

interface WaitingForInput {
  requestedBy?: string;
  reason?: string;
  requestedAt?: string;
  resumePayloadSchema?: ResumePayloadSchema;
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

const StructuredResumePayload: React.FC<{
  fields: SchemaField[];
  values: Record<string, ResumeFieldValue>;
  onChange: (name: string, value: ResumeFieldValue) => void;
}> = ({ fields, values, onChange }) => (
  <div className="space-y-2">
    {fields.map((field) => (
      <SchemaFieldInput key={field.name} field={field} value={values[field.name]} onChange={onChange} />
    ))}
  </div>
);

const SchemaFieldInput: React.FC<{
  field: SchemaField;
  value: ResumeFieldValue | undefined;
  onChange: (name: string, value: ResumeFieldValue) => void;
}> = ({ field, value, onChange }) => {
  const label = `${field.label}${field.required ? ' *' : ''}`;
  if (field.type === 'boolean') {
    return (
      <label className="flex items-center gap-2 text-xs font-semibold text-white/70">
        <input
          aria-label={field.label}
          type="checkbox"
          checked={Boolean(value)}
          onChange={(event) => onChange(field.name, event.target.checked)}
        />
        {label}
      </label>
    );
  }
  if (field.options?.length) {
    return (
      <label className="block text-xs font-semibold text-white/70">
        {label}
        <select
          aria-label={field.label}
          value={String(value ?? '')}
          onChange={(event) => onChange(field.name, event.target.value)}
          className="mt-1 w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-xs text-white outline-none focus:border-cyan-400/60"
        >
          {field.options.map((option) => <option key={option} value={option}>{option}</option>)}
        </select>
      </label>
    );
  }
  if (field.type === 'array' || field.format === 'textarea') {
    return (
      <label className="block text-xs font-semibold text-white/70">
        {label}
        <textarea
          aria-label={field.label}
          value={String(value ?? '')}
          placeholder={field.placeholder}
          rows={field.type === 'array' ? 3 : 4}
          onChange={(event) => onChange(field.name, event.target.value)}
          className="mt-1 w-full resize-y rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-xs text-white outline-none focus:border-cyan-400/60"
        />
        {field.description && <span className="mt-1 block text-[11px] font-normal text-white/45">{field.description}</span>}
      </label>
    );
  }
  return (
    <label className="block text-xs font-semibold text-white/70">
      {label}
      <input
        aria-label={field.label}
        type={field.type === 'number' || field.type === 'integer' ? 'number' : 'text'}
        value={String(value ?? '')}
        placeholder={field.placeholder}
        min={field.minimum}
        max={field.maximum}
        step={field.type === 'integer' ? 1 : undefined}
        onChange={(event) => onChange(field.name, event.target.value)}
        className="mt-1 w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-xs text-white outline-none focus:border-cyan-400/60"
      />
      {field.description && <span className="mt-1 block text-[11px] font-normal text-white/45">{field.description}</span>}
    </label>
  );
};

export const TaskHitlSection: React.FC<TaskHitlSectionProps> = ({ task, resumingTaskId, onResume }) => {
  const { t } = useTranslation();
  const [payloadText, setPayloadText] = React.useState('{\n  "decision": ""\n}');
  const [validationError, setValidationError] = React.useState<string | null>(null);
  const schemaFields = React.useMemo(
    () => buildSchemaFields(task.waitingForInput?.resumePayloadSchema),
    [task.waitingForInput?.resumePayloadSchema]
  );
  const [fieldValues, setFieldValues] = React.useState(() => initialStructuredValues(schemaFields));
  const waiting = task.status === 'waiting_for_input' ? task.waitingForInput : null;

  React.useEffect(() => {
    setFieldValues(initialStructuredValues(schemaFields));
  }, [schemaFields, task.id]);

  if (!waiting) {
    return null;
  }

  const submit = () => {
    try {
      const payload = schemaFields.length
        ? buildStructuredPayload(schemaFields, fieldValues)
        : parseResumePayload(payloadText);
      setValidationError(null);
      onResume?.(task, payload);
    } catch (error) {
      const message = error instanceof Error ? error.message : t('invalidResumePayload');
      setValidationError(message);
    }
  };

  const updateField = (name: string, value: ResumeFieldValue) => {
    setFieldValues((current) => ({ ...current, [name]: value }));
  };

  return (
    <section className="glass-card rounded-xl p-4 space-y-3">
      <div className="text-[11px] uppercase tracking-wide text-white/45">{t('hitlInput')}</div>
      <div className="grid grid-cols-1 gap-1 text-sm text-white/80">
        <div>{t('requestedBy')}: <span className="font-mono break-all">{waiting.requestedBy || '--'}</span></div>
        <div>{t('reason')}: <span className="break-all">{waiting.reason || '--'}</span></div>
        <div>{t('requestedAt')}: <span className="font-mono break-all">{waiting.requestedAt || '--'}</span></div>
      </div>
      {schemaFields.length ? (
        <StructuredResumePayload fields={schemaFields} values={fieldValues} onChange={updateField} />
      ) : (
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
      )}
      {validationError && (
        <div className="rounded-lg border border-amber-400/25 bg-amber-400/10 px-3 py-2 text-xs text-amber-100">
          {t('resumePayloadValidationFailed')}: {validationError}
        </div>
      )}
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
