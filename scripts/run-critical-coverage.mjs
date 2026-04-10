import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const coverageRoot = path.join(repoRoot, "coverage");

const runs = [
  {
    cwd: path.join(repoRoot, "apps/dispatcher"),
    reportsDir: path.join(coverageRoot, "dispatcher"),
    args: [
      "run",
      "tests/modules/server/runtime-state.test.ts",
      "tests/modules/server/runtime-state-sqlite.test.ts",
      "tests/modules/server/dispatcher-server.test.ts",
    ],
  },
  {
    cwd: path.join(repoRoot, "packages/trae-beta-runtime"),
    reportsDir: path.join(coverageRoot, "trae-beta-runtime"),
    args: ["run"],
  },
  {
    cwd: path.join(repoRoot, "packages/worker-review-orchestrator-cli"),
    reportsDir: path.join(coverageRoot, "worker-review-orchestrator-cli"),
    args: ["run"],
  },
];

fs.rmSync(coverageRoot, { recursive: true, force: true });

for (const run of runs) {
  execFileSync(
    "pnpm",
    [
      "exec",
      "vitest",
      ...run.args,
      "--coverage",
      "--coverage.reportsDirectory",
      run.reportsDir,
    ],
    {
      cwd: run.cwd,
      stdio: "inherit",
    },
  );
}
