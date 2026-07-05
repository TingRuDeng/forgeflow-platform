import type { AutomationGatewayResponse } from "./gateway-types.js";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function splitQueryList(value: unknown): string[] {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function readOptionalString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export function ok(data: unknown, status = 200): AutomationGatewayResponse {
  return { status, json: { success: true, code: "OK", data } };
}
