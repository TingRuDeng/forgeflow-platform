const RUNTIME_STATE_STORAGE_REVISION = Symbol.for(
  "forgeflow.runtime-state.storage-revision",
);

export function attachRuntimeStateStorageRevision<T extends object>(
  state: T,
  revision: number | null,
): T {
  Object.defineProperty(state, RUNTIME_STATE_STORAGE_REVISION, {
    configurable: true,
    enumerable: true,
    writable: true,
    value: revision,
  });
  return state;
}

export function readRuntimeStateStorageRevision(
  state: object,
): number | null | undefined {
  const value = (state as Record<PropertyKey, unknown>)[RUNTIME_STATE_STORAGE_REVISION];
  if (value === null) {
    return null;
  }
  return Number.isSafeInteger(value) && Number(value) >= 0
    ? Number(value)
    : undefined;
}
