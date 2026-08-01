import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export interface SecureConfigFilePolicy {
  label: string;
  privateDirectory?: string;
}

export interface SecureConfigFileInspection {
  ok: boolean;
  fileExists: boolean;
  directoryExists: boolean;
  fileMode: number | null;
  directoryMode: number | null;
  fileIsSymbolicLink: boolean;
  directoryIsSymbolicLink: boolean;
  requiresPrivateDirectory: boolean;
  message: string;
}

function formatMode(mode: number | null) {
  return mode === null ? "missing" : mode.toString(8).padStart(3, "0");
}

function requiresPrivateDirectory(configDir: string, policy: SecureConfigFilePolicy) {
  return policy.privateDirectory !== undefined
    && path.resolve(configDir) === path.resolve(policy.privateDirectory);
}

function unsupportedPlatformMessage(policy: SecureConfigFilePolicy) {
  return `${policy.label} secure config is supported only on Unix-like platforms; Windows is unsupported`;
}

function assertSupportedPlatform(policy: SecureConfigFilePolicy) {
  if (process.platform === "win32") {
    throw new Error(unsupportedPlatformMessage(policy));
  }
}

function findUntrustedDirectorySymlink(configDir: string) {
  const resolvedDir = path.resolve(configDir);
  const rootDir = path.parse(resolvedDir).root;
  const relative = path.relative(rootDir, resolvedDir);
  let current = rootDir;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    const stats = fs.lstatSync(current, { throwIfNoEntry: false });
    if (!stats) {
      return null;
    }
    if (!stats.isSymbolicLink()) {
      continue;
    }

    const parentStats = fs.statSync(path.dirname(current));
    const trustedSystemLink = stats.uid === 0
      && parentStats.isDirectory()
      && (parentStats.mode & 0o022) === 0;
    if (!trustedSystemLink) {
      return current;
    }
  }
  return null;
}

function assertNoUntrustedDirectorySymlink(configDir: string, policy: SecureConfigFilePolicy) {
  const symbolicLink = findUntrustedDirectorySymlink(configDir);
  if (symbolicLink) {
    throw new Error(`${policy.label} directory path must not contain symbolic links: ${symbolicLink}`);
  }
}

function findUnsafePosixDirectoryAncestor(configDir: string) {
  const resolvedDir = path.resolve(configDir);
  const rootDir = path.parse(resolvedDir).root;
  const currentUid = process.getuid?.();
  let current = rootDir;
  for (const segment of path.relative(rootDir, resolvedDir).split(path.sep).filter(Boolean)) {
    const parent = current;
    current = path.join(current, segment);
    const parentStats = fs.statSync(parent);
    const childStats = fs.lstatSync(current, { throwIfNoEntry: false });
    if ((parentStats.mode & 0o022) !== 0) {
      if (!childStats) {
        return parent;
      }
      const sticky = (parentStats.mode & 0o1000) !== 0;
      const trustedOwner = (uid: number) => uid === 0 || (currentUid !== undefined && uid === currentUid);
      if (!sticky || !trustedOwner(parentStats.uid) || !trustedOwner(childStats.uid)) {
        return parent;
      }
    }
    if (!childStats) {
      return null;
    }
  }
  return null;
}

function inspectDirectoryAncestry(configDir: string, policy: SecureConfigFilePolicy) {
  const unsafeAncestor = findUnsafePosixDirectoryAncestor(configDir);
  return unsafeAncestor
    ? `insecure ${policy.label} permissions: directory ancestor is writable by another user (${unsafeAncestor})`
    : null;
}

function assertSecureDirectoryAncestry(configDir: string, policy: SecureConfigFilePolicy) {
  const problem = inspectDirectoryAncestry(configDir, policy);
  if (problem) {
    throw new Error(problem);
  }
}

function resolveCanonicalDirectory(configPath: string, policy: SecureConfigFilePolicy) {
  const configDir = path.dirname(configPath);
  assertNoUntrustedDirectorySymlink(configDir, policy);
  const initialStats = fs.lstatSync(configDir, { throwIfNoEntry: false });
  if (!initialStats || initialStats.isSymbolicLink() || !initialStats.isDirectory()) {
    throw new Error(`${policy.label} directory must be a real directory: ${configDir}`);
  }
  const canonicalDir = fs.realpathSync.native(configDir);
  const canonicalStats = fs.statSync(canonicalDir);
  if (canonicalStats.dev !== initialStats.dev || canonicalStats.ino !== initialStats.ino) {
    throw new Error(`${policy.label} directory changed during security validation: ${configDir}`);
  }
  return { canonicalDir, stats: initialStats };
}

function openValidatedConfigFile(
  configPath: string,
  canonicalDir: string,
  policy: SecureConfigFilePolicy,
  requireOwnerOnly: boolean,
) {
  const canonicalPath = path.join(canonicalDir, path.basename(configPath));
  const initialStats = fs.lstatSync(canonicalPath, { throwIfNoEntry: false });
  if (!initialStats) {
    return null;
  }
  if (initialStats.isSymbolicLink()) {
    throw new Error(`${policy.label} file must not be a symbolic link: ${configPath}`);
  }
  if (!initialStats.isFile()) {
    throw new Error(`${policy.label} path must be a regular file: ${configPath}`);
  }

  const noFollow = typeof fs.constants.O_NOFOLLOW === "number" ? fs.constants.O_NOFOLLOW : 0;
  let descriptor: number | null = null;
  try {
    descriptor = fs.openSync(canonicalPath, fs.constants.O_RDONLY | noFollow);
    const openedStats = fs.fstatSync(descriptor);
    if (!openedStats.isFile()) {
      throw new Error(`${policy.label} path must be a regular file: ${configPath}`);
    }
    if (openedStats.dev !== initialStats.dev || openedStats.ino !== initialStats.ino) {
      throw new Error(`${policy.label} file changed during security validation: ${configPath}`);
    }
    if (requireOwnerOnly && (openedStats.mode & 0o077) !== 0) {
      throw new Error(
        `insecure ${policy.label} permissions for ${configPath} (expected 600). Fix: chmod 600 ${configPath}`,
      );
    }
    const result = descriptor;
    descriptor = null;
    return result;
  } finally {
    if (descriptor !== null) {
      fs.closeSync(descriptor);
    }
  }
}

function chmodDirectoryDescriptor(
  configDir: string,
  canonicalDir: string,
  initialStats: fs.Stats,
  policy: SecureConfigFilePolicy,
) {
  const noFollow = typeof fs.constants.O_NOFOLLOW === "number" ? fs.constants.O_NOFOLLOW : 0;
  const directoryOnly = typeof fs.constants.O_DIRECTORY === "number" ? fs.constants.O_DIRECTORY : 0;
  const descriptor = fs.openSync(canonicalDir, fs.constants.O_RDONLY | directoryOnly | noFollow);
  try {
    const openedStats = fs.fstatSync(descriptor);
    if (openedStats.dev !== initialStats.dev || openedStats.ino !== initialStats.ino) {
      throw new Error(`${policy.label} directory changed during security validation: ${configDir}`);
    }
    fs.fchmodSync(descriptor, 0o700);
  } finally {
    fs.closeSync(descriptor);
  }
}

function writeOwnerOnlyFileAtomically(configPath: string, content: string) {
  const tempPath = path.join(
    path.dirname(configPath),
    `.${path.basename(configPath)}.${process.pid}.${crypto.randomUUID()}.tmp`,
  );
  const noFollow = typeof fs.constants.O_NOFOLLOW === "number" ? fs.constants.O_NOFOLLOW : 0;
  let descriptor: number | null = null;
  try {
    descriptor = fs.openSync(
      tempPath,
      fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | noFollow,
      0o600,
    );
    fs.fchmodSync(descriptor, 0o600);
    fs.writeFileSync(descriptor, content, "utf8");
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = null;
    fs.renameSync(tempPath, configPath);
  } finally {
    if (descriptor !== null) {
      fs.closeSync(descriptor);
    }
    fs.rmSync(tempPath, { force: true });
  }
}

export function inspectSecureConfigFile(
  configPath: string,
  policy: SecureConfigFilePolicy,
): SecureConfigFileInspection {
  const resolvedPath = path.resolve(configPath);
  const configDir = path.dirname(resolvedPath);
  if (process.platform === "win32") {
    return {
      ok: false,
      fileExists: false,
      directoryExists: false,
      fileMode: null,
      directoryMode: null,
      fileIsSymbolicLink: false,
      directoryIsSymbolicLink: false,
      requiresPrivateDirectory: requiresPrivateDirectory(configDir, policy),
      message: unsupportedPlatformMessage(policy),
    };
  }
  const symbolicLinkComponent = findUntrustedDirectorySymlink(configDir);
  if (symbolicLinkComponent) {
    return {
      ok: false,
      fileExists: false,
      directoryExists: false,
      fileMode: null,
      directoryMode: null,
      fileIsSymbolicLink: false,
      directoryIsSymbolicLink: false,
      requiresPrivateDirectory: requiresPrivateDirectory(configDir, policy),
      message: `insecure ${policy.label} permissions: directory path contains a symbolic link (${symbolicLinkComponent})`,
    };
  }
  const fileStats = fs.lstatSync(resolvedPath, { throwIfNoEntry: false });
  const directoryStats = fs.lstatSync(configDir, { throwIfNoEntry: false });
  const fileExists = Boolean(fileStats);
  const directoryExists = Boolean(directoryStats);
  const fileMode = fileStats ? fileStats.mode & 0o777 : null;
  const directoryMode = directoryStats ? directoryStats.mode & 0o777 : null;
  const fileIsSymbolicLink = fileStats?.isSymbolicLink() === true;
  const directoryIsSymbolicLink = directoryStats?.isSymbolicLink() === true;
  const privateDirectory = requiresPrivateDirectory(configDir, policy);
  const baseStatus = {
    fileExists,
    directoryExists,
    fileMode,
    directoryMode,
    fileIsSymbolicLink,
    directoryIsSymbolicLink,
    requiresPrivateDirectory: privateDirectory,
  };

  const ancestryProblem = inspectDirectoryAncestry(configDir, policy);
  if (ancestryProblem) {
    return {
      ok: false,
      ...baseStatus,
      message: ancestryProblem,
    };
  }

  if (fileIsSymbolicLink) {
    return {
      ok: false,
      ...baseStatus,
      message: `insecure ${policy.label} permissions: config file is a symbolic link (${resolvedPath})`,
    };
  }
  if (fileStats && !fileStats.isFile()) {
    return {
      ok: false,
      ...baseStatus,
      message: `insecure ${policy.label} permissions: config path is not a regular file (${resolvedPath})`,
    };
  }
  if (!directoryStats) {
    return {
      ok: !fileExists,
      ...baseStatus,
      message: fileExists
        ? `insecure ${policy.label} permissions: config directory is missing (${configDir})`
        : "config file and directory are missing",
    };
  }
  if (directoryIsSymbolicLink || !directoryStats.isDirectory()) {
    return {
      ok: false,
      ...baseStatus,
      message: `insecure ${policy.label} permissions: config directory must be a real directory (${configDir})`,
    };
  }

  const directorySecure = privateDirectory
    ? (directoryStats.mode & 0o077) === 0
    : (directoryStats.mode & 0o022) === 0;
  if (!directorySecure) {
    const expectation = privateDirectory ? "must be owner-only" : "is writable by group or others";
    const fix = privateDirectory ? `chmod 700 ${configDir}` : `chmod go-w ${configDir}`;
    return {
      ok: false,
      ...baseStatus,
      message: `insecure ${policy.label} permissions: config directory ${expectation} (mode ${formatMode(directoryMode)}). Fix: ${fix}`,
    };
  }
  if (fileStats && (fileStats.mode & 0o077) !== 0) {
    return {
      ok: false,
      ...baseStatus,
      message: `insecure ${policy.label} permissions for ${resolvedPath} (expected 600). Fix: chmod 600 ${resolvedPath}`,
    };
  }

  return {
    ok: true,
    ...baseStatus,
    message: fileExists ? "config path permissions are secure" : "config file is missing and config directory permissions are secure",
  };
}

export function repairSecureConfigFilePermissions(
  configPath: string,
  policy: SecureConfigFilePolicy,
) {
  assertSupportedPlatform(policy);
  const resolvedPath = path.resolve(configPath);
  const configDir = path.dirname(resolvedPath);
  assertNoUntrustedDirectorySymlink(configDir, policy);
  assertSecureDirectoryAncestry(configDir, policy);
  if (!fs.lstatSync(configDir, { throwIfNoEntry: false })) {
    return resolvedPath;
  }

  const { canonicalDir, stats: directoryStats } = resolveCanonicalDirectory(resolvedPath, policy);
  if (requiresPrivateDirectory(configDir, policy)) {
    chmodDirectoryDescriptor(configDir, canonicalDir, directoryStats, policy);
  } else if ((directoryStats.mode & 0o022) !== 0) {
    throw new Error(`${policy.label} directory is writable by group or others: ${configDir}. Fix: chmod go-w ${configDir}`);
  }

  const descriptor = openValidatedConfigFile(resolvedPath, canonicalDir, policy, false);
  if (descriptor !== null) {
    try {
      fs.fchmodSync(descriptor, 0o600);
    } finally {
      fs.closeSync(descriptor);
    }
  }
  const inspection = inspectSecureConfigFile(resolvedPath, policy);
  if (!inspection.ok) {
    throw new Error(inspection.message);
  }
  return resolvedPath;
}

export function readSecureConfigFile(
  configPath: string,
  policy: SecureConfigFilePolicy,
) {
  assertSupportedPlatform(policy);
  const resolvedPath = path.resolve(configPath);
  const inspection = inspectSecureConfigFile(resolvedPath, policy);
  if (!inspection.ok) {
    throw new Error(inspection.message);
  }
  if (!inspection.fileExists) {
    return null;
  }

  const { canonicalDir } = resolveCanonicalDirectory(resolvedPath, policy);
  const descriptor = openValidatedConfigFile(resolvedPath, canonicalDir, policy, true);
  if (descriptor === null) {
    return null;
  }
  try {
    return fs.readFileSync(descriptor, "utf8");
  } finally {
    fs.closeSync(descriptor);
  }
}

export function writeSecureConfigFile(
  configPath: string,
  content: string,
  policy: SecureConfigFilePolicy,
) {
  assertSupportedPlatform(policy);
  const resolvedPath = path.resolve(configPath);
  const configDir = path.dirname(resolvedPath);
  assertNoUntrustedDirectorySymlink(configDir, policy);
  assertSecureDirectoryAncestry(configDir, policy);
  fs.mkdirSync(configDir, { recursive: true, mode: 0o700 });
  repairSecureConfigFilePermissions(resolvedPath, policy);
  const { canonicalDir } = resolveCanonicalDirectory(resolvedPath, policy);
  const canonicalPath = path.join(canonicalDir, path.basename(resolvedPath));
  writeOwnerOnlyFileAtomically(canonicalPath, content);
  repairSecureConfigFilePermissions(resolvedPath, policy);
  return resolvedPath;
}
