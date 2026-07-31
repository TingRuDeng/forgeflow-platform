import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const safeTaskDirName = (taskId: unknown) => {
  const rawTaskId = String(taskId || "").trim();
  const readableName = rawTaskId
    .replace(/[^\p{L}\p{N}._-]+/gu, "-")
    .replace(/^-+|-+$/g, "");
  if (!readableName || readableName === "." || readableName === "..") {
    return readableName;
  }
  if (rawTaskId === readableName && [...readableName].length <= 48) {
    return readableName;
  }
  const readablePrefix = [...readableName].slice(0, 48).join("");
  const identityHash = createHash("sha256").update(rawTaskId).digest("hex").slice(0, 12);
  return `${readablePrefix}-${identityHash}`;
};

describe("task-worktree.ts", () => {
  describe("safeTaskDirName", () => {
    it("converts a simple task ID to directory-safe name", () => {
      expect(safeTaskDirName("TASK-001")).toBe("TASK-001");
    });

    it("replaces spaces with hyphens and strips leading/trailing", () => {
      expect(safeTaskDirName("  TASK  001  ")).toMatch(/^TASK-001-[0-9a-f]{12}$/);
      expect(safeTaskDirName("my task id")).toMatch(/^my-task-id-[0-9a-f]{12}$/);
    });

    it("converts multiple consecutive spaces to single hyphen", () => {
      expect(safeTaskDirName("task   001")).toMatch(/^task-001-[0-9a-f]{12}$/);
      expect(safeTaskDirName("a  b  c")).toMatch(/^a-b-c-[0-9a-f]{12}$/);
    });

    it("handles unicode characters", () => {
      expect(safeTaskDirName("任务-001")).toBe("任务-001");
      expect(safeTaskDirName("Tâsk-001")).toBe("Tâsk-001");
    });

    it("removes invalid characters except allowed set", () => {
      expect(safeTaskDirName("task:001?bar")).toMatch(/^task-001-bar-[0-9a-f]{12}$/);
      expect(safeTaskDirName("task#001@foo")).toMatch(/^task-001-foo-[0-9a-f]{12}$/);
      expect(safeTaskDirName("a/b")).not.toBe(safeTaskDirName("a b"));
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
      expect(safeTaskDirName("---task")).toMatch(/^task-[0-9a-f]{12}$/);
    });

    it("strips trailing hyphens", () => {
      expect(safeTaskDirName("task---")).toMatch(/^task-[0-9a-f]{12}$/);
    });
  });
});
