import path from "node:path";

import type { ArtifactGetOptions } from "./types.js";

import { createJsonHttpClient, loadRuntimeState } from "./http.js";
import { loadLocalSnapshot } from "./local-dispatcher.js";

function findArtifact(snapshot: Record<string, unknown>, bundleId: string): Record<string, unknown> | null {
  const bundles = Array.isArray(snapshot.artifactBundles)
    ? snapshot.artifactBundles as Array<Record<string, unknown>>
    : [];
  return bundles.find((bundle) => bundle.bundleId === bundleId) ?? null;
}

export async function runArtifactGet(options: ArtifactGetOptions): Promise<Record<string, unknown>> {
  if (!options.bundleId) {
    throw new Error("--bundle-id is required");
  }

  if (options.dispatcherUrl) {
    const client = createJsonHttpClient(options.dispatcherUrl, {
      fetchImpl: options.fetchImpl,
    });
    return await client.request(`/api/artifacts/${encodeURIComponent(options.bundleId)}`) as Record<string, unknown>;
  }

  if (!options.stateDir) {
    throw new Error("--dispatcher-url or --state-dir is required");
  }

  const stateDir = path.resolve(options.stateDir);
  let snapshot: Record<string, unknown>;
  try {
    snapshot = await loadLocalSnapshot(stateDir);
  } catch {
    snapshot = loadRuntimeState(stateDir) as unknown as Record<string, unknown>;
  }

  const artifact = findArtifact(snapshot, options.bundleId);
  if (!artifact) {
    throw new Error(`artifact not found: ${options.bundleId}`);
  }
  return artifact;
}
