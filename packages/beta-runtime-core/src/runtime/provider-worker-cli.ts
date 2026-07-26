import { runWorkerDaemon, type RunWorkerDaemonInput, type RunWorkerDaemonCycleResult } from "./worker-daemon.js";
import {
  assertExecutionProfileReady,
  executionProfilePolicyId,
  resolveExecutionProfile,
  type ExecutionProfileProbe,
} from "./execution-profile.js";

export interface ProviderWorkerCliConfig {
  pool: string;
  binFlag: string;
  binEnv: string;
  exampleWorkerId: string;
  exampleLabels: string;
}

export interface ProviderWorkerCliArgs {
  dispatcherUrl?: string;
  workerId?: string;
  pool?: string;
  repoDir?: string;
  hostname?: string;
  labels?: string[];
  providerBin?: string;
  executionPolicyId?: string;
  pollIntervalMs: number;
  dryRunExecution: boolean;
  once: boolean;
  help?: boolean;
}

export interface ProviderWorkerCliDeps {
  env?: Record<string, string | undefined>;
  writeStdout?: (value: string) => void;
  runWorkerDaemon?: (input: RunWorkerDaemonInput) => Promise<RunWorkerDaemonCycleResult>;
  executionProfileProbe?: ExecutionProfileProbe;
}

type StringArgKey =
  | "dispatcherUrl"
  | "workerId"
  | "pool"
  | "repoDir"
  | "hostname"
  | "executionPolicyId";

const STRING_FLAGS: Record<string, StringArgKey> = {
  "--dispatcher-url": "dispatcherUrl",
  "--worker-id": "workerId",
  "--pool": "pool",
  "--repo-dir": "repoDir",
  "--hostname": "hostname",
  "--execution-policy-id": "executionPolicyId",
};

function readNext(argv: string[], index: number, flag: string): string {
  const next = argv[index + 1];
  if (!next) {
    throw new Error(`${flag} requires a value`);
  }
  return next;
}

function assignStringArg(args: ProviderWorkerCliArgs, key: StringArgKey, value: string): void {
  args[key] = value;
}

export function parseProviderWorkerCliArgs(argv: string[], config: ProviderWorkerCliConfig): ProviderWorkerCliArgs {
  const args: ProviderWorkerCliArgs = { pollIntervalMs: 5000, dryRunExecution: false, once: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg in STRING_FLAGS) {
      assignStringArg(args, STRING_FLAGS[arg], readNext(argv, index, arg));
      index += 1;
    } else if (arg === "--labels") {
      args.labels = readNext(argv, index, arg).split(",").map((item) => item.trim()).filter(Boolean);
      index += 1;
    } else if (arg === config.binFlag) {
      args.providerBin = readNext(argv, index, arg);
      index += 1;
    } else if (arg === "--poll-interval-ms") {
      args.pollIntervalMs = Number(readNext(argv, index, arg));
      index += 1;
    } else if (arg === "--dry-run-execution") {
      args.dryRunExecution = true;
    } else if (arg === "--once") {
      args.once = true;
    } else if (arg === "--help") {
      args.help = true;
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  return args;
}

export function formatProviderWorkerCliHelp(config: ProviderWorkerCliConfig): string {
  return `
Usage:
  node dist/runtime/worker.js \\
    --dispatcher-url http://127.0.0.1:8787 \\
    --worker-id ${config.exampleWorkerId} \\
    --pool ${config.pool} \\
    --repo-dir /abs/path/to/repo \\
    [${config.binFlag} ${config.pool}] \\
    [--hostname mac-mini] \\
    [--labels ${config.exampleLabels}] \\
    [--execution-policy-id <sha256>] (managed wrapper internal) \\
    [--poll-interval-ms 5000] \\
    [--dry-run-execution] \\
    [--once]
`;
}

function requireArg(args: ProviderWorkerCliArgs, key: StringArgKey, flag: string): string {
  const value = args[key];
  if (!value) {
    throw new Error(`${flag} is required`);
  }
  return value;
}

export async function runProviderWorkerCli(
  argv: string[],
  config: ProviderWorkerCliConfig,
  deps: ProviderWorkerCliDeps = {},
): Promise<void> {
  const args = parseProviderWorkerCliArgs(argv, config);
  const writeStdout = deps.writeStdout ?? ((value) => process.stdout.write(value));
  if (args.help) {
    writeStdout(formatProviderWorkerCliHelp(config));
    return;
  }

  const dispatcherUrl = requireArg(args, "dispatcherUrl", "--dispatcher-url");
  const workerId = requireArg(args, "workerId", "--worker-id");
  const pool = requireArg(args, "pool", "--pool");
  const repoDir = requireArg(args, "repoDir", "--repo-dir");
  if (pool !== config.pool) {
    throw new Error(`--pool must be ${config.pool}`);
  }

  if (args.providerBin) {
    (deps.env ?? process.env)[config.binEnv] = args.providerBin;
  }
  const executionEnv = deps.env ?? process.env;
  const actualPolicyId = executionProfilePolicyId(executionEnv);
  if (args.executionPolicyId && args.executionPolicyId !== actualPolicyId) {
    throw new Error(
      "execution policy id does not match the worker environment; restart with the current execution profile",
    );
  }
  assertExecutionProfileReady(
    resolveExecutionProfile(executionEnv),
    deps.executionProfileProbe,
  );
  const runDaemon = deps.runWorkerDaemon ?? runWorkerDaemon;
  const abortController = deps.runWorkerDaemon ? null : new AbortController();
  const stop = () => abortController?.abort();
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  let summary: RunWorkerDaemonCycleResult;
  try {
    summary = await runDaemon({
      dispatcherUrl,
      workerId,
      pool,
      repoDir,
      hostname: args.hostname,
      labels: args.labels,
      pollIntervalMs: args.pollIntervalMs,
      dryRunExecution: args.dryRunExecution,
      once: args.once,
      ...(abortController ? { signal: abortController.signal } : {}),
    });
  } finally {
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
  }
  writeStdout(`${JSON.stringify(summary, null, 2)}\n`);
}
