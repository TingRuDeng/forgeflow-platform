export type ResumeFieldType = 'string' | 'number' | 'integer' | 'boolean' | 'array';
export type ResumeFieldValue = string | boolean;

interface ResumePayloadArrayItemsSchema {
  type?: 'string';
  enum?: string[];
}

export interface ResumePayloadFieldSchema {
  type?: ResumeFieldType;
  title?: string;
  description?: string;
  enum?: string[];
  default?: unknown;
  format?: 'text' | 'textarea';
  placeholder?: string;
  minimum?: number;
  maximum?: number;
  minItems?: number;
  maxItems?: number;
  items?: ResumePayloadArrayItemsSchema;
}

export interface ResumePayloadSchema {
  properties?: Record<string, ResumePayloadFieldSchema>;
  required?: string[];
}

export interface SchemaField {
  name: string;
  label: string;
  type: ResumeFieldType;
  options?: string[];
  required: boolean;
  description?: string;
  defaultValue?: unknown;
  format?: 'text' | 'textarea';
  placeholder?: string;
  minimum?: number;
  maximum?: number;
  minItems?: number;
  maxItems?: number;
  itemOptions?: string[];
}

export function parseResumePayload(value: string): Record<string, unknown> {
  const parsed = JSON.parse(value || '{}');
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('resume payload must be a JSON object');
  }
  return parsed as Record<string, unknown>;
}

export function buildSchemaFields(schema?: ResumePayloadSchema): SchemaField[] {
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
    format: field.format,
    placeholder: field.placeholder,
    minimum: field.minimum,
    maximum: field.maximum,
    minItems: field.minItems,
    maxItems: field.maxItems,
    itemOptions: field.items?.enum,
  }));
}

export function initialStructuredValues(fields: SchemaField[]): Record<string, ResumeFieldValue> {
  return Object.fromEntries(fields.map((field) => [field.name, initialFieldValue(field)]));
}

export function buildStructuredPayload(fields: SchemaField[], values: Record<string, ResumeFieldValue>) {
  return fields.reduce<Record<string, unknown>>((payload, field) => {
    const value = coerceFieldValue(field, values[field.name]);
    if (value !== undefined) payload[field.name] = value;
    return payload;
  }, {});
}

function initialFieldValue(field: SchemaField): ResumeFieldValue {
  if (field.type === 'boolean') {
    return typeof field.defaultValue === 'boolean' ? field.defaultValue : false;
  }
  if (Array.isArray(field.defaultValue)) {
    return field.defaultValue.filter((item) => typeof item === 'string').join('\n');
  }
  if (typeof field.defaultValue === 'number') {
    return String(field.defaultValue);
  }
  if (typeof field.defaultValue === 'string') {
    return field.defaultValue;
  }
  return field.options?.[0] ?? '';
}

function coerceFieldValue(field: SchemaField, value: ResumeFieldValue | undefined): unknown {
  if (field.type === 'boolean') {
    return Boolean(value);
  }
  const text = String(value ?? '').trim();
  if (!text && field.required) throw new Error(`${field.label} is required`);
  if (!text) return undefined;
  if (field.type === 'array') return coerceArrayValue(field, text);
  if (field.type === 'number' || field.type === 'integer') return coerceNumberValue(field, text);
  return text;
}

function coerceNumberValue(field: SchemaField, text: string): number {
  const parsed = Number(text);
  if (!Number.isFinite(parsed)) throw new Error(`${field.label} must be a number`);
  if (field.type === 'integer' && !Number.isInteger(parsed)) throw new Error(`${field.label} must be an integer`);
  if (field.minimum !== undefined && parsed < field.minimum) throw new Error(`${field.label} must be >= ${field.minimum}`);
  if (field.maximum !== undefined && parsed > field.maximum) throw new Error(`${field.label} must be <= ${field.maximum}`);
  return parsed;
}

function coerceArrayValue(field: SchemaField, text: string): string[] {
  const values = text.split(/\r?\n|,/).map((item) => item.trim()).filter(Boolean);
  if (field.required && values.length === 0) throw new Error(`${field.label} is required`);
  if (field.minItems !== undefined && values.length < field.minItems) throw new Error(`${field.label} needs at least ${field.minItems} item(s)`);
  if (field.maxItems !== undefined && values.length > field.maxItems) throw new Error(`${field.label} allows at most ${field.maxItems} item(s)`);
  if (field.itemOptions?.length) {
    const invalid = values.find((item) => !field.itemOptions?.includes(item));
    if (invalid) throw new Error(`${field.label} contains invalid value ${invalid}`);
  }
  return values;
}
