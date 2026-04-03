// @ts-nocheck
import { startTraeAutomationGateway } from "./trae-automation-gateway.js";

function parseArgs(argv) {
  const args = {
    host: "127.0.0.1",
    port: 8790,
    debug: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === "--host" && next) {
      args.host = next;
      index += 1;
      continue;
    }
    if (arg === "--port" && next) {
      args.port = Number(next);
      index += 1;
      continue;
    }
    if (arg === "--debug") {
      args.debug = true;
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
  node packages/trae-beta-runtime/dist/runtime/run-trae-automation-gateway.js \\
    [--host 127.0.0.1] \\
    [--port 8790] \\
    [--debug]
`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const instance = await startTraeAutomationGateway({
    ...args,
    logger: console,
  });
  console.log(JSON.stringify({
    status: "listening",
    host: instance.host,
    port: instance.port,
    baseUrl: instance.baseUrl,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
