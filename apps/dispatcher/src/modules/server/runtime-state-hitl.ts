import type { ResumePayloadFieldSchema, ResumePayloadSchema } from "./runtime-state.js";

function fieldLabel(name: string, field: ResumePayloadFieldSchema): string {
  return field.title?.trim() || name;
}

function isMissingRequiredValue(value: unknown): boolean {
  return value === undefined
    || value === null
    || (typeof value === "string" && value.trim() === "")
    || (Array.isArray(value) && value.length === 0);
}

function assertEnumValue(name: string, field: ResumePayloadFieldSchema, value: string): void {
  if (field.enum?.length && !field.enum.includes(value)) {
    throw new Error(`resumePayload.${name} must be one of: ${field.enum.join(", ")}`);
  }
}

function validateStringField(name: string, field: ResumePayloadFieldSchema, value: unknown): void {
  if (typeof value !== "string") {
    throw new Error(`resumePayload.${name} must be a string`);
  }
  assertEnumValue(name, field, value);
}

function validateNumberField(name: string, field: ResumePayloadFieldSchema, value: unknown, integer: boolean): void {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`resumePayload.${name} must be a number`);
  }
  if (integer && !Number.isInteger(value)) {
    throw new Error(`resumePayload.${name} must be an integer`);
  }
  if (field.minimum !== undefined && value < field.minimum) {
    throw new Error(`resumePayload.${name} must be >= ${field.minimum}`);
  }
  if (field.maximum !== undefined && value > field.maximum) {
    throw new Error(`resumePayload.${name} must be <= ${field.maximum}`);
  }
}

function validateArrayField(name: string, field: ResumePayloadFieldSchema, value: unknown): void {
  if (!Array.isArray(value)) {
    throw new Error(`resumePayload.${name} must be an array`);
  }
  if (field.minItems !== undefined && value.length < field.minItems) {
    throw new Error(`resumePayload.${name} needs at least ${field.minItems} item(s)`);
  }
  if (field.maxItems !== undefined && value.length > field.maxItems) {
    throw new Error(`resumePayload.${name} allows at most ${field.maxItems} item(s)`);
  }
  if (field.items?.type === "string") {
    const invalidType = value.find((item) => typeof item !== "string");
    if (invalidType !== undefined) {
      throw new Error(`resumePayload.${name} items must be strings`);
    }
  }
  const allowedItems = field.items?.enum;
  if (allowedItems?.length) {
    const invalid = value.find((item) => typeof item !== "string" || !allowedItems.includes(item));
    if (invalid !== undefined) {
      throw new Error(`resumePayload.${name} contains invalid value ${String(invalid)}`);
    }
  }
}

function validateOptionalField(name: string, field: ResumePayloadFieldSchema, value: unknown): void {
  if (value === undefined || value === null || value === "") {
    return;
  }
  const type = field.type ?? "string";
  if (type === "boolean") {
    if (typeof value !== "boolean") {
      throw new Error(`resumePayload.${name} must be a boolean`);
    }
    return;
  }
  if (type === "number" || type === "integer") {
    validateNumberField(name, field, value, type === "integer");
    return;
  }
  if (type === "array") {
    validateArrayField(name, field, value);
    return;
  }
  validateStringField(name, field, value);
}

export function validateResumePayloadAgainstSchema(
  schema: ResumePayloadSchema | undefined,
  payload: Record<string, unknown> | null | undefined,
): void {
  if (!schema?.properties) {
    return;
  }
  const source = payload ?? {};
  const required = new Set(schema.required ?? []);
  for (const name of required) {
    if (isMissingRequiredValue(source[name])) {
      const field = schema.properties[name] ?? {};
      throw new Error(`resumePayload.${name} (${fieldLabel(name, field)}) is required`);
    }
  }
  for (const [name, field] of Object.entries(schema.properties)) {
    validateOptionalField(name, field, source[name]);
  }
}
