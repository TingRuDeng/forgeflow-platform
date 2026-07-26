import type { DashboardSnapshot, RuntimeState } from "./runtime-state.js";
import {
  buildDashboardSnapshot,
  isRuntimeStateJsonBackend,
  isRuntimeStatePostgresBackend,
  loadRuntimeStateAsync,
} from "./runtime-state.js";
import {
  compareStructuredProjection,
  readRuntimeAuditEvents,
  readStructuredRuntimeState,
} from "./runtime-state-sqlite.js";
import { readRuntimeAuditEventsFromPostgres } from "./runtime-state-postgres.js";
import type {
  RuntimeAuditEventPage,
  RuntimeAuditEventQueryOptions,
} from "./runtime-events.js";
import { buildRuntimeEventWindowPage } from "./runtime-events.js";

export function loadStructuredRuntimeState(stateDir: string): RuntimeState {
  return readStructuredRuntimeState(stateDir);
}

export function buildStructuredDashboardSnapshot(stateDir: string): DashboardSnapshot {
  return buildDashboardSnapshot(loadStructuredRuntimeState(stateDir));
}

export function readStructuredProjectionHealth(stateDir: string) {
  return compareStructuredProjection(stateDir);
}

function countRuntimeStateRows(state: RuntimeState): Record<string, number> {
  return {
    workers: state.workers.length,
    tasks: state.tasks.length,
    taskAttempts: (state.taskAttempts ?? []).length,
    artifactBundles: (state.artifactBundles ?? []).length,
    assignments: state.assignments.length,
    reviews: state.reviews.length,
    pullRequests: state.pullRequests.length,
    dispatches: state.dispatches.length,
    events: state.events.length,
    leases: (state.leases ?? []).length,
  };
}

export async function loadStructuredRuntimeStateAsync(stateDir: string): Promise<RuntimeState> {
  if (isRuntimeStatePostgresBackend()) {
    return loadRuntimeStateAsync(stateDir);
  }
  return loadStructuredRuntimeState(stateDir);
}

export async function buildStructuredDashboardSnapshotAsync(stateDir: string): Promise<DashboardSnapshot> {
  return buildDashboardSnapshot(await loadStructuredRuntimeStateAsync(stateDir));
}

export async function readRuntimeAuditEventPageAsync(
  stateDir: string,
  options: RuntimeAuditEventQueryOptions = {},
): Promise<RuntimeAuditEventPage> {
  if (isRuntimeStatePostgresBackend()) {
    return readRuntimeAuditEventsFromPostgres(stateDir, options);
  }
  if (isRuntimeStateJsonBackend()) {
    return buildRuntimeEventWindowPage((await loadRuntimeStateAsync(stateDir)).events, options);
  }
  return readRuntimeAuditEvents(stateDir, options);
}

export async function readStructuredProjectionHealthAsync(stateDir: string): Promise<{
  matches: boolean;
  expected: Record<string, number>;
  actual: Record<string, number>;
}> {
  if (!isRuntimeStatePostgresBackend()) {
    return readStructuredProjectionHealth(stateDir);
  }
  const counts = countRuntimeStateRows(await loadRuntimeStateAsync(stateDir));
  return {
    matches: true,
    expected: counts,
    actual: counts,
  };
}
