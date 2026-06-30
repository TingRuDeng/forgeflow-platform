import fs from "node:fs";
import path from "node:path";

import type { ArtifactBundle } from "@forgeflow/result-contracts";

const ARTIFACT_STORE_DIR = "artifacts";
const MANIFEST_FILE = "manifest.json";
const TEXT_FILE_ENCODING = "utf8";
const DEFAULT_MAX_BUNDLES = 100;

const RETAINED_FILE_NAMES = {
  diff: "diff.patch",
  logs: "session.log",
  testResults: "test-results.txt",
} as const;

type RetainedContentKey = keyof typeof RETAINED_FILE_NAMES;

export interface ArtifactStoreFileManifest {
  kind: RetainedContentKey;
  fileName: string;
  ref: string;
  sizeBytes: number;
}

export interface ArtifactStoreManifest {
  schemaVersion: "artifact-store/v1";
  bundleId: string;
  taskId: string;
  attemptId: string;
  createdAt: string;
  files: ArtifactStoreFileManifest[];
}

export interface ArtifactStoreRetentionOptions {
  maxBundles?: number;
}

export interface PersistedArtifactBundle {
  bundle: ArtifactBundle;
  manifest: ArtifactStoreManifest;
}

function artifactStoreRoot(stateDir: string): string {
  return path.join(stateDir, ARTIFACT_STORE_DIR);
}

// 使用 base64url 作为目录名，避免 bundleId 中的斜杠或冒号影响文件系统路径。
function bundleDirectoryName(bundleId: string): string {
  return Buffer.from(bundleId).toString("base64url");
}

function bundleDirectoryPath(stateDir: string, bundleId: string): string {
  return path.join(artifactStoreRoot(stateDir), bundleDirectoryName(bundleId));
}

function manifestPath(stateDir: string, bundleId: string): string {
  return path.join(bundleDirectoryPath(stateDir, bundleId), MANIFEST_FILE);
}

function createArtifactRef(bundleId: string, fileName: string): string {
  return `artifact://${bundleId}/${fileName}`;
}

function resolveMaxBundles(options: ArtifactStoreRetentionOptions | undefined): number {
  const value = options?.maxBundles ?? DEFAULT_MAX_BUNDLES;
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : DEFAULT_MAX_BUNDLES;
}

function readManifest(filePath: string): ArtifactStoreManifest | null {
  try {
    return JSON.parse(fs.readFileSync(filePath, TEXT_FILE_ENCODING)) as ArtifactStoreManifest;
  } catch {
    return null;
  }
}

function retainedEntries(bundle: ArtifactBundle): Array<[RetainedContentKey, string]> {
  const content = bundle.retainedContent ?? {};
  return (Object.keys(RETAINED_FILE_NAMES) as RetainedContentKey[])
    .flatMap((key) => {
      const value = content[key];
      return typeof value === "string" && value.length > 0 ? [[key, value]] : [];
    });
}

function writeTextFile(filePath: string, content: string): number {
  fs.writeFileSync(filePath, content, TEXT_FILE_ENCODING);
  return Buffer.byteLength(content, TEXT_FILE_ENCODING);
}

function buildRefs(bundle: ArtifactBundle, files: ArtifactStoreFileManifest[]): ArtifactBundle["refs"] {
  return files.reduce<ArtifactBundle["refs"]>((refs, file) => ({
    ...refs,
    [file.kind]: file.ref,
  }), bundle.refs);
}

// 保留最新 artifact bundle，避免本地 stateDir 因日志和 diff 正文无限增长。
function applyRetention(stateDir: string, options?: ArtifactStoreRetentionOptions): void {
  const maxBundles = resolveMaxBundles(options);
  const manifests = listArtifactStoreManifests(stateDir);
  const removable = manifests
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.bundleId.localeCompare(right.bundleId))
    .slice(0, Math.max(0, manifests.length - maxBundles));
  for (const manifest of removable) {
    fs.rmSync(bundleDirectoryPath(stateDir, manifest.bundleId), { recursive: true, force: true });
  }
}

// 将 ArtifactBundle 的 retainedContent 落成独立文件，并返回 refs 已指向文件 store 的 bundle。
export function persistArtifactBundleFiles(
  stateDir: string,
  bundle: ArtifactBundle,
  options?: ArtifactStoreRetentionOptions,
): PersistedArtifactBundle {
  const bundleId = bundle.bundleId ?? `${bundle.attemptId}:artifact-bundle`;
  const bundleDir = bundleDirectoryPath(stateDir, bundleId);
  fs.mkdirSync(bundleDir, { recursive: true });

  const files = retainedEntries(bundle).map(([kind, content]) => {
    const fileName = RETAINED_FILE_NAMES[kind];
    const sizeBytes = writeTextFile(path.join(bundleDir, fileName), content);
    return { kind, fileName, ref: createArtifactRef(bundleId, fileName), sizeBytes };
  });
  const manifest: ArtifactStoreManifest = {
    schemaVersion: "artifact-store/v1",
    bundleId,
    taskId: bundle.taskId,
    attemptId: bundle.attemptId,
    createdAt: bundle.createdAt ?? new Date().toISOString(),
    files,
  };
  fs.writeFileSync(manifestPath(stateDir, bundleId), `${JSON.stringify(manifest, null, 2)}\n`, TEXT_FILE_ENCODING);
  applyRetention(stateDir, options);
  return {
    bundle: {
      ...bundle,
      bundleId,
      refs: buildRefs(bundle, files),
    },
    manifest,
  };
}

// 读取全部 manifest，供 CLI、HTTP API 和 retention 使用同一份索引。
export function listArtifactStoreManifests(stateDir: string): ArtifactStoreManifest[] {
  const root = artifactStoreRoot(stateDir);
  if (!fs.existsSync(root)) {
    return [];
  }
  return fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => readManifest(path.join(root, entry.name, MANIFEST_FILE)))
    .filter((manifest): manifest is ArtifactStoreManifest => Boolean(manifest));
}

// 只允许读取 manifest 中登记过的文件名，防止通过 artifact API 访问 stateDir 其他文件。
export function readArtifactStoreFile(stateDir: string, bundleId: string, fileName: string): string {
  if (fileName !== path.basename(fileName)) {
    throw new Error(`invalid artifact file: ${fileName}`);
  }
  const manifest = readManifest(manifestPath(stateDir, bundleId));
  if (!manifest) {
    throw new Error(`artifact bundle not found: ${bundleId}`);
  }
  const file = manifest.files.find((candidate) => candidate.fileName === fileName);
  if (!file) {
    throw new Error(`artifact file not found: ${fileName}`);
  }
  return fs.readFileSync(path.join(bundleDirectoryPath(stateDir, bundleId), file.fileName), TEXT_FILE_ENCODING);
}
