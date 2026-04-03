// @ts-nocheck
import { launchTraeForAutomation } from "./trae-launcher.js";

function parseArgs(argv) {
  const args = {
    traeBin: "",
    projectPath: "",
    remoteDebuggingPort: undefined,
    timeoutMs: undefined,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === "--trae-bin" && next) {
      args.traeBin = next;
      index += 1;
      continue;
    }
    if (arg === "--project-path" && next) {
      args.projectPath = next;
      index += 1;
      continue;
    }
    if (arg === "--remote-debugging-port" && next) {
      args.remoteDebuggingPort = Number(next);
      index += 1;
      continue;
    }
    if (arg === "--timeout-ms" && next) {
      args.timeoutMs = Number(next);
      index += 1;
      continue;
    }
    if (arg === "--help") {
      args.help = true;
      continue;
    }

    throw new Error(`unknown argument: ${arg}`);
  }

  return args;
}

function printHelp() {
  console.log(`
Usage:
  node packages/trae-beta-runtime/dist/runtime/run-trae-automation-launch.js \\
    --trae-bin /Applications/Trae.app \\
    --project-path /abs/path/to/repo \\
    [--remote-debugging-port 9222] \\
    [--timeout-ms 15000]
`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const result = await launchTraeForAutomation(args);
  console.log(JSON.stringify({
    status: "ready",
    command: result.command,
    args: result.args,
    projectPath: result.projectPath,
    remoteDebuggingPort: result.remoteDebuggingPort,
    target: result.debuggerInfo?.target
      ? {
          id: result.debuggerInfo.target.id,
          title: result.debuggerInfo.target.title,
          url: result.debuggerInfo.target.url,
        }
      : null,
    browser: result.debuggerInfo?.version?.Browser || null,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
