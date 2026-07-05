import {
  createPgClient,
  loadPrimaryRuntimeStateSnapshot,
  savePrimaryRuntimeStateSnapshot,
} from "@forgeflow/dispatcher-store-postgres";

import { createEmptyRuntimeState } from "./runtime-state-json.js";
import type { RuntimeState } from "./runtime-state.js";

const PRIMARY_POSTGRES_URL_ENV = "DISPATCHER_PRIMARY_POSTGRES_URL";

function getPrimaryPostgresUrl(): string {
  const value = process.env[PRIMARY_POSTGRES_URL_ENV]?.trim();
  if (!value) {
    throw new Error(`${PRIMARY_POSTGRES_URL_ENV} is required when RUNTIME_STATE_BACKEND=postgres`);
  }
  return value;
}

export async function loadRuntimeStateFromPostgres(): Promise<RuntimeState> {
  const client = await createPgClient(getPrimaryPostgresUrl());
  try {
    const snapshot = await loadPrimaryRuntimeStateSnapshot<Partial<RuntimeState>>(client);
    return {
      ...createEmptyRuntimeState(),
      ...(snapshot ?? {}),
    };
  } finally {
    await client.end?.();
  }
}

export async function saveRuntimeStateToPostgres(state: RuntimeState): Promise<void> {
  const client = await createPgClient(getPrimaryPostgresUrl());
  try {
    await savePrimaryRuntimeStateSnapshot(client, state as unknown as Record<string, unknown>);
  } finally {
    await client.end?.();
  }
}
