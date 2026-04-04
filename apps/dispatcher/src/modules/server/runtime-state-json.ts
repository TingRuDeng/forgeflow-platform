import fs from "node:fs";
import path from "node:path";

import type { RuntimeState } from "./runtime-state.js";
import { formatLocalTimestamp } from "../time.js";

function nowIso(): string {
  return formatLocalTimestamp();
}

function stateFilePath(stateDir: string): string {
  return path.join(stateDir, "runtime-state.json");
}

export function createEmptyRuntimeState(): RuntimeState {
  return {
    version: 1,
    updatedAt: nowIso(),
    sequence: 0,
    workers: [],
    tasks: [],
    events: [],
    assignments: [],
    reviews: [],
    pullRequests: [],
    dispatches: [],
  };
}

export function loadRuntimeState(stateDir: string): RuntimeState {
  const filePath = stateFilePath(stateDir);
  if (!fs.existsSync(filePath)) {
    return createEmptyRuntimeState();
  }

  const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
  return {
    ...createEmptyRuntimeState(),
    ...parsed,
  };
}

export function saveRuntimeState(stateDir: string, state: RuntimeState): void {
  fs.mkdirSync(stateDir, { recursive: true });
  const filePath = stateFilePath(stateDir);
  const tmpFilePath = `${filePath}.tmp`;
  const content = `${JSON.stringify({
    ...state,
    updatedAt: nowIso(),
  }, null, 2)}\n`;
  fs.writeFileSync(tmpFilePath, content);
  fs.renameSync(tmpFilePath, filePath);
}

export const jsonStore = {
  load: loadRuntimeState,
  save: saveRuntimeState,
  createEmpty: createEmptyRuntimeState,
};
