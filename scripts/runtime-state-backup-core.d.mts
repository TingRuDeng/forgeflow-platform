export interface RuntimeStateBackupFileDescriptor {
  name: string;
  sizeBytes: number;
  sha256: string;
}

export interface RuntimeStateBackupSqliteWatermark {
  integrityCheck: "ok";
  snapshotCount: number;
  latestRevision: number;
  latestStateSequence: number;
  latestSnapshotChecksumSha256: string;
  latestSnapshotCreatedAt: string;
}

export interface RuntimeStateBackupResult {
  manifestPath: string;
  copiedFiles: string[];
  files: RuntimeStateBackupFileDescriptor[];
  sqliteWatermark: RuntimeStateBackupSqliteWatermark | null;
}

export interface RuntimeStateRestoreResult {
  manifestPath: string;
  manifestSchemaVersion: string;
  manifestVerified: boolean;
  verifiedFiles: string[];
  restoredFiles: string[];
  removedFiles: string[];
  sqliteWatermark: RuntimeStateBackupSqliteWatermark | null;
}

export const RUNTIME_STATE_BACKUP_MANIFEST_SCHEMA_VERSION: "forgeflow-runtime-state-backup/v1";

export function withRuntimeStateLock<T>(
  stateDir: string,
  operation: () => T | Promise<T>,
): Promise<T>;

export function backupRuntimeState(input: {
  stateDir: string;
  backupDir: string;
}): Promise<RuntimeStateBackupResult>;

export function restoreRuntimeState(input: {
  backupDir: string;
  stateDir: string;
}): Promise<RuntimeStateRestoreResult>;
