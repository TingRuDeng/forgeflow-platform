import fs from "node:fs";

const DEPRECATED_PATHS = [
  "scripts/start-staging-dispatcher.sh",
  "scripts/start-staging-trae-gateway.sh",
  "scripts/start-staging-trae-launch.sh",
  "scripts/start-staging-trae-worker.sh",
  "scripts/trigger-ai-dispatch.ts",
  "scripts/trigger-ai-dispatch.js",
  "scripts/run-codex-control-flow.ts",
  "scripts/run-codex-control-flow.js",
];

const existing = DEPRECATED_PATHS.filter((file) => fs.existsSync(file));
if (existing.length > 0) {
  console.error(JSON.stringify({
    ok: false,
    deprecatedEntryPointsStillPresent: existing,
  }, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({
  ok: true,
  checked: DEPRECATED_PATHS,
}, null, 2));
