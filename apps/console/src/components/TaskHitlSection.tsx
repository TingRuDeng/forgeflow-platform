import React from 'react';
import { useTranslation } from '@/lib/i18n';

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

type ResumeFieldType = 'string' | 'number' | 'boolean';
type ResumeFieldValue = string | boolean;

interface ResumePayloadFieldSchema {
  type?: ResumeFieldType;
  title?: string;
  description?: string;
  enum?: string[];
  default?: unknown;
}

interface ResumePayloadSchema {
  properties?: Record<string, ResumePayloadFieldSchema>;
  required?: string[];
}

interface SchemaField {
  name: string;
  label: string;
  type: ResumeFieldType;
  options?: string[];
  required: boolean;
  description?: string;
  defaultValue?: unknown;
}

function parseResumePayload(value: string): Record<string, unknown> {
  const parsed = JSON.parse(value || '{}');
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('resume payload must be a JSON object');
  }
  return parsed as Record<string, unknown>;
}

function buildSchemaFields(schema?: ResumePayloadSchema): SchemaField[] {
  const properties = schema?.properties ?? {};
  const required = new Set(schema?.required ?? []);
  return Object.entries(properties).map(([name, field]) => ({
    name,
    label: field.title || name,
    type: field.type || 'string',
    options: field.enum,
    required: required.has(name),
    description: field.description,
    defaultValue: field.default,
  }));
}

function initialStructuredValues(fields: SchemaField[]): Record<string, ResumeFieldValue> {
  return Object.fromEntries(fields.map((field) => [field.name, initialFieldValue(field)]));
}

function initialFieldValue(field: SchemaField): ResumeFieldValue {
  if (field.type === 'boolean') {
    return typeof field.defaultValue === 'boolean' ? field.defaultValue : false;
  }
  if (typeof field.defaultValue === 'string') {
    return field.defaultValue;
  }
  return field.options?.[0] ?? '';
}

function buildStructuredPayload(fields: SchemaField[], values: Record<string, ResumeFieldValue>) {
  return fields.reduce<Record<string, unknown>>((payload, field) => {
    const value = coerceFieldValue(field, values[field.name]);
    if (value !== undefined) payload[field.name] = value;
    return payload;
  }, {});
}

function coerceFieldValue(field: SchemaField, value: ResumeFieldValue | undefined): unknown {
  if (field.type === 'boolean') {
    return Boolean(value);
  }
  const text = String(value ?? '').trim();
  if (!text && field.required) throw new Error('required field is empty');
  if (!text) return undefined;
  if (field.type !== 'number') return text;
  const parsed = Number(text);
  if (!Number.isFinite(parsed)) throw new Error('number field is invalid');
  return parsed;
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
  return (
    <label className="block text-xs font-semibold text-white/70">
      {label}
      <input
        aria-label={field.label}
        type={field.type === 'number' ? 'number' : 'text'}
        value={String(value ?? '')}
        onChange={(event) => onChange(field.name, event.target.value)}
        className="mt-1 w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-xs text-white outline-none focus:border-cyan-400/60"
      />
    </label>
  );
};

export const TaskHitlSection: React.FC<TaskHitlSectionProps> = ({ task, resumingTaskId, onResume }) => {
  const { t } = useTranslation();
  const [payloadText, setPayloadText] = React.useState('{\n  "decision": ""\n}');
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
      onResume?.(task, payload);
    } catch {
      alert(t('invalidResumePayload'));
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
