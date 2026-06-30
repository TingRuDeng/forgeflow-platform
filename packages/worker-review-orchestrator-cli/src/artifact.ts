import fs from "node:fs";
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

function artifactDirectoryName(bundleId: string): string {
  return Buffer.from(bundleId).toString("base64url");
}

function artifactManifestPath(stateDir: string, bundleId: string): string {
  return path.join(stateDir, "artifacts", artifactDirectoryName(bundleId), "manifest.json");
}

// 本地读取只信任 manifest 登记过的文件，避免 CLI 通过 --file 逃逸 state-dir。
function readLocalArtifactFile(stateDir: string, bundleId: string, fileName: string): Record<string, unknown> {
  if (fileName !== path.basename(fileName)) {
    throw new Error(`invalid artifact file: ${fileName}`);
  }
  const manifestPath = artifactManifestPath(stateDir, bundleId);
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`artifact bundle not found: ${bundleId}`);
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as {
    files?: Array<{ fileName?: string }>;
  };
  const file = manifest.files?.find((candidate) => candidate.fileName === fileName);
  if (!file?.fileName) {
    throw new Error(`artifact file not found: ${fileName}`);
  }
  return {
    bundleId,
    fileName,
    content: fs.readFileSync(path.join(path.dirname(manifestPath), file.fileName), "utf8"),
  };
}

export async function runArtifactGet(options: ArtifactGetOptions): Promise<Record<string, unknown>> {
  if (!options.bundleId) {
    throw new Error("--bundle-id is required");
  }

  if (options.dispatcherUrl) {
    const client = createJsonHttpClient(options.dispatcherUrl, {
      fetchImpl: options.fetchImpl,
    });
    if (options.fileName) {
      return await client.request(
        `/api/artifacts/${encodeURIComponent(options.bundleId)}/files/${encodeURIComponent(options.fileName)}`,
      ) as Record<string, unknown>;
    }
    return await client.request(`/api/artifacts/${encodeURIComponent(options.bundleId)}`) as Record<string, unknown>;
  }

  if (!options.stateDir) {
    throw new Error("--dispatcher-url or --state-dir is required");
  }

  const stateDir = path.resolve(options.stateDir);
  if (options.fileName) {
    return readLocalArtifactFile(stateDir, options.bundleId, options.fileName);
  }

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
