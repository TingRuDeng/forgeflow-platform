import { describe, it, expect } from "vitest";
import {
  createMemoryStore,
  extractLessonFromReview,
  extractLessonFromFailed,
  extractLessonFromRework,
  shouldInjectLesson,
  filterLessonsForInjection,
  injectLessonsIntoContext,
  type Lesson,
  type Finding,
  type WorkerEvidence,
  type ReviewEvidence,
  type LessonCriteria,
} from "./review-memory.js";

describe("review-memory.ts", () => {
  describe("createMemoryStore", () => {
    it("creates empty memory store with default values", () => {
      const store = createMemoryStore();
      expect(store.version).toBe(1);
      expect(store.lessons).toEqual([]);
      expect(store.updated_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}[+-]\d{2}:\d{2}$/);
    });

    it("creates memory store with provided lessons", () => {
      const lessons: Lesson[] = [
        {
          id: "lesson-1",
          source_type: "review",
          source_task_id: "TASK-001",
          source_worker_type: "trae",
          repo: "org/repo",
          scope: "src/",
          category: "security",
          rule: "Use parameterized queries",
          rationale: "Prevent SQL injection",
          trigger_paths: ["src/**"],
          trigger_tags: ["security"],
          severity: "critical",
          created_at: "2024-01-01T00:00:00.000+00:00",
        },
      ];
      const store = createMemoryStore(lessons);
      expect(store.lessons).toHaveLength(1);
      expect(store.lessons[0].id).toBe("lesson-1");
    });
  });

  describe("extractLessonFromReview", () => {
    const validFinding: Finding = {
      title: "SQL Injection Risk",
      recommendation: "always use parameterized queries to prevent SQL injection",
      severity: "critical",
      category: "security",
      evidence: { file: "src/database/query.ts" },
    };

    it("extracts lesson from valid review finding with blocked decision", () => {
      const lesson = extractLessonFromReview("TASK-001", "trae", "org/repo", validFinding, "blocked");
      expect(lesson).not.toBeNull();
      expect(lesson!.source_type).toBe("review");
      expect(lesson!.source_task_id).toBe("TASK-001");
      expect(lesson!.source_worker_type).toBe("trae");
      expect(lesson!.repo).toBe("org/repo");
      expect(lesson!.rule).toBe("SQL Injection Risk");
    });

    it("extracts lesson from valid review finding with merge decision", () => {
      const finding: Finding = {
        title: "Structure issue",
        recommendation: "always prefer composition over inheritance",
        severity: "warning",
        category: "structure",
      };
      const lesson = extractLessonFromReview("TASK-001", "trae", "org/repo", finding, "merge");
      expect(lesson).not.toBeNull();
      expect(lesson!.source_type).toBe("review");
    });

    it("returns null for non-extractable finding (short recommendation)", () => {
      const nonExtractable: Finding = {
        title: "Minor issue",
        recommendation: "fix it",
        severity: "critical",
        category: "security",
      };
      expect(extractLessonFromReview("TASK-001", "trae", "org/repo", nonExtractable, "blocked")).toBeNull();
    });

    it("returns null for blocked finding without valid severity", () => {
      const finding: Finding = {
        title: "Issue",
        recommendation: "always fix this",
        category: "security",
      };
      expect(extractLessonFromReview("TASK-001", "trae", "org/repo", finding, "blocked")).toBeNull();
    });

    it("returns null for merge finding without valid category", () => {
      const finding: Finding = {
        title: "Issue",
        recommendation: "always fix this",
        severity: "critical",
        category: "other",
      };
      expect(extractLessonFromReview("TASK-001", "trae", "org/repo", finding, "merge")).toBeNull();
    });

    it("returns null for unknown decision", () => {
      expect(extractLessonFromReview("TASK-001", "trae", "org/repo", validFinding, "unknown")).toBeNull();
    });

    it("infers category from title/recommendation content", () => {
      const finding: Finding = {
        title: "Security issue",
        recommendation: "always prevent XSS",
        severity: "critical",
        category: "security",
      };
      const lesson = extractLessonFromReview("TASK-001", "trae", "org/repo", finding, "blocked");
      expect(lesson!.category).toBe("security");
    });

    it("infers trigger paths from evidence file", () => {
      const lesson = extractLessonFromReview("TASK-001", "trae", "org/repo", validFinding, "blocked");
      expect(lesson!.trigger_paths).toContain("src/database/**");
      expect(lesson!.trigger_paths).toContain("src/database/query.ts");
    });
  });

  describe("extractLessonFromFailed", () => {
    it("extracts lesson from evidence with test error pattern", () => {
      const evidence: WorkerEvidence = {
        failureType: "execution",
        failureSummary: "test timeout after 30 seconds",
      };
      const lesson = extractLessonFromFailed("TASK-001", "trae", "org/repo", evidence);
      expect(lesson).not.toBeNull();
      expect(lesson!.source_type).toBe("failed");
      expect(lesson!.category).toBe("testing");
    });

    it("extracts lesson from evidence with verification error pattern", () => {
      const evidence: WorkerEvidence = {
        failureType: "verification",
        failureSummary: "verification failed: assertion error",
      };
      const lesson = extractLessonFromFailed("TASK-001", "trae", "org/repo", evidence);
      expect(lesson).not.toBeNull();
      expect(lesson!.category).toBe("testing");
    });

    it("extracts lesson from evidence with runtime error patterns", () => {
      const evidence: WorkerEvidence = {
        failureType: "execution",
        failureSummary: "connection timeout occurred",
      };
      const lesson = extractLessonFromFailed("TASK-001", "trae", "org/repo", evidence);
      expect(lesson).not.toBeNull();
      expect(lesson!.category).toBe("runtime");
    });

    it("returns null when no failure type", () => {
      const evidence: WorkerEvidence = {
        failureSummary: "some error",
      };
      expect(extractLessonFromFailed("TASK-001", "trae", "org/repo", evidence)).toBeNull();
    });

    it("returns null when no failure summary", () => {
      const evidence: WorkerEvidence = {
        failureType: "execution",
      };
      expect(extractLessonFromFailed("TASK-001", "trae", "org/repo", evidence)).toBeNull();
    });

    it("returns null for unknown error patterns", () => {
      const evidence: WorkerEvidence = {
        failureType: "execution",
        failureSummary: "some unknown error happened",
      };
      expect(extractLessonFromFailed("TASK-001", "trae", "org/repo", evidence)).toBeNull();
    });
  });

  describe("extractLessonFromRework", () => {
    it("extracts lesson from rework with mustFix items", () => {
      const evidence: ReviewEvidence = {
        mustFix: ["CVE-2024-1234", "CVE-2024-5678"],
        reasonCode: "SECURITY",
      };
      const lesson = extractLessonFromRework("TASK-001", "trae", "org/repo", evidence);
      expect(lesson).not.toBeNull();
      expect(lesson!.source_type).toBe("rework");
      expect(lesson!.rationale).toBe("CVE-2024-1234; CVE-2024-5678");
      expect(lesson!.category).toBe("process");
      expect(lesson!.severity).toBe("info");
    });

    it("extracts lesson from rework with only reasonCode", () => {
      const evidence: ReviewEvidence = {
        reasonCode: "NEEDS_IMPROVEMENT",
      };
      const lesson = extractLessonFromRework("TASK-001", "trae", "org/repo", evidence);
      expect(lesson).not.toBeNull();
      expect(lesson!.rationale).toBe("NEEDS_IMPROVEMENT");
    });

    it("returns null when no mustFix and no reasonCode", () => {
      const evidence: ReviewEvidence = {};
      expect(extractLessonFromRework("TASK-001", "trae", "org/repo", evidence)).toBeNull();
    });
  });

  describe("shouldInjectLesson", () => {
    const lesson: Lesson = {
      id: "lesson-1",
      source_type: "review",
      source_task_id: "TASK-001",
      source_worker_type: "Trae",
      repo: "org/repo",
      scope: "src/utils/helper.ts",
      category: "security",
      rule: "Use parameterized queries",
      rationale: "Prevent SQL injection",
      trigger_paths: ["src/utils/**", "src/utils/helper.ts"],
      trigger_tags: ["security"],
      severity: "critical",
      created_at: "2024-01-01T00:00:00.000+00:00",
    };

    it("returns false when repo does not match", () => {
      const criteria: LessonCriteria = { repo: "other/repo" };
      expect(shouldInjectLesson(lesson, criteria)).toBe(false);
    });

    it("returns true when repo AND scope match", () => {
      const criteria: LessonCriteria = { repo: "org/repo", scope: "src/utils/helper.ts" };
      expect(shouldInjectLesson(lesson, criteria)).toBe(true);
    });

    it("returns true when repo AND category match", () => {
      const criteria: LessonCriteria = { repo: "org/repo", category: "security" };
      expect(shouldInjectLesson(lesson, criteria)).toBe(true);
    });

    it("returns true when repo AND worker_type match (case insensitive)", () => {
      const criteria: LessonCriteria = { repo: "org/repo", worker_type: "trae" };
      expect(shouldInjectLesson(lesson, criteria)).toBe(true);
    });

    it("returns false when repo matches but no other criteria", () => {
      const criteria: LessonCriteria = { repo: "org/repo" };
      expect(shouldInjectLesson(lesson, criteria)).toBe(false);
    });

    it("returns false when scope does not match", () => {
      const criteria: LessonCriteria = { repo: "org/repo", scope: "unrelated/path.ts" };
      expect(shouldInjectLesson(lesson, criteria)).toBe(false);
    });

    it("handles array scope criteria", () => {
      const criteria: LessonCriteria = { repo: "org/repo", scope: ["other/path.ts", "src/utils/helper.ts"] };
      expect(shouldInjectLesson(lesson, criteria)).toBe(true);
    });

    it("matches scope with glob pattern", () => {
      const criteria: LessonCriteria = { repo: "org/repo", scope: "src/utils" };
      expect(shouldInjectLesson(lesson, criteria)).toBe(true);
    });

    it("matches scope with trailing slash variation", () => {
      const criteria: LessonCriteria = { repo: "org/repo", scope: "src/utils/" };
      expect(shouldInjectLesson(lesson, criteria)).toBe(true);
    });

    it("handles wildcard scope", () => {
      const criteria: LessonCriteria = { repo: "org/repo", scope: "src/**" };
      expect(shouldInjectLesson(lesson, criteria)).toBe(true);
    });
  });

  describe("filterLessonsForInjection", () => {
    const lessons: Lesson[] = [
      {
        id: "lesson-1",
        source_type: "review",
        source_task_id: "TASK-001",
        source_worker_type: "trae",
        repo: "org/repo",
        scope: "src/a.ts",
        category: "security",
        rule: "Rule 1",
        rationale: "Rationale 1",
        trigger_paths: ["src/a.ts"],
        trigger_tags: [],
        severity: "info",
        created_at: "2024-01-01T00:00:00.000+00:00",
      },
      {
        id: "lesson-2",
        source_type: "review",
        source_task_id: "TASK-002",
        source_worker_type: "trae",
        repo: "org/repo",
        scope: "src/b.ts",
        category: "security",
        rule: "Rule 2",
        rationale: "Rationale 2",
        trigger_paths: ["src/b.ts"],
        trigger_tags: [],
        severity: "critical",
        created_at: "2024-01-02T00:00:00.000+00:00",
      },
      {
        id: "lesson-3",
        source_type: "review",
        source_task_id: "TASK-003",
        source_worker_type: "trae",
        repo: "org/repo",
        scope: "src/c.ts",
        category: "security",
        rule: "Rule 3",
        rationale: "Rationale 3",
        trigger_paths: ["src/c.ts"],
        trigger_tags: [],
        severity: "warning",
        created_at: "2024-01-03T00:00:00.000+00:00",
      },
    ];

    it("filters and sorts lessons by severity (critical first)", () => {
      const criteria: LessonCriteria = { repo: "org/repo", scope: "src/a.ts" };
      const result = filterLessonsForInjection(lessons, criteria);
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("lesson-1");
    });

    it("returns empty array when no matches", () => {
      const criteria: LessonCriteria = { repo: "other/repo" };
      expect(filterLessonsForInjection(lessons, criteria)).toEqual([]);
    });

    it("filters by repo and sorts by severity", () => {
      const criteria: LessonCriteria = { repo: "org/repo", scope: ["src/a.ts", "src/b.ts", "src/c.ts"] };
      const result = filterLessonsForInjection(lessons, criteria);
      expect(result).toHaveLength(3);
      expect(result[0].severity).toBe("critical");
      expect(result[1].severity).toBe("warning");
      expect(result[2].severity).toBe("info");
    });
  });

  describe("injectLessonsIntoContext", () => {
    const lessons: Lesson[] = [
      {
        id: "lesson-1",
        source_type: "review",
        source_task_id: "TASK-001",
        source_worker_type: "trae",
        repo: "org/repo",
        scope: "src/",
        category: "security",
        rule: "Use parameterized queries",
        rationale: "Prevent SQL injection",
        trigger_paths: ["src/**"],
        trigger_tags: ["security"],
        severity: "critical",
        created_at: "2024-01-01T00:00:00.000+00:00",
      },
    ];

    it("returns original context when no lessons", () => {
      const context = "# Hello World";
      expect(injectLessonsIntoContext(context, [])).toBe(context);
    });

    it("appends lessons section to context with proper formatting", () => {
      const context = "# Code Review\n\nPlease review the code.";
      const result = injectLessonsIntoContext(context, lessons);
      expect(result).toContain("# Code Review");
      expect(result).toContain("Relevant Lessons from Past Reviews");
      expect(result).toContain("Use parameterized queries");
      expect(result).toContain("Prevent SQL injection");
    });

    it("includes severity icon for critical lessons", () => {
      const result = injectLessonsIntoContext("# Review", lessons);
      expect(result).toContain("⚠️");
      expect(result).toContain("CRITICAL");
    });

    it("includes severity icon for warning lessons", () => {
      const warningLesson: Lesson = { ...lessons[0], severity: "warning", rule: "Warning rule" };
      const result = injectLessonsIntoContext("# Review", [warningLesson]);
      expect(result).toContain("⚡");
      expect(result).toContain("WARNING");
    });

    it("includes severity icon for info lessons", () => {
      const infoLesson: Lesson = { ...lessons[0], severity: "info", rule: "Info rule" };
      const result = injectLessonsIntoContext("# Review", [infoLesson]);
      expect(result).toContain("ℹ️");
      expect(result).toContain("INFO");
    });

    it("limits lessons to maxLessons", () => {
      const manyLessons: Lesson[] = Array.from({ length: 10 }, (_, i) => ({
        ...lessons[0],
        id: `lesson-${i}`,
        rule: `Rule ${i}`,
      }));
      const context = "# Review";
      const result = injectLessonsIntoContext(context, manyLessons, { maxLessons: 3 });
      const matches = result.match(/Rule \d/g);
      expect(matches).toHaveLength(3);
    });

    it("uses default maxLessons of 5", () => {
      const manyLessons: Lesson[] = Array.from({ length: 7 }, (_, i) => ({
        ...lessons[0],
        id: `lesson-${i}`,
        rule: `Rule ${i}`,
      }));
      const context = "# Review";
      const result = injectLessonsIntoContext(context, manyLessons);
      const matches = result.match(/Rule \d/g);
      expect(matches).toHaveLength(5);
    });

    it("includes trigger paths in lesson entry", () => {
      const result = injectLessonsIntoContext("# Review", lessons);
      expect(result).toContain("Trigger Paths");
      expect(result).toContain("src/**");
    });

    it("includes source type in lesson entry", () => {
      const result = injectLessonsIntoContext("# Review", lessons);
      expect(result).toContain("Source");
      expect(result).toContain("review");
    });

    it("includes footer with injection note", () => {
      const result = injectLessonsIntoContext("# Review", lessons);
      expect(result).toContain("selectively injected");
    });
  });
});
