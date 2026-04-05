import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const safeTaskDirName = (taskId: unknown) =>
  String(taskId || "")
    .replace(/[^\p{L}\p{N}._-]+/gu, "-")
    .replace(/^-+|-+$/g, "");

describe("task-worktree.ts", () => {
  describe("safeTaskDirName", () => {
    it("converts a simple task ID to directory-safe name", () => {
      expect(safeTaskDirName("TASK-001")).toBe("TASK-001");
    });

    it("replaces spaces with hyphens and strips leading/trailing", () => {
      expect(safeTaskDirName("  TASK  001  ")).toBe("TASK-001");
      expect(safeTaskDirName("my task id")).toBe("my-task-id");
    });

    it("converts multiple consecutive spaces to single hyphen", () => {
      expect(safeTaskDirName("task   001")).toBe("task-001");
      expect(safeTaskDirName("a  b  c")).toBe("a-b-c");
    });

    it("handles unicode characters", () => {
      expect(safeTaskDirName("任务-001")).toBe("任务-001");
      expect(safeTaskDirName("Tâsk-001")).toBe("Tâsk-001");
    });

    it("removes invalid characters except allowed set", () => {
      expect(safeTaskDirName("task:001?bar")).toBe("task-001-bar");
      expect(safeTaskDirName("task#001@foo")).toBe("task-001-foo");
    });

    it("preserves dots, underscores, and hyphens", () => {
      expect(safeTaskDirName("task_001")).toBe("task_001");
      expect(safeTaskDirName("task-001")).toBe("task-001");
      expect(safeTaskDirName("task.001")).toBe("task.001");
    });

    it("handles empty input", () => {
      expect(safeTaskDirName("")).toBe("");
      expect(safeTaskDirName(null)).toBe("");
      expect(safeTaskDirName(undefined)).toBe("");
    });

    it("handles numeric input", () => {
      expect(safeTaskDirName(12345)).toBe("12345");
      expect(safeTaskDirName(0)).toBe("");
    });

    it("strips leading hyphens", () => {
      expect(safeTaskDirName("---task")).toBe("task");
    });

    it("strips trailing hyphens", () => {
      expect(safeTaskDirName("task---")).toBe("task");
    });
  });
});
