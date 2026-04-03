import type { RuntimeState } from "./runtime-state.js";

export interface RuntimeStateStore {
  load(stateDir: string): RuntimeState;
  save(stateDir: string, state: RuntimeState): void;
  createEmpty(): RuntimeState;
}