import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const RUNTIME_STATE_BACKUP_MANIFEST_SCHEMA_VERSION = "forgeflow-runtime-state-backup/v1";

const STATE_LOCK_FILENAME = ".runtime-state.lock";
const DEFAULT_STATE_LOCK_TIMEOUT_MS = 2000;
const DEFAULT_STATE_LOCK_RETRY_MS = 25;
const DEFAULT_STATE_LOCK_STALE_MS = 30000;
const HASH_BUFFER_BYTES = 64 * 1024;
const RUNTIME_STATE_FILES = Object.freeze([
  "runtime-state.db",
  "runtime-state.db-wal",
  "runtime-state.db-shm",
  "runtime-state.json",
  "runtime-state-shadow-status.json",
  "shadow-reconciler-status.json",
  "shadow-cutover-drill.json",
  "shadow-cutover-approval.json",
  "shadow-cutover-ready.json",
  "shadow-cutover-complete.json",
  "shadow-cutover-revocation.json",
]);
const RUNTIME_STATE_FILE_SET = new Set(RUNTIME_STATE_FILES);

function resolvePositiveIntegerEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error?.code === "ESRCH") {
      return false;
    }
    return true;
  }
}

function readLockSnapshot(lockPath) {
  try {
    const stats = fs.statSync(lockPath);
    let metadata = null;
    try {
      const parsed = JSON.parse(fs.readFileSync(lockPath, "utf8"));
      if (
        Number.isSafeInteger(parsed?.pid)
        && parsed.pid > 0
        && typeof parsed.ownerToken === "string"
        && parsed.ownerToken.length > 0
        && typeof parsed.createdAt === "string"
      ) {
        metadata = parsed;
      }
    } catch {}
    return { stats, metadata };
  } catch (error) {
    if (error?.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

function isSameFile(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}

function unlinkMatchingLock(lockPath, expected, requireOwnerToken) {
  const current = readLockSnapshot(lockPath);
  if (
    !current
    || !isSameFile(current.stats, expected.stats)
    || (requireOwnerToken && current.metadata?.ownerToken !== expected.metadata?.ownerToken)
  ) {
    return false;
  }
  fs.unlinkSync(lockPath);
  return true;
}

function tryReclaimStaleLock(lockPath, staleMs) {
  const snapshot = readLockSnapshot(lockPath);
  if (!snapshot || Date.now() - snapshot.stats.mtimeMs < staleMs) {
    return false;
  }
  if (snapshot.metadata && isProcessAlive(snapshot.metadata.pid)) {
    return false;
  }
  try {
    return unlinkMatchingLock(lockPath, snapshot, Boolean(snapshot.metadata));
  } catch (error) {
    if (error?.code === "ENOENT") {
      return true;
    }
    throw error;
  }
}

async function acquireRuntimeStateLock(stateDir) {
  fs.mkdirSync(stateDir, { recursive: true });
  const lockPath = path.join(stateDir, STATE_LOCK_FILENAME);
  const timeoutMs = resolvePositiveIntegerEnv(
    "DISPATCHER_STATE_LOCK_TIMEOUT_MS",
    DEFAULT_STATE_LOCK_TIMEOUT_MS,
  );
  const retryMs = resolvePositiveIntegerEnv(
    "DISPATCHER_STATE_LOCK_RETRY_MS",
    DEFAULT_STATE_LOCK_RETRY_MS,
  );
  const staleMs = resolvePositiveIntegerEnv(
    "DISPATCHER_STATE_LOCK_STALE_MS",
    DEFAULT_STATE_LOCK_STALE_MS,
  );
  const deadline = Date.now() + timeoutMs;

  while (true) {
    let fd = null;
    let createdLock = null;
    try {
      fd = fs.openSync(lockPath, "wx");
      createdLock = {
        stats: fs.fstatSync(fd),
        metadata: {
          pid: process.pid,
          ownerToken: crypto.randomUUID(),
          createdAt: new Date().toISOString(),
        },
      };
      fs.writeFileSync(fd, JSON.stringify(createdLock.metadata));
      fs.closeSync(fd);
      fd = null;

      let released = false;
      return () => {
        if (released) {
          return;
        }
        released = true;
        if (!unlinkMatchingLock(lockPath, createdLock, true)) {
          throw new Error(`runtime state lock ownership changed before release: ${lockPath}`);
        }
      };
    } catch (error) {
      if (fd !== null) {
        try {
          fs.closeSync(fd);
        } catch {}
      }
      if (error?.code !== "EEXIST") {
        if (createdLock) {
          try {
            unlinkMatchingLock(lockPath, createdLock, false);
          } catch {}
        }
        throw error;
      }
      if (tryReclaimStaleLock(lockPath, staleMs)) {
        continue;
      }
      if (Date.now() >= deadline) {
        throw new Error(`runtime state lock timeout after ${timeoutMs}ms: ${lockPath}`);
      }
      await sleep(retryMs);
    }
  }
}

export async function withRuntimeStateLock(stateDir, operation) {
  const releaseLock = await acquireRuntimeStateLock(stateDir);
  let operationError = null;
  try {
    return await operation();
  } catch (error) {
    operationError = error;
    throw error;
  } finally {
    try {
      releaseLock();
    } catch (releaseError) {
      if (!operationError) {
        throw releaseError;
      }
    }
  }
}

function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  const buffer = Buffer.allocUnsafe(HASH_BUFFER_BYTES);
  const fd = fs.openSync(filePath, "r");
  try {
    while (true) {
      const bytesRead = fs.readSync(fd, buffer, 0, buffer.length, null);
      if (bytesRead === 0) {
        break;
      }
      hash.update(buffer.subarray(0, bytesRead));
    }
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest("hex");
}

function describeFile(filePath, name) {
  return {
    name,
    sizeBytes: fs.statSync(filePath).size,
    sha256: sha256File(filePath),
  };
}

function assertFileMatchesDescriptor(filePath, descriptor) {
  const stats = fs.statSync(filePath);
  if (stats.size !== descriptor.sizeBytes) {
    throw new Error(
      `backup file size mismatch for ${descriptor.name}: expected ${descriptor.sizeBytes}, got ${stats.size}`,
    );
  }
  const actualSha256 = sha256File(filePath);
  if (actualSha256 !== descriptor.sha256) {
    throw new Error(
      `backup file checksum mismatch for ${descriptor.name}: expected ${descriptor.sha256}, got ${actualSha256}`,
    );
  }
}

function atomicWriteFile(filePath, content) {
  const tempPath = `${filePath}.tmp-${process.pid}-${crypto.randomUUID()}`;
  try {
    fs.writeFileSync(tempPath, content, "utf8");
    fs.renameSync(tempPath, filePath);
  } finally {
    fs.rmSync(tempPath, { force: true });
  }
}

function copyFileToTemporaryTarget(source, targetDir, name, token) {
  const temporaryPath = path.join(targetDir, `.${name}.restore-${token}`);
  fs.copyFileSync(source, temporaryPath);
  return temporaryPath;
}

function assertRuntimeStateFileName(name) {
  if (!RUNTIME_STATE_FILE_SET.has(name)) {
    throw new Error(`backup manifest contains unsupported runtime state file: ${name}`);
  }
}

async function readSqliteWatermark(backupDir) {
  const dbPath = path.join(backupDir, "runtime-state.db");
  if (!fs.existsSync(dbPath)) {
    return null;
  }

  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const integrity = db.prepare("PRAGMA integrity_check").get();
    if (integrity?.integrity_check !== "ok") {
      throw new Error(
        `backup runtime-state.db integrity check failed: ${integrity?.integrity_check ?? "unknown"}`,
      );
    }
    const stats = db.prepare("SELECT COUNT(*) AS count FROM snapshots").get();
    const latest = db.prepare(`
      SELECT revision, data, checksum_sha256, created_at
      FROM snapshots
      ORDER BY revision DESC
      LIMIT 1
    `).get();
    if (!latest) {
      throw new Error("backup runtime-state.db has no snapshots");
    }
    const computedSnapshotChecksum = crypto
      .createHash("sha256")
      .update(latest.data, "utf8")
      .digest("hex");
    if (computedSnapshotChecksum !== latest.checksum_sha256) {
      throw new Error("backup runtime-state.db latest snapshot checksum mismatch");
    }
    const latestState = JSON.parse(latest.data);
    return {
      integrityCheck: "ok",
      snapshotCount: Number(stats.count),
      latestRevision: Number(latest.revision),
      latestStateSequence: Number(latestState.sequence ?? 0),
      latestSnapshotChecksumSha256: latest.checksum_sha256,
      latestSnapshotCreatedAt: latest.created_at,
    };
  } finally {
    db.close();
  }
}

function listManifestPaths(backupDir) {
  return fs.readdirSync(backupDir)
    .filter((name) => name.endsWith("-manifest.json"))
    .sort()
    .reverse()
    .map((name) => path.join(backupDir, name));
}

function readBackupManifest(backupDir) {
  const [manifestPath] = listManifestPaths(backupDir);
  if (!manifestPath) {
    throw new Error(`backup manifest not found in ${backupDir}`);
  }

  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  } catch (error) {
    throw new Error(
      `failed to read backup manifest ${manifestPath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (manifest?.schemaVersion === RUNTIME_STATE_BACKUP_MANIFEST_SCHEMA_VERSION) {
    if (!Array.isArray(manifest.files) || manifest.files.length === 0) {
      throw new Error(`backup manifest has no files: ${manifestPath}`);
    }
    const names = new Set();
    const files = manifest.files.map((entry) => {
      if (
        typeof entry?.name !== "string"
        || !Number.isSafeInteger(entry?.sizeBytes)
        || entry.sizeBytes < 0
        || typeof entry?.sha256 !== "string"
        || !/^[a-f0-9]{64}$/.test(entry.sha256)
      ) {
        throw new Error(`backup manifest has an invalid file descriptor: ${manifestPath}`);
      }
      assertRuntimeStateFileName(entry.name);
      if (names.has(entry.name)) {
        throw new Error(`backup manifest contains duplicate file: ${entry.name}`);
      }
      names.add(entry.name);
      return {
        name: entry.name,
        sizeBytes: entry.sizeBytes,
        sha256: entry.sha256,
      };
    });
    return {
      manifestPath,
      schemaVersion: manifest.schemaVersion,
      verified: true,
      files,
      sqliteWatermark: manifest.sqliteWatermark ?? null,
    };
  }

  if (!Array.isArray(manifest?.copiedFiles) || manifest.copiedFiles.length === 0) {
    throw new Error(`unsupported backup manifest schema: ${manifestPath}`);
  }
  const names = new Set();
  const files = manifest.copiedFiles.map((name) => {
    if (typeof name !== "string") {
      throw new Error(`legacy backup manifest contains an invalid file name: ${manifestPath}`);
    }
    assertRuntimeStateFileName(name);
    if (names.has(name)) {
      throw new Error(`legacy backup manifest contains duplicate file: ${name}`);
    }
    names.add(name);
    return { name };
  });
  return {
    manifestPath,
    schemaVersion: "legacy",
    verified: false,
    files,
    sqliteWatermark: null,
  };
}

export async function backupRuntimeState({ stateDir, backupDir }) {
  return withRuntimeStateLock(stateDir, async () => {
    fs.mkdirSync(backupDir, { recursive: true });
    const copiedFiles = [];

    for (const name of RUNTIME_STATE_FILES) {
      const source = path.join(stateDir, name);
      if (!fs.existsSync(source)) {
        continue;
      }
      const target = path.join(backupDir, name);
      const temporaryPath = `${target}.tmp-${process.pid}-${crypto.randomUUID()}`;
      try {
        fs.copyFileSync(source, temporaryPath);
        fs.renameSync(temporaryPath, target);
      } finally {
        fs.rmSync(temporaryPath, { force: true });
      }
      copiedFiles.push(name);
    }

    if (copiedFiles.length === 0) {
      throw new Error(`no runtime state files found in ${stateDir}`);
    }

    const sqliteWatermark = await readSqliteWatermark(backupDir);
    const files = copiedFiles.map((name) => describeFile(path.join(backupDir, name), name));
    const manifest = {
      schemaVersion: RUNTIME_STATE_BACKUP_MANIFEST_SCHEMA_VERSION,
      backedUpAt: new Date().toISOString(),
      sourceStateDir: path.resolve(stateDir),
      copiedFiles,
      files,
      sqliteWatermark,
    };
    const manifestPath = path.join(
      backupDir,
      `${manifest.backedUpAt.replace(/[:]/g, "-")}-manifest.json`,
    );
    atomicWriteFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    return {
      manifestPath,
      copiedFiles,
      files,
      sqliteWatermark,
    };
  });
}

export async function restoreRuntimeState({ backupDir, stateDir }) {
  if (path.resolve(backupDir) === path.resolve(stateDir)) {
    throw new Error("backupDir and stateDir must be different directories");
  }

  return withRuntimeStateLock(stateDir, async () => {
    const manifest = readBackupManifest(backupDir);
    const verifiedFiles = [];
    for (const descriptor of manifest.files) {
      const source = path.join(backupDir, descriptor.name);
      if (!fs.existsSync(source)) {
        throw new Error(`backup file listed in manifest is missing: ${descriptor.name}`);
      }
      if (manifest.verified) {
        assertFileMatchesDescriptor(source, descriptor);
        verifiedFiles.push(descriptor.name);
      }
    }

    fs.mkdirSync(stateDir, { recursive: true });
    const token = `${process.pid}-${crypto.randomUUID()}`;
    const staged = new Map();
    const rollback = new Map();
    const restoredFiles = manifest.files.map((entry) => entry.name);
    const restoredFileSet = new Set(restoredFiles);
    const removedFiles = [];

    try {
      for (const descriptor of manifest.files) {
        const temporaryPath = copyFileToTemporaryTarget(
          path.join(backupDir, descriptor.name),
          stateDir,
          descriptor.name,
          token,
        );
        if (manifest.verified) {
          assertFileMatchesDescriptor(temporaryPath, descriptor);
        }
        staged.set(descriptor.name, temporaryPath);
      }

      for (const name of RUNTIME_STATE_FILES) {
        const target = path.join(stateDir, name);
        if (!fs.existsSync(target)) {
          continue;
        }
        const rollbackPath = path.join(stateDir, `.${name}.rollback-${token}`);
        fs.renameSync(target, rollbackPath);
        rollback.set(name, rollbackPath);
        if (!restoredFileSet.has(name)) {
          removedFiles.push(name);
        }
      }

      for (const [name, temporaryPath] of staged.entries()) {
        fs.renameSync(temporaryPath, path.join(stateDir, name));
        staged.delete(name);
      }
    } catch (error) {
      for (const name of restoredFiles) {
        fs.rmSync(path.join(stateDir, name), { force: true });
      }
      for (const [name, rollbackPath] of rollback.entries()) {
        if (fs.existsSync(rollbackPath)) {
          fs.renameSync(rollbackPath, path.join(stateDir, name));
        }
      }
      throw error;
    } finally {
      for (const temporaryPath of staged.values()) {
        fs.rmSync(temporaryPath, { force: true });
      }
    }

    for (const rollbackPath of rollback.values()) {
      fs.rmSync(rollbackPath, { force: true });
    }

    return {
      manifestPath: manifest.manifestPath,
      manifestSchemaVersion: manifest.schemaVersion,
      manifestVerified: manifest.verified,
      verifiedFiles,
      restoredFiles,
      removedFiles,
      sqliteWatermark: manifest.sqliteWatermark,
    };
  });
}
