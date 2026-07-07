import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const DEPRECATED_PATHS = [
  "scripts/start-staging-dispatcher.sh",
  "scripts/start-staging-trae-gateway.sh",
  "scripts/start-staging-trae-launch.sh",
  "scripts/start-staging-trae-worker.sh",
  "scripts/trigger-ai-dispatch.ts",
  "scripts/trigger-ai-dispatch.js",
  "scripts/run-codex-control-flow.ts",
  "scripts/run-codex-control-flow.js",
];

export function findDeprecatedEntryPoints(options = {}) {
  const cwd = options.cwd ?? process.cwd();
  return DEPRECATED_PATHS.filter((file) => fs.existsSync(path.join(cwd, file)));
}

function writeJson(write, payload) {
  write(JSON.stringify(payload, null, 2));
}

export function runDeprecatedEntryPointCheck(options = {}) {
  const existing = findDeprecatedEntryPoints({ cwd: options.cwd });
  if (existing.length > 0) {
    writeJson(options.stderr ?? console.error, {
      ok: false,
      deprecatedEntryPointsStillPresent: existing,
    });
    return 1;
  }

  writeJson(options.stdout ?? console.log, {
    ok: true,
    checked: DEPRECATED_PATHS,
  });
  return 0;
}

const entryPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === entryPath) {
  process.exitCode = runDeprecatedEntryPointCheck();
}
