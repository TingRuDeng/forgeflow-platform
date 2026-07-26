import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

export type ExecutionProfileName = "trusted-host" | "isolated-container";
export type IsolatedNetworkMode = "bridge" | "none";

export interface TrustedHostExecutionProfile {
  name: "trusted-host";
}

export interface IsolatedContainerExecutionProfile {
  name: "isolated-container";
  runtime: string;
  image: string;
  network: IsolatedNetworkMode;
  cpus: number;
  memory: string;
  pidsLimit: number;
  user: string;
  workspaceDir: "/workspace";
  homeDir: "/home/forgeflow";
  tempDir: "/tmp";
}

export type ExecutionProfile = TrustedHostExecutionProfile | IsolatedContainerExecutionProfile;

export interface ExecutionProfileProbeResult {
  status: number | null;
  stdout?: string;
  stderr?: string;
  error?: Error;
}

export type ExecutionProfileProbe = (
  command: string,
  args: string[],
) => ExecutionProfileProbeResult;

export interface ExecutionProfileCommand {
  argv: string[];
  cwd: string;
  executionProfile?: ExecutionProfileName;
}

const DEFAULT_CONTAINER_CPUS = 2;
const DEFAULT_CONTAINER_MEMORY = "4g";
const DEFAULT_CONTAINER_PIDS_LIMIT = 256;
const CONTAINER_WORKSPACE_DIR = "/workspace" as const;
const MEMORY_LIMIT_PATTERN = /^[1-9]\d*(?:\.\d+)?(?:[kmgt]i?b?|b)?$/i;
const CONTAINER_USER_PATTERN = /^\d+:\d+$/;

function envValue(
  envSource: Record<string, string | undefined>,
  key: string,
  fallback = "",
): string {
  return String(envSource[key] ?? fallback).trim();
}

function resolvePositiveNumber(value: string, fallback: number, label: string): number {
  if (!value) {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive number`);
  }
  return parsed;
}

function resolvePositiveInteger(value: string, fallback: number, label: string): number {
  if (!value) {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
  return parsed;
}

function defaultContainerUser(): string {
  const uid = typeof process.getuid === "function" ? process.getuid() : 1000;
  const gid = typeof process.getgid === "function" ? process.getgid() : 1000;
  return `${uid}:${gid}`;
}

export function resolveExecutionProfileName(
  envSource: Record<string, string | undefined> = process.env,
): ExecutionProfileName {
  const name = envValue(envSource, "FORGEFLOW_EXECUTION_PROFILE", "trusted-host");
  if (name !== "trusted-host" && name !== "isolated-container") {
    throw new Error(
      "FORGEFLOW_EXECUTION_PROFILE must be trusted-host or isolated-container",
    );
  }
  return name;
}

export function isIsolatedExecutionProfile(
  envSource: Record<string, string | undefined> = process.env,
): boolean {
  return resolveExecutionProfileName(envSource) === "isolated-container";
}

export function executionProfilesEqual(
  left: ExecutionProfile,
  right: ExecutionProfile,
): boolean {
  if (left.name !== right.name) {
    return false;
  }
  if (left.name === "trusted-host" || right.name === "trusted-host") {
    return true;
  }
  return left.runtime === right.runtime
    && left.image === right.image
    && left.network === right.network
    && left.cpus === right.cpus
    && left.memory === right.memory
    && left.pidsLimit === right.pidsLimit
    && left.user === right.user
    && left.workspaceDir === right.workspaceDir
    && left.homeDir === right.homeDir
    && left.tempDir === right.tempDir;
}

export function resolveExecutionProfile(
  envSource: Record<string, string | undefined> = process.env,
): ExecutionProfile {
  const name = resolveExecutionProfileName(envSource);
  if (name === "trusted-host") {
    return { name };
  }

  const image = envValue(envSource, "FORGEFLOW_EXECUTION_CONTAINER_IMAGE");
  if (!image || image.startsWith("-")) {
    throw new Error(
      "FORGEFLOW_EXECUTION_CONTAINER_IMAGE is required for isolated-container",
    );
  }
  const runtime = envValue(envSource, "FORGEFLOW_EXECUTION_CONTAINER_RUNTIME", "docker");
  if (!runtime || runtime.startsWith("-")) {
    throw new Error("FORGEFLOW_EXECUTION_CONTAINER_RUNTIME must name an executable");
  }
  const network = envValue(envSource, "FORGEFLOW_EXECUTION_NETWORK", "bridge");
  if (network !== "bridge" && network !== "none") {
    throw new Error("FORGEFLOW_EXECUTION_NETWORK must be bridge or none");
  }
  const memory = envValue(
    envSource,
    "FORGEFLOW_EXECUTION_MEMORY",
    DEFAULT_CONTAINER_MEMORY,
  );
  if (!MEMORY_LIMIT_PATTERN.test(memory)) {
    throw new Error("FORGEFLOW_EXECUTION_MEMORY must be a Docker memory limit such as 4g");
  }
  const user = envValue(
    envSource,
    "FORGEFLOW_EXECUTION_CONTAINER_USER",
    defaultContainerUser(),
  );
  if (!CONTAINER_USER_PATTERN.test(user)) {
    throw new Error("FORGEFLOW_EXECUTION_CONTAINER_USER must use numeric uid:gid");
  }

  return {
    name,
    runtime,
    image,
    network,
    cpus: resolvePositiveNumber(
      envValue(envSource, "FORGEFLOW_EXECUTION_CPUS"),
      DEFAULT_CONTAINER_CPUS,
      "FORGEFLOW_EXECUTION_CPUS",
    ),
    memory,
    pidsLimit: resolvePositiveInteger(
      envValue(envSource, "FORGEFLOW_EXECUTION_PIDS_LIMIT"),
      DEFAULT_CONTAINER_PIDS_LIMIT,
      "FORGEFLOW_EXECUTION_PIDS_LIMIT",
    ),
    user,
    workspaceDir: CONTAINER_WORKSPACE_DIR,
    homeDir: "/home/forgeflow",
    tempDir: "/tmp",
  };
}

export function executionProfilePolicyId(
  envSource: Record<string, string | undefined> = process.env,
): string {
  const profile = resolveExecutionProfile(envSource);
  if (profile.name === "trusted-host") {
    return "";
  }
  return `sha256:${crypto
    .createHash("sha256")
    .update(JSON.stringify(profile), "utf8")
    .digest("hex")}`;
}

function defaultProbe(command: string, args: string[]): ExecutionProfileProbeResult {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    timeout: 10_000,
  });
  return {
    status: result.status,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
    error: result.error,
  };
}

function probeDetails(result: ExecutionProfileProbeResult): string {
  return String(
    result.error?.message
    || result.stderr
    || result.stdout
    || "unknown error",
  ).trim();
}

export function assertExecutionProfileReady(
  profile: ExecutionProfile,
  probe: ExecutionProfileProbe = defaultProbe,
): void {
  if (profile.name === "trusted-host") {
    return;
  }

  const runtimeResult = probe(profile.runtime, [
    "version",
    "--format",
    "{{.Server.Version}}",
  ]);
  if ((runtimeResult.status ?? 1) !== 0) {
    throw new Error(
      `isolated execution profile blocked: container runtime unavailable (${probeDetails(runtimeResult)})`,
    );
  }

  const imageResult = probe(profile.runtime, ["image", "inspect", profile.image]);
  if ((imageResult.status ?? 1) !== 0) {
    throw new Error(
      `isolated execution profile blocked: container image unavailable (${profile.image}): ${probeDetails(imageResult)}`,
    );
  }
}

function providerSecretNames(provider?: string): string[] {
  if (provider === "codex") {
    return ["OPENAI_API_KEY"];
  }
  if (provider === "gemini") {
    return ["GEMINI_API_KEY"];
  }
  return [];
}

interface GitMetadataMount {
  source: string;
  target: string;
}

function containerPath(value: string): string {
  return value.split(path.sep).join(path.posix.sep);
}

function resolveGitMetadataMount(workspaceDir: string): GitMetadataMount | null {
  const markerPath = path.join(workspaceDir, ".git");
  if (!fs.existsSync(markerPath)) {
    return null;
  }
  if (fs.statSync(markerPath).isDirectory()) {
    return {
      source: fs.realpathSync(markerPath),
      target: `${CONTAINER_WORKSPACE_DIR}/.git`,
    };
  }
  const marker = fs.readFileSync(markerPath, "utf8").trim();
  const match = /^gitdir:\s*(.+)$/i.exec(marker);
  if (!match) {
    throw new Error(
      "isolated execution profile blocked: unsupported worktree .git pointer",
    );
  }
  const gitDirValue = match[1].trim();
  const gitDir = path.resolve(workspaceDir, gitDirValue);
  if (!fs.existsSync(gitDir)) {
    throw new Error(
      `isolated execution profile blocked: worktree git dir is missing (${gitDir})`,
    );
  }
  const commonDirPath = path.join(gitDir, "commondir");
  const commonDirValue = fs.existsSync(commonDirPath)
    ? fs.readFileSync(commonDirPath, "utf8").trim()
    : ".";
  const commonDir = path.resolve(gitDir, commonDirValue);
  if (!fs.existsSync(commonDir)) {
    throw new Error(
      `isolated execution profile blocked: git common dir is missing (${commonDir})`,
    );
  }
  const relativeGitDir = path.relative(commonDir, gitDir);
  if (relativeGitDir.startsWith("..") || path.isAbsolute(relativeGitDir)) {
    throw new Error(
      "isolated execution profile blocked: worktree git dir is outside its common dir",
    );
  }
  const containerGitDir = path.isAbsolute(gitDirValue)
    ? path.posix.normalize(containerPath(gitDirValue))
    : path.posix.resolve(
      CONTAINER_WORKSPACE_DIR,
      containerPath(gitDirValue),
    );
  const target = path.posix.resolve(
    containerGitDir,
    containerPath(commonDirValue),
  );
  if (target === "/" || target === CONTAINER_WORKSPACE_DIR) {
    throw new Error(
      "isolated execution profile blocked: unsafe git metadata mount target",
    );
  }
  return {
    source: fs.realpathSync(commonDir),
    target,
  };
}

export function applyExecutionProfile<T extends ExecutionProfileCommand>(
  command: T,
  profile: ExecutionProfile,
  options: {
    workspaceDir: string;
    provider?: string;
    envSource?: Record<string, string | undefined>;
  },
): T & { executionProfile: ExecutionProfileName } {
  if (profile.name === "trusted-host") {
    return {
      ...command,
      executionProfile: profile.name,
    };
  }

  const requestedWorkspaceDir = path.resolve(options.workspaceDir);
  let workspaceStat: fs.Stats;
  try {
    workspaceStat = fs.lstatSync(requestedWorkspaceDir);
  } catch {
    throw new Error(
      `isolated execution profile blocked: worktree is missing (${requestedWorkspaceDir})`,
    );
  }
  if (!workspaceStat.isDirectory() || workspaceStat.isSymbolicLink()) {
    throw new Error(
      "isolated execution profile blocked: worktree must be a real directory",
    );
  }
  const workspaceDir = fs.realpathSync(requestedWorkspaceDir);
  if (workspaceDir.includes(",")) {
    throw new Error(
      "isolated execution profile blocked: worktree path cannot contain a comma",
    );
  }
  const gitMetadataMount = resolveGitMetadataMount(workspaceDir);
  if (
    gitMetadataMount?.source.includes(",")
    || gitMetadataMount?.target.includes(",")
  ) {
    throw new Error(
      "isolated execution profile blocked: git metadata path cannot contain a comma",
    );
  }
  const envSource = options.envSource ?? process.env;
  const argv = [
    profile.runtime,
    "run",
    "--rm",
    "--init",
    "--network",
    profile.network,
    "--cpus",
    String(profile.cpus),
    "--memory",
    profile.memory,
    "--pids-limit",
    String(profile.pidsLimit),
    "--read-only",
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges=true",
    "--user",
    profile.user,
    "--workdir",
    profile.workspaceDir,
    "--mount",
    `type=bind,source=${workspaceDir},target=${profile.workspaceDir}`,
    "--tmpfs",
    `${profile.homeDir}:rw,nosuid,nodev,size=512m,mode=1777`,
    "--tmpfs",
    `${profile.tempDir}:rw,nosuid,nodev,size=1g,mode=1777`,
    "--env",
    `HOME=${profile.homeDir}`,
    "--env",
    `TMPDIR=${profile.tempDir}`,
    "--env",
    "GIT_OPTIONAL_LOCKS=0",
  ];
  if (gitMetadataMount) {
    argv.push(
      "--mount",
      `type=bind,source=${gitMetadataMount.source},target=${gitMetadataMount.target},readonly`,
    );
  }

  for (const name of providerSecretNames(options.provider)) {
    if (envValue(envSource, name)) {
      argv.push("--env", name);
    }
  }
  argv.push(profile.image, ...command.argv);

  return {
    ...command,
    argv,
    cwd: workspaceDir,
    executionProfile: profile.name,
  };
}
