import { describe, expect, it } from "vitest";

import { decomposeTask } from "../src/index.js";

const projectConfig = {
  project: {
    key: "repo-a",
    repo: "org/repo-a",
    default_branch: "main",
  },
  routing: {
    codex: ["apps/api/**", "packages/**"],
    gemini: ["apps/web/**"],
  },
  commands: {
    test: "pnpm test",
  },
  governance: {
    branch_prefix: "ai",
    require_review: true,
    require_checks: true,
  },
  worktree: {
    root_dir: ".worktrees",
    branch_template: "ai/{pool}/{task_id}-{slug}",
    sync_from_default_branch: true,
  },
  observability: {
    enabled: true,
    retain_days: 14,
  },
  providers: {
    enabled: ["codex", "gemini"],
    permissions: {
      codex: { sandbox: "workspace-write" },
      gemini: {},
    },
  },
} as const;

describe("decomposeTask", () => {
  it("produces structured tasks from summary and project config", () => {
    const tasks = decomposeTask({
      summary: "Implement login page and auth API",
      taskType: "feature",
      projectConfig,
    });

    expect(tasks.length).toBeGreaterThan(1);
  });

  it("routes frontend work to gemini", () => {
    const tasks = decomposeTask({
      summary: "Build a Vue login page",
      taskType: "feature",
      projectConfig,
    });

    expect(tasks[0]?.pool).toBe("gemini");
  });

  it("routes backend work to codex", () => {
    const tasks = decomposeTask({
      summary: "Implement auth API and token validation",
      taskType: "feature",
      projectConfig,
    });

    expect(tasks[0]?.pool).toBe("codex");
  });

  it("adds allowed paths and verification metadata", () => {
    const tasks = decomposeTask({
      summary: "Build a Vue login page",
      taskType: "feature",
      projectConfig,
    });

    expect(tasks[0]?.allowedPaths).toEqual(["apps/web/**"]);
    expect(tasks[0]?.verification.mode).toBe("run");
  });
});
