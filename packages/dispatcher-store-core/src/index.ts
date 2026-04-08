export type ShadowMode = "disabled" | "shadow-write" | "shadow-read" | "primary";

export interface SqlProjectionTable {
  name: string;
  truncateSql: string;
  insertSql: string;
  rows: unknown[][];
}

export interface SqlProjectionSnapshot {
  tables: SqlProjectionTable[];
  counts: Record<string, number>;
}

export function normalizeShadowMode(value: string | undefined | null): ShadowMode {
  switch ((value ?? "").trim()) {
    case "shadow-write":
    case "shadow-read":
    case "primary":
      return value as ShadowMode;
    default:
      return "disabled";
  }
}

export function projectionTableCount(snapshot: SqlProjectionSnapshot, tableName: string): number {
  return snapshot.counts[tableName] ?? 0;
}
