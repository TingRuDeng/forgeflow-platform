import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import packageJson from "../package.json" with { type: "json" };
import {
  buildDefaultConfig,
  loadConfig,
  saveConfig,
  secureConfigPermissions,
  type DispatcherAuthMode,
  type DispatcherRuntimeConfig,
  type PersistenceBackend,
} from "./config.ts";
import { backupRuntimeState, restoreRuntimeState } from "./backup.ts";
import { runDoctor, getStatus } from "./doctor.ts";
import { startDispatcher } from "./dispatcher.ts";

const __filename = fileURLToPath(import.meta.url);

type Command = "init" | "start" | "doctor" | "status" | "backup" | "restore" | "version";
type ParsedArgs = {
  command: Command;
  options: Record<string, string | boolean>;
};

export interface CliDeps {
  readStdin: () => string;
}

function parseCliArgs(argv: string[]): ParsedArgs {
  const [command, ...rest] = argv;
  if (!command) {
    throw new Error("command is required");
  }
  if (!["init", "start", "doctor", "status", "backup", "restore", "version"].includes(command)) {
    throw new Error(`unknown command: ${command}`);
  }

  const options: Record<string, string | boolean> = {};
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (!arg || !arg.startsWith("--")) {
      throw new Error(`unknown argument: ${arg}`);
    }
    const key = arg.slice(2).replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());
    const next = rest[index + 1];
    if (!next || next.startsWith("--")) {
      options[key] = true;
      continue;
    }
    options[key] = next;
    index += 1;
  }

  return {
    command: command as Command,
    options,
  };
}

function printHelp() {
  console.log(`
Usage:
  forgeflow-dispatcher init [--host 127.0.0.1] [--port 8787] [--state-dir ~/.forgeflow-dispatcher/state] [--persistence-backend sqlite|json] [--auth-mode token|legacy|open] [--token-stdin]
  forgeflow-dispatcher start [--host <host>] [--port <port>] [--state-dir <dir>] [--persistence-backend sqlite|json] [--auth-mode token|legacy|open] [--token-stdin]
  forgeflow-dispatcher doctor
  forgeflow-dispatcher status
  forgeflow-dispatcher backup [--backup-dir <dir>]
  forgeflow-dispatcher restore --backup-dir <dir>
  forgeflow-dispatcher version
`);
}

function resolveConfig(
  options: Record<string, string | boolean>,
  stdinToken?: string,
): DispatcherRuntimeConfig {
  const config = loadConfig();
  const next: DispatcherRuntimeConfig = { ...config };

  if (typeof options.host === "string") {
    next.host = options.host;
  }
  if (typeof options.port === "string") {
    next.port = Number(options.port);
  }
  if (typeof options.stateDir === "string") {
    next.stateDir = options.stateDir;
  }
  if (typeof options.persistenceBackend === "string") {
    next.persistenceBackend = options.persistenceBackend as PersistenceBackend;
  }
  if (typeof options.authMode === "string") {
    next.authMode = options.authMode as DispatcherAuthMode;
  }
  if (stdinToken) {
    next.apiToken = stdinToken;
  }

  return next;
}

async function runInit(options: Record<string, string | boolean>, stdinToken?: string) {
  secureConfigPermissions();
  const next = {
    ...buildDefaultConfig(),
    ...resolveConfig(options, stdinToken),
  };
  const configPath = saveConfig(next);
  console.log(JSON.stringify({
    status: "saved",
    configPath,
    host: next.host,
    port: next.port,
    stateDir: next.stateDir,
    persistenceBackend: next.persistenceBackend,
    authMode: next.authMode,
    tokenConfigured: Boolean(next.apiToken),
  }, null, 2));
}

async function runBackup(options: Record<string, string | boolean>) {
  const config = resolveConfig(options);
  const backupDir = typeof options.backupDir === "string"
    ? options.backupDir
    : path.join(config.stateDir, "backups", new Date().toISOString().replace(/[:]/g, "-"));
  const result = await backupRuntimeState({
    stateDir: config.stateDir,
    backupDir,
  });
  console.log(JSON.stringify(result, null, 2));
}

async function runRestore(options: Record<string, string | boolean>) {
  const config = resolveConfig(options);
  if (typeof options.backupDir !== "string") {
    throw new Error("--backup-dir is required for restore");
  }
  const result = await restoreRuntimeState({
    backupDir: options.backupDir,
    stateDir: config.stateDir,
  });
  console.log(JSON.stringify(result, null, 2));
}

export async function runCli(argv: string[], partialDeps: Partial<CliDeps> = {}) {
  const deps: CliDeps = {
    readStdin: () => fs.readFileSync(0, "utf8"),
    ...partialDeps,
  };
  const parsed = parseCliArgs(argv);
  if (parsed.options.help === true) {
    printHelp();
    return;
  }

  if (parsed.command === "version") {
    console.log(packageJson.version);
    return;
  }

  if (parsed.options.token !== undefined) {
    throw new Error("--token is not supported because process arguments may be exposed; pipe the token through --token-stdin");
  }
  if (parsed.options.tokenStdin !== undefined && parsed.options.tokenStdin !== true) {
    throw new Error("--token-stdin does not accept a value");
  }
  if (parsed.options.tokenStdin === true && parsed.command !== "init" && parsed.command !== "start") {
    throw new Error("--token-stdin is only supported by init and start");
  }
  const stdinToken = parsed.options.tokenStdin === true ? deps.readStdin().trim() : undefined;
  if (parsed.options.tokenStdin === true && !stdinToken) {
    throw new Error("--token-stdin requires a non-empty token on stdin");
  }

  if (parsed.command === "init") {
    await runInit(parsed.options, stdinToken);
    return;
  }

  if (parsed.command === "doctor") {
    console.log(JSON.stringify(await runDoctor(resolveConfig(parsed.options)), null, 2));
    return;
  }

  if (parsed.command === "status") {
    console.log(JSON.stringify(await getStatus(resolveConfig(parsed.options)), null, 2));
    return;
  }

  if (parsed.command === "backup") {
    await runBackup(parsed.options);
    return;
  }

  if (parsed.command === "restore") {
    await runRestore(parsed.options);
    return;
  }

  if (parsed.command === "start") {
    await startDispatcher(resolveConfig(parsed.options, stdinToken));
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  runCli(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
