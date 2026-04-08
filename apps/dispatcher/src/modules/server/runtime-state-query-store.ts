import type { DashboardSnapshot, RuntimeState } from "./runtime-state.js";
import { buildDashboardSnapshot } from "./runtime-state.js";
import {
  compareStructuredProjection,
  readStructuredRuntimeState,
} from "./runtime-state-sqlite.js";

export function loadStructuredRuntimeState(stateDir: string): RuntimeState {
  return readStructuredRuntimeState(stateDir);
}

export function buildStructuredDashboardSnapshot(stateDir: string): DashboardSnapshot {
  return buildDashboardSnapshot(loadStructuredRuntimeState(stateDir));
}

export function readStructuredProjectionHealth(stateDir: string) {
  return compareStructuredProjection(stateDir);
}
