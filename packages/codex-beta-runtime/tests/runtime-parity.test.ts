import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "../../..",
);

function readRuntimeSource(packageName: string, relativePath: string): string {
  // 这些 runtime 文件是刻意保持一致的发布侧控制逻辑，测试负责阻止单边漂移。
  return fs.readFileSync(path.join(repoRoot, "packages", packageName, "src", "runtime", relativePath), "utf8");
}

describe("beta runtime shared source parity", () => {
  it("keeps worker daemon delivery and env handling in sync", () => {
    expect(readRuntimeSource("gemini-beta-runtime", "worker-daemon.ts")).toBe(
      readRuntimeSource("codex-beta-runtime", "worker-daemon.ts"),
    );
  });

  it("keeps task worktree handling in sync", () => {
    expect(readRuntimeSource("gemini-beta-runtime", "task-worktree.ts")).toBe(
      readRuntimeSource("codex-beta-runtime", "task-worktree.ts"),
    );
  });
});
