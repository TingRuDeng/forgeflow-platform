import { describe, expect, it } from "vitest";

import {
  ProjectConfigSchema,
  ReviewFindingSchema,
  RunResultSchema,
} from "../src/index.js";

describe("ProjectConfigSchema", () => {
  it("fails when project.repo is missing", () => {
    const result = ProjectConfigSchema.safeParse({
      project: {
        key: "repo-a",
        default_branch: "main",
      },
      routing: {
        codex: ["apps/api/**"],
      },
      commands: {
        test: "pnpm test",
      },
      governance: {},
    });

    expect(result.success).toBe(false);
  });

  it("fails when routing is missing", () => {
    const result = ProjectConfigSchema.safeParse({
      project: {
        key: "repo-a",
        repo: "org/repo-a",
        default_branch: "main",
      },
      commands: {
        test: "pnpm test",
      },
      governance: {},
    });

    expect(result.success).toBe(false);
  });

  it("applies defaults for worktree and observability", () => {
    const result = ProjectConfigSchema.parse({
      project: {
        key: "repo-a",
        repo: "org/repo-a",
        default_branch: "main",
      },
      routing: {
        codex: ["apps/api/**"],
        gemini: ["apps/web/**"],
      },
      commands: {
        test: "pnpm test",
      },
      governance: {},
    });

    expect(result.worktree.root_dir).toBe(".worktrees");
    expect(result.observability.enabled).toBe(true);
  });
});

describe("Result contracts", () => {
  it("fails when run result misses required fields", () => {
    const result = RunResultSchema.safeParse({
      command: "run",
      task_id: "task-1",
    });

    expect(result.success).toBe(false);
  });

  it("fails when review finding misses required evidence", () => {
    const result = ReviewFindingSchema.safeParse({
      severity: "high",
      category: "bug",
      title: "Missing guard",
    });

    expect(result.success).toBe(false);
  });
});
