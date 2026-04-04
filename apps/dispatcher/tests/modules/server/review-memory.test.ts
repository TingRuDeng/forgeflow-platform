import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

let originalBackend: string | undefined;

beforeEach(() => {
  originalBackend = process.env.RUNTIME_STATE_BACKEND;
  process.env.RUNTIME_STATE_BACKEND = "json";
});

const repoRoot = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "../../../../../",
);
const memoryModulePath = path.join(repoRoot, "scripts/lib/review-memory.js");
const serverModulePath = path.join(repoRoot, "scripts/lib/dispatcher-server.js");
const tempRoots: string[] = [];

function makeTempDir() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "forgeflow-memory-test-"));
  tempRoots.push(tempDir);
  return tempDir;
}

afterEach(() => {
  if (originalBackend === undefined) {
    delete process.env.RUNTIME_STATE_BACKEND;
  } else {
    process.env.RUNTIME_STATE_BACKEND = originalBackend;
  }
  for (const tempDir of tempRoots.splice(0)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

describe("review memory - lesson extraction from review", () => {
  it("extracts lesson from blocked review with critical severity", async () => {
    const mod = await import(memoryModulePath);

    const finding = {
      severity: "critical",
      category: "security",
      title: "Security issue in authentication module",
      evidence: { file: "src/auth/login.ts" },
      recommendation: "Never use eval in auth code. Security risk.",
      confidence: 0.9,
      fingerprint: "sec-001",
    };

    const lesson = mod.extractLessonFromReview(
      "dispatch-1:task-1",
      "codex",
      "org/repo",
      finding,
      "blocked"
    );

    expect(lesson).not.toBeNull();
    expect(lesson.source_type).toBe("review");
    expect(lesson.category).toBe("security");
    expect(lesson.severity).toBe("critical");
    expect(lesson.trigger_paths).toContain("src/auth/login.ts");
    expect(lesson.created_at).toMatch(/[+-]\d{2}:\d{2}$/);
    expect(lesson.created_at.endsWith("Z")).toBe(false);
  });

  it("extracts lesson from blocked review with warning severity", async () => {
    const mod = await import(memoryModulePath);

    const finding = {
      severity: "warning",
      category: "performance",
      title: "Performance issue",
      evidence: { file: "src/utils/helper.ts" },
      recommendation: "Use cache to improve performance.",
      confidence: 0.8,
      fingerprint: "perf-001",
    };

    const lesson = mod.extractLessonFromReview(
      "dispatch-1:task-2",
      "codex",
      "org/repo",
      finding,
      "blocked"
    );

    expect(lesson).not.toBeNull();
    expect(lesson.source_type).toBe("review");
    expect(lesson.severity).toBe("warning");
  });

  it("extracts lesson from merged review with structure category", async () => {
    const mod = await import(memoryModulePath);

    const finding = {
      severity: "info",
      category: "structure",
      title: "API structure could be improved",
      evidence: { file: "src/api/routes.ts" },
      recommendation: "Use RESTful conventions for API routes.",
      confidence: 0.9,
      fingerprint: "struct-001",
    };

    const lesson = mod.extractLessonFromReview(
      "dispatch-1:task-3",
      "codex",
      "org/repo",
      finding,
      "merge"
    );

    expect(lesson).not.toBeNull();
    expect(lesson.source_type).toBe("review");
    expect(lesson.category).toBe("structure");
  });

  it("extracts lesson from merged review with behavior category", async () => {
    const mod = await import(memoryModulePath);

    const finding = {
      severity: "info",
      category: "behavior",
      title: "Error handling behavior",
      evidence: { file: "src/main.ts" },
      recommendation: "Add proper error handling for edge cases.",
      confidence: 0.9,
      fingerprint: "behav-001",
    };

    const lesson = mod.extractLessonFromReview(
      "dispatch-1:task-4",
      "codex",
      "org/repo",
      finding,
      "merge"
    );

    expect(lesson).not.toBeNull();
    expect(lesson.source_type).toBe("review");
    expect(lesson.category).toBe("behavior");
  });

  it("does NOT extract lesson from merged review with style category", async () => {
    const mod = await import(memoryModulePath);

    const finding = {
      severity: "info",
      category: "style",
      title: "Code style suggestion",
      evidence: { file: "src/main.ts" },
      recommendation: "Consider using const instead of let.",
      confidence: 0.9,
      fingerprint: "style-001",
    };

    const lesson = mod.extractLessonFromReview(
      "dispatch-1:task-5",
      "codex",
      "org/repo",
      finding,
      "merge"
    );

    expect(lesson).toBeNull();
  });

  it("does NOT extract lesson from blocked review with info severity", async () => {
    const mod = await import(memoryModulePath);

    const finding = {
      severity: "info",
      category: "style",
      title: "Minor style issue",
      evidence: { file: "src/main.ts" },
      recommendation: "Add a newline at end of file.",
      confidence: 0.9,
      fingerprint: "style-002",
    };

    const lesson = mod.extractLessonFromReview(
      "dispatch-1:task-6",
      "codex",
      "org/repo",
      finding,
      "blocked"
    );

    expect(lesson).toBeNull();
  });

  it("does NOT extract lesson with non-actionable recommendation", async () => {
    const mod = await import(memoryModulePath);

    const finding = {
      severity: "critical",
      category: "security",
      title: "Security issue",
      evidence: { file: "src/auth.ts" },
      recommendation: "OK",
      confidence: 0.9,
      fingerprint: "sec-002",
    };

    const lesson = mod.extractLessonFromReview(
      "dispatch-1:task-7",
      "codex",
      "org/repo",
      finding,
      "blocked"
    );

    expect(lesson).toBeNull();
  });

  it("does NOT extract lesson from unknown decision", async () => {
    const mod = await import(memoryModulePath);

    const finding = {
      severity: "critical",
      category: "security",
      title: "Security issue",
      evidence: { file: "src/auth.ts" },
      recommendation: "Never use eval.",
      confidence: 0.9,
      fingerprint: "sec-003",
    };

    const lesson = mod.extractLessonFromReview(
      "dispatch-1:task-8",
      "codex",
      "org/repo",
      finding,
      "pending"
    );

    expect(lesson).toBeNull();
  });
});

describe("review memory - lesson extraction from failed/rework", () => {
  it("extracts lesson from failed task with test error", async () => {
    const mod = await import(memoryModulePath);

    const result = {
      taskId: "dispatch-1:task-1",
      workerId: "codex-worker",
      provider: "codex",
      pool: "codex",
      repo: "org/repo",
      status: "failed",
      verification: {
        allPassed: false,
        commands: [
          { command: "pnpm test", exitCode: 1, output: "Test failed: undefined is not a function" },
        ],
      },
    };

    const lesson = mod.extractLessonFromFailed(
      "dispatch-1:task-1",
      "codex",
      "org/repo",
      result
    );

    expect(lesson).not.toBeNull();
    expect(lesson.source_type).toBe("failed");
    expect(lesson.category).toBe("testing");
  });

  it("does not extract lesson from passed verification", async () => {
    const mod = await import(memoryModulePath);

    const result = {
      taskId: "dispatch-1:task-1",
      workerId: "codex-worker",
      provider: "codex",
      pool: "codex",
      repo: "org/repo",
      status: "review",
      verification: {
        allPassed: true,
        commands: [{ command: "pnpm test", exitCode: 0, output: "ok" }],
      },
    };

    const lesson = mod.extractLessonFromFailed(
      "dispatch-1:task-1",
      "codex",
      "org/repo",
      result
    );

    expect(lesson).toBeNull();
  });

  it("extracts lesson from rework when count >= 2", async () => {
    const mod = await import(memoryModulePath);

    const lesson = mod.extractLessonFromRework(
      "dispatch-1:task-1",
      "codex",
      "org/repo",
      3,
      "Requirements were unclear"
    );

    expect(lesson).not.toBeNull();
    expect(lesson.source_type).toBe("rework");
    expect(lesson.rationale).toBe("Requirements were unclear");
  });

  it("does not extract lesson from rework when count < 2", async () => {
    const mod = await import(memoryModulePath);

    const lesson = mod.extractLessonFromRework(
      "dispatch-1:task-1",
      "codex",
      "org/repo",
      1,
      "Minor adjustment"
    );

    expect(lesson).toBeNull();
  });

  it("extracts lesson from structured failed with failureType", async () => {
    const mod = await import(memoryModulePath);

    const result = {
      taskId: "dispatch-1:task-1",
      workerId: "codex-worker",
      provider: "codex",
      pool: "codex",
      repo: "org/repo",
      status: "failed",
      verification: {
        allPassed: false,
        commands: [],
      },
    };

    const structured = {
      failureType: "verification_failed",
      failureSummary: "Tests failed due to missing mock",
      blockers: [],
      findings: [],
      artifacts: [],
    };

    const lesson = mod.extractLessonFromFailed(
      "dispatch-1:task-1",
      "codex",
      "org/repo",
      result,
      structured
    );

    expect(lesson).not.toBeNull();
    expect(lesson.source_type).toBe("failed");
    expect(lesson.category).toBe("testing");
    expect(lesson.rule).toBe("Tests failed due to missing mock");
    expect(lesson.severity).toBe("warning");
  });

  it("extracts lesson from structured failed with blockers (critical severity)", async () => {
    const mod = await import(memoryModulePath);

    const result = {
      taskId: "dispatch-1:task-1",
      workerId: "codex-worker",
      provider: "codex",
      pool: "codex",
      repo: "org/repo",
      status: "failed",
      verification: {
        allPassed: false,
        commands: [],
      },
    };

    const structured = {
      failureType: "blocked_human",
      blockers: [
        { code: "AUTH_TOKEN_MISSING", summary: "GitHub token not found", actionType: "human_action", blocksCompletion: true },
      ],
    };

    const lesson = mod.extractLessonFromFailed(
      "dispatch-1:task-1",
      "codex",
      "org/repo",
      result,
      structured
    );

    expect(lesson).not.toBeNull();
    expect(lesson.source_type).toBe("failed");
    expect(lesson.category).toBe("process");
    expect(lesson.severity).toBe("critical");
    expect(lesson.trigger_tags).toContain("blocked_human");
  });

  it("extracts lesson from structured rework with reasonCode", async () => {
    const mod = await import(memoryModulePath);

    const structured = {
      reasonCode: "scope_miss",
      mustFix: ["Add unit tests for new module", "Update API documentation"],
      canRedrive: true,
      redriveStrategy: "same_worker_continue",
    };

    const lesson = mod.extractLessonFromRework(
      "dispatch-1:task-1",
      "codex",
      "org/repo",
      1,
      "",
      structured
    );

    expect(lesson).not.toBeNull();
    expect(lesson.source_type).toBe("rework");
    expect(lesson.category).toBe("requirements");
    expect(lesson.rule).toBe("Add unit tests for new module");
    expect(lesson.rationale).toContain("Add unit tests for new module");
    expect(lesson.rationale).toContain("Update API documentation");
    expect(lesson.trigger_tags).toContain("scope_miss");
  });

  it("extracts lesson from structured rework with canRedrive=false (critical severity)", async () => {
    const mod = await import(memoryModulePath);

    const structured = {
      reasonCode: "human_confirmation_required",
      canRedrive: false,
    };

    const lesson = mod.extractLessonFromRework(
      "dispatch-1:task-1",
      "codex",
      "org/repo",
      1,
      "",
      structured
    );

    expect(lesson).not.toBeNull();
    expect(lesson.source_type).toBe("rework");
    expect(lesson.severity).toBe("critical");
  });

  it("does not extract lesson when no structured data and rework count < 2", async () => {
    const mod = await import(memoryModulePath);

    const lesson = mod.extractLessonFromRework(
      "dispatch-1:task-1",
      "codex",
      "org/repo",
      1,
      "Some minor issue"
    );

    expect(lesson).toBeNull();
  });
});

describe("review memory - lesson injection", () => {
  it("injects lesson when repo matches exactly", async () => {
    const mod = await import(memoryModulePath);

    const lesson = {
      id: "lesson-1",
      source_type: "review",
      source_task_id: "dispatch-1:task-1",
      source_worker_type: "codex",
      repo: "org/repo",
      scope: "src/auth",
      category: "security",
      rule: "Avoid eval",
      rationale: "Security risk",
      trigger_paths: ["src/auth/**"],
      trigger_tags: ["security"],
      severity: "critical",
      created_at: new Date().toISOString(),
    };

    const shouldInject = mod.shouldInjectLesson(lesson, {
      repo: "org/repo",
      scope: "src/auth/login.ts",
    });

    expect(shouldInject).toBe(true);
  });

  it("injects lesson when org matches", async () => {
    const mod = await import(memoryModulePath);

    const lesson = {
      id: "lesson-2",
      source_type: "review",
      source_task_id: "dispatch-1:task-1",
      source_worker_type: "codex",
      repo: "org/repo-a",
      scope: "src/api",
      category: "structure",
      rule: "REST conventions",
      rationale: "Use RESTful API design",
      trigger_paths: ["src/api/**"],
      trigger_tags: ["api"],
      severity: "warning",
      created_at: new Date().toISOString(),
    };

    const shouldInject = mod.shouldInjectLesson(lesson, {
      repo: "org/repo-b",
      scope: "src/api/users",
    });

    expect(shouldInject).toBe(true);
  });

  it("does not inject lesson when repo does not match", async () => {
    const mod = await import(memoryModulePath);

    const lesson = {
      id: "lesson-3",
      source_type: "review",
      source_task_id: "dispatch-1:task-1",
      source_worker_type: "codex",
      repo: "org/repo-a",
      scope: "src/auth",
      category: "security",
      rule: "Avoid eval",
      rationale: "Security risk",
      trigger_paths: ["src/auth/**"],
      trigger_tags: ["security"],
      severity: "critical",
      created_at: new Date().toISOString(),
    };

    const shouldInject = mod.shouldInjectLesson(lesson, {
      repo: "other-org/repo",
      scope: "src/auth",
    });

    expect(shouldInject).toBe(false);
  });

  it("injects lesson based on category match", async () => {
    const mod = await import(memoryModulePath);

    const lesson = {
      id: "lesson-4",
      source_type: "review",
      source_task_id: "dispatch-1:task-1",
      source_worker_type: "codex",
      repo: "org/repo",
      scope: "",
      category: "security",
      rule: "Input validation",
      rationale: "Validate all inputs",
      trigger_paths: [],
      trigger_tags: ["security"],
      severity: "warning",
      created_at: new Date().toISOString(),
    };

    const shouldInject = mod.shouldInjectLesson(lesson, {
      repo: "org/repo",
      scope: "src/utils",
      category: "security",
    });

    expect(shouldInject).toBe(true);
  });

  it("injects lesson based on worker type match", async () => {
    const mod = await import(memoryModulePath);

    const lesson = {
      id: "lesson-5",
      source_type: "review",
      source_task_id: "dispatch-1:task-1",
      source_worker_type: "codex",
      repo: "org/repo",
      scope: "",
      category: "style",
      rule: "Code style",
      rationale: "Follow project conventions",
      trigger_paths: [],
      trigger_tags: ["style"],
      severity: "info",
      created_at: new Date().toISOString(),
    };

    const shouldInject = mod.shouldInjectLesson(lesson, {
      repo: "org/repo",
      scope: "src/main",
      worker_type: "codex",
    });

    expect(shouldInject).toBe(true);
  });

  it("filters and sorts lessons by severity", async () => {
    const mod = await import(memoryModulePath);

    const lessons = [
      {
        id: "lesson-info",
        source_type: "review",
        source_task_id: "task-1",
        source_worker_type: "codex",
        repo: "org/repo",
        scope: "",
        category: "style",
        rule: "Info rule",
        rationale: "Info",
        trigger_paths: ["src/main/**"],
        trigger_tags: [],
        severity: "info",
        created_at: new Date().toISOString(),
      },
      {
        id: "lesson-critical",
        source_type: "review",
        source_task_id: "task-2",
        source_worker_type: "codex",
        repo: "org/repo",
        scope: "",
        category: "security",
        rule: "Critical rule",
        rationale: "Critical",
        trigger_paths: ["src/main/**"],
        trigger_tags: [],
        severity: "critical",
        created_at: new Date().toISOString(),
      },
      {
        id: "lesson-warning",
        source_type: "review",
        source_task_id: "task-3",
        source_worker_type: "codex",
        repo: "org/repo",
        scope: "",
        category: "performance",
        rule: "Warning rule",
        rationale: "Warning",
        trigger_paths: ["src/main/**"],
        trigger_tags: [],
        severity: "warning",
        created_at: new Date().toISOString(),
      },
    ];

    const filtered = mod.filterLessonsForInjection(lessons, {
      repo: "org/repo",
      scope: "src/main/index.ts",
    });

    expect(filtered).toHaveLength(3);
    expect(filtered[0].id).toBe("lesson-critical");
    expect(filtered[1].id).toBe("lesson-warning");
    expect(filtered[2].id).toBe("lesson-info");
  });

  it("does not inject unrelated lessons", async () => {
    const mod = await import(memoryModulePath);

    const lesson = {
      id: "lesson-6",
      source_type: "review",
      source_task_id: "dispatch-1:task-1",
      source_worker_type: "codex",
      repo: "org/repo-a",
      scope: "src/auth",
      category: "security",
      rule: "Auth security",
      rationale: "Secure auth",
      trigger_paths: ["src/auth/**"],
      trigger_tags: ["security"],
      severity: "critical",
      created_at: new Date().toISOString(),
    };

    const shouldInject = mod.shouldInjectLesson(lesson, {
      repo: "org/repo-b",
      scope: "src/api/users",
      category: "performance",
      worker_type: "gemini",
    });

    expect(shouldInject).toBe(false);
  });
});

describe("review memory - store", () => {
  it("creates memory store with version", async () => {
    const mod = await import(memoryModulePath);

    const store = mod.createMemoryStore();

    expect(store.version).toBe(1);
    expect(store.lessons).toEqual([]);
    expect(store.updated_at).toBeDefined();
  });

  it("creates memory store with initial lessons", async () => {
    const mod = await import(memoryModulePath);

    const lessons = [
      {
        id: "lesson-1",
        source_type: "review",
        source_task_id: "task-1",
        source_worker_type: "codex",
        repo: "org/repo",
        scope: "",
        category: "security",
        rule: "Rule 1",
        rationale: "Rationale 1",
        trigger_paths: [],
        trigger_tags: [],
        severity: "critical",
        created_at: new Date().toISOString(),
      },
    ];

    const store = mod.createMemoryStore(lessons);

    expect(store.lessons).toHaveLength(1);
    expect(store.lessons[0].id).toBe("lesson-1");
  });
});

describe("review memory - load and injection", () => {
  it("loads memory store from file", async () => {
    const mod = await import(memoryModulePath);

    const tempDir = makeTempDir();
    const memoryPath = path.join(tempDir, "memory.json");
    const memoryData = {
      version: 1,
      lessons: [
        {
          id: "lesson-1",
          source_type: "review",
          source_task_id: "task-1",
          source_worker_type: "codex",
          repo: "org/repo",
          scope: "src/auth",
          category: "security",
          rule: "Avoid eval",
          rationale: "Security risk",
          trigger_paths: ["src/auth/**"],
          trigger_tags: ["security"],
          severity: "critical",
          created_at: new Date().toISOString(),
        },
      ],
      updated_at: new Date().toISOString(),
    };

    fs.writeFileSync(memoryPath, JSON.stringify(memoryData));

    const store = mod.loadMemoryStore(tempDir);

    expect(store).not.toBeNull();
    expect(store.lessons).toHaveLength(1);
    expect(store.lessons[0].id).toBe("lesson-1");
  });

  it("returns null when memory file does not exist", async () => {
    const mod = await import(memoryModulePath);

    const tempDir = makeTempDir();

    const store = mod.loadMemoryStore(tempDir);

    expect(store).toBeNull();
  });

  it("returns null for invalid memory file", async () => {
    const mod = await import(memoryModulePath);

    const tempDir = makeTempDir();
    const memoryPath = path.join(tempDir, "memory.json");
    fs.writeFileSync(memoryPath, "invalid json");

    const store = mod.loadMemoryStore(tempDir);

    expect(store).toBeNull();
  });

  it("injects lessons into context markdown", async () => {
    const mod = await import(memoryModulePath);

    const lessons = [
      {
        id: "lesson-1",
        source_type: "review",
        source_task_id: "task-1",
        source_worker_type: "codex",
        repo: "org/repo",
        scope: "src/auth",
        category: "security",
        rule: "Avoid eval",
        rationale: "Never use eval in auth code.",
        trigger_paths: ["src/auth/**"],
        trigger_tags: ["security"],
        severity: "critical",
        created_at: new Date().toISOString(),
      },
    ];

    const context = "# Task Context\n\nPlease implement the feature.";
    const result = mod.injectLessonsIntoContext(context, lessons);

    expect(result).toContain("Relevant Lessons");
    expect(result).toContain("Avoid eval");
    expect(result).toContain("Never use eval in auth code.");
  });

  it("does not inject when no lessons provided", async () => {
    const mod = await import(memoryModulePath);

    const context = "# Task Context\n\nPlease implement the feature.";
    const result = mod.injectLessonsIntoContext(context, []);

    expect(result).toBe(context);
  });

  it("does not inject when lessons is null", async () => {
    const mod = await import(memoryModulePath);

    const context = "# Task Context\n\nPlease implement the feature.";
    // @ts-ignore - testing null input
    const result = mod.injectLessonsIntoContext(context, null);

    expect(result).toBe(context);
  });

  it("limits injected lessons to maxLessons", async () => {
    const mod = await import(memoryModulePath);

    const lessons = [
      { id: "1", source_type: "review", source_task_id: "t1", source_worker_type: "codex", repo: "org/repo", scope: "", category: "security", rule: "Rule 1", rationale: "R1", trigger_paths: [], trigger_tags: [], severity: "critical", created_at: "" },
      { id: "2", source_type: "review", source_task_id: "t2", source_worker_type: "codex", repo: "org/repo", scope: "", category: "security", rule: "Rule 2", rationale: "R2", trigger_paths: [], trigger_tags: [], severity: "warning", created_at: "" },
      { id: "3", source_type: "review", source_task_id: "t3", source_worker_type: "codex", repo: "org/repo", scope: "", category: "security", rule: "Rule 3", rationale: "R3", trigger_paths: [], trigger_tags: [], severity: "info", created_at: "" },
      { id: "4", source_type: "review", source_task_id: "t4", source_worker_type: "codex", repo: "org/repo", scope: "", category: "security", rule: "Rule 4", rationale: "R4", trigger_paths: [], trigger_tags: [], severity: "critical", created_at: "" },
      { id: "5", source_type: "review", source_task_id: "t5", source_worker_type: "codex", repo: "org/repo", scope: "", category: "security", rule: "Rule 5", rationale: "R5", trigger_paths: [], trigger_tags: [], severity: "warning", created_at: "" },
      { id: "6", source_type: "review", source_task_id: "t6", source_worker_type: "codex", repo: "org/repo", scope: "", category: "security", rule: "Rule 6", rationale: "R6", trigger_paths: [], trigger_tags: [], severity: "info", created_at: "" },
    ];

    const context = "# Task Context";
    const result = mod.injectLessonsIntoContext(context, lessons, { maxLessons: 3 });

    expect(result).toContain("Rule 1");
    expect(result).toContain("Rule 2");
    expect(result).toContain("Rule 4");
    expect(result).not.toContain("Rule 5");
    expect(result).not.toContain("Rule 6");
  });

  it("injects lessons sorted by severity (critical first)", async () => {
    const mod = await import(memoryModulePath);

    const lessons = [
      { id: "1", source_type: "review", source_task_id: "t1", source_worker_type: "codex", repo: "org/repo", scope: "", category: "security", rule: "Info Rule", rationale: "R1", trigger_paths: [], trigger_tags: [], severity: "info", created_at: "" },
      { id: "2", source_type: "review", source_task_id: "t2", source_worker_type: "codex", repo: "org/repo", scope: "", category: "security", rule: "Critical Rule", rationale: "R2", trigger_paths: [], trigger_tags: [], severity: "critical", created_at: "" },
      { id: "3", source_type: "review", source_task_id: "t3", source_worker_type: "codex", repo: "org/repo", scope: "", category: "security", rule: "Warning Rule", rationale: "R3", trigger_paths: [], trigger_tags: [], severity: "warning", created_at: "" },
    ];

    const context = "# Task Context";
    const result = mod.injectLessonsIntoContext(context, lessons);

    const criticalPos = result.indexOf("Critical Rule");
    const warningPos = result.indexOf("Warning Rule");
    const infoPos = result.indexOf("Info Rule");

    expect(criticalPos).toBeLessThan(warningPos);
    expect(warningPos).toBeLessThan(infoPos);
  });

  it("matches multiple allowedPaths - hits first path", async () => {
    const mod = await import(memoryModulePath);

    const lesson = {
      id: "lesson-1",
      source_type: "review",
      source_task_id: "task-1",
      source_worker_type: "codex",
      repo: "org/repo",
      scope: "",
      category: "security",
      rule: "Auth Security",
      rationale: "Secure auth",
      trigger_paths: ["src/auth/**"],
      trigger_tags: ["security"],
      severity: "critical",
      created_at: "",
    };

    const shouldInject = mod.shouldInjectLesson(lesson, {
      repo: "org/repo",
      scope: ["src/auth/login.ts", "docs/readme.md"],
      category: undefined,
    });

    expect(shouldInject).toBe(true);
  });

  it("matches multiple allowedPaths - hits second path", async () => {
    const mod = await import(memoryModulePath);

    const lesson = {
      id: "lesson-1",
      source_type: "review",
      source_task_id: "task-1",
      source_worker_type: "codex",
      repo: "org/repo",
      scope: "",
      category: "security",
      rule: "Docs Security",
      rationale: "Secure docs",
      trigger_paths: ["docs"],
      trigger_tags: ["docs"],
      severity: "critical",
      created_at: "",
    };

    const shouldInject = mod.shouldInjectLesson(lesson, {
      repo: "org/repo",
      scope: ["src/auth/login.ts", "docs/readme.md"],
      category: undefined,
    });

    expect(shouldInject).toBe(true);
  });

  it("does not match when no allowedPaths overlap", async () => {
    const mod = await import(memoryModulePath);

    const lesson = {
      id: "lesson-1",
      source_type: "review",
      source_task_id: "task-1",
      source_worker_type: "codex",
      repo: "org/repo",
      scope: "",
      category: "security",
      rule: "Auth Security",
      rationale: "Secure auth",
      trigger_paths: ["src/auth/**"],
      trigger_tags: ["security"],
      severity: "critical",
      created_at: "",
    };

    const shouldInject = mod.shouldInjectLesson(lesson, {
      repo: "org/repo",
      scope: ["src/api/**", "tests/**"],
      category: undefined,
    });

    expect(shouldInject).toBe(false);
  });

  it("handles empty allowedPaths gracefully", async () => {
    const mod = await import(memoryModulePath);

    const lesson = {
      id: "lesson-1",
      source_type: "review",
      source_task_id: "task-1",
      source_worker_type: "codex",
      repo: "org/repo",
      scope: "",
      category: "security",
      rule: "Security",
      rationale: "Secure",
      trigger_paths: ["src/auth/**"],
      trigger_tags: ["security"],
      severity: "critical",
      created_at: "",
    };

    const shouldInject = mod.shouldInjectLesson(lesson, {
      repo: "org/repo",
      scope: [],
      category: undefined,
    });

    expect(shouldInject).toBe(false);
  });

  it("deduplicates lessons when matching multiple paths", async () => {
    const mod = await import(memoryModulePath);

    const lessons = [
      { id: "1", source_type: "review", source_task_id: "t1", source_worker_type: "codex", repo: "org/repo", scope: "", category: "security", rule: "Rule 1", rationale: "R1", trigger_paths: ["src/a/**"], trigger_tags: [], severity: "critical", created_at: "" },
      { id: "2", source_type: "review", source_task_id: "t2", source_worker_type: "codex", repo: "org/repo", scope: "", category: "security", rule: "Rule 2", rationale: "R2", trigger_paths: ["src/b/**"], trigger_tags: [], severity: "warning", created_at: "" },
      { id: "3", source_type: "review", source_task_id: "t3", source_worker_type: "codex", repo: "org/repo", scope: "", category: "security", rule: "Rule 3", rationale: "R3", trigger_paths: ["src/a/**", "src/b/**"], trigger_tags: [], severity: "info", created_at: "" },
    ];

    const filtered = mod.filterLessonsForInjection(lessons, {
      repo: "org/repo",
      scope: ["src/a/**"],
    });

    expect(filtered).toHaveLength(2);
    expect(filtered[0].id).toBe("1");
    expect(filtered[1].id).toBe("3");
  });
});

describe("review memory - real dispatcher integration", () => {
  it("injects lessons into state.assignments via handleDispatcherHttpRequest", async () => {
    const serverMod = await import(serverModulePath);

    const stateDir = makeTempDir();

    const memoryData = {
      version: 1,
      lessons: [
        {
          id: "lesson-1",
          source_type: "review",
          source_task_id: "task-1",
          source_worker_type: "codex",
          repo: "test-org/test-repo",
          scope: "src/auth",
          category: "security",
          rule: "Avoid eval in auth code",
          rationale: "Never use eval - security risk",
          trigger_paths: ["src/auth"],
          trigger_tags: ["security"],
          severity: "critical",
          created_at: new Date().toISOString(),
        },
      ],
      updated_at: new Date().toISOString(),
    };

    fs.mkdirSync(path.join(stateDir, ".forgeflow-dispatcher"), { recursive: true });
    fs.writeFileSync(
      path.join(stateDir, "memory.json"),
      JSON.stringify(memoryData)
    );

    const registerResponse = await serverMod.handleDispatcherHttpRequest({
      stateDir,
      method: "POST",
      pathname: "/api/workers/register",
      body: {
        workerId: "codex-worker-1",
        pool: "codex",
        hostname: "test-host",
        labels: ["test"],
        repoDir: "/repos/test",
      },
    });
    expect(registerResponse.status).toBe(200);

    const dispatchResponse = await serverMod.handleDispatcherHttpRequest({
      stateDir,
      method: "POST",
      pathname: "/api/dispatches",
      body: {
        repo: "test-org/test-repo",
        defaultBranch: "main",
        requestedBy: "test",
        tasks: [
          {
            id: "task-1",
            pool: "codex",
            title: "Implement auth feature",
            allowedPaths: ["src/auth/login.ts"],
          },
        ],
        packages: [
          {
            taskId: "task-1",
            assignment: {
              taskId: "task-1",
              workerId: "placeholder",
              pool: "codex",
              status: "assigned",
              branchName: "main",
              allowedPaths: ["src/auth/login.ts"],
              commands: {},
              repo: "test-org/test-repo",
              defaultBranch: "main",
            },
            contextMarkdown: "# Task Context\n\nPlease implement the feature.",
          },
        ],
      },
    });

    expect(dispatchResponse.status).toBe(200);
    expect(dispatchResponse.json.assignments).toBeDefined();

    const runtimeStatePath = path.join(stateDir, "runtime-state.json");
    expect(fs.existsSync(runtimeStatePath)).toBe(true);

    const runtimeState = JSON.parse(fs.readFileSync(runtimeStatePath, "utf8"));
    const assignment = runtimeState.assignments.find((a: any) => a.taskId.includes("task-1"));
    expect(assignment).toBeDefined();
    expect(assignment.contextMarkdown).toContain("# Task Context");
    expect(assignment.contextMarkdown).toContain("Avoid eval in auth code");
    expect(assignment.contextMarkdown).toContain("Relevant Lessons");
  });

  it("handles missing memory.json gracefully during dispatch", async () => {
    const serverMod = await import(serverModulePath);

    const stateDir = makeTempDir();

    const registerResponse = await serverMod.handleDispatcherHttpRequest({
      stateDir,
      method: "POST",
      pathname: "/api/workers/register",
      body: {
        workerId: "codex-worker-2",
        pool: "codex",
        hostname: "test-host",
        labels: ["test"],
        repoDir: "/repos/test",
      },
    });
    expect(registerResponse.status).toBe(200);

    const dispatchResponse = await serverMod.handleDispatcherHttpRequest({
      stateDir,
      method: "POST",
      pathname: "/api/dispatches",
      body: {
        repo: "test-org/test-repo-2",
        defaultBranch: "main",
        requestedBy: "test",
        tasks: [
          {
            id: "task-2",
            pool: "codex",
            title: "Test task",
            allowedPaths: ["src/main.ts"],
          },
        ],
        packages: [
          {
            taskId: "task-2",
            assignment: {
              taskId: "task-2",
              workerId: "placeholder",
              pool: "codex",
              status: "assigned",
              branchName: "main",
              allowedPaths: ["src/main.ts"],
              commands: {},
              repo: "test-org/test-repo-2",
              defaultBranch: "main",
            },
            contextMarkdown: "# Task Context\n\nTest task.",
          },
        ],
      },
    });

    expect(dispatchResponse.status).toBe(200);

    const runtimeStatePath = path.join(stateDir, "runtime-state.json");
    const runtimeState = JSON.parse(fs.readFileSync(runtimeStatePath, "utf8"));
    const assignment = runtimeState.assignments.find((a: any) => a.taskId.includes("task-2"));
    expect(assignment).toBeDefined();
    expect(assignment.contextMarkdown).toBe("# Task Context\n\nTest task.");
    expect(assignment.contextMarkdown).not.toContain("Relevant Lessons");
  });

  it("injects lessons when allowedPaths matches any trigger path", async () => {
    const serverMod = await import(serverModulePath);

    const stateDir = makeTempDir();

    const memoryData = {
      version: 1,
      lessons: [
        {
          id: "lesson-1",
          source_type: "review",
          source_task_id: "task-1",
          source_worker_type: "codex",
          repo: "test-org/test-repo-3",
          scope: "docs",
          category: "documentation",
          rule: "Use Markdown for documentation",
          rationale: "Documentation should use Markdown format",
          trigger_paths: ["docs"],
          trigger_tags: ["docs"],
          severity: "info",
          created_at: new Date().toISOString(),
        },
      ],
      updated_at: new Date().toISOString(),
    };

    fs.mkdirSync(path.join(stateDir, ".forgeflow-dispatcher"), { recursive: true });
    fs.writeFileSync(
      path.join(stateDir, "memory.json"),
      JSON.stringify(memoryData)
    );

    await serverMod.handleDispatcherHttpRequest({
      stateDir,
      method: "POST",
      pathname: "/api/workers/register",
      body: {
        workerId: "codex-worker-3",
        pool: "codex",
        hostname: "test-host",
        labels: ["test"],
        repoDir: "/repos/test",
      },
    });

    const dispatchResponse = await serverMod.handleDispatcherHttpRequest({
      stateDir,
      method: "POST",
      pathname: "/api/dispatches",
      body: {
        repo: "test-org/test-repo-3",
        defaultBranch: "main",
        requestedBy: "test",
        tasks: [
          {
            id: "task-3",
            pool: "codex",
            title: "Update docs",
            allowedPaths: ["src/main.ts", "docs/readme.md"],
          },
        ],
        packages: [
          {
            taskId: "task-3",
            assignment: {
              taskId: "task-3",
              workerId: "placeholder",
              pool: "codex",
              status: "assigned",
              branchName: "main",
              allowedPaths: ["src/main.ts", "docs/readme.md"],
              commands: {},
              repo: "test-org/test-repo-3",
              defaultBranch: "main",
            },
            contextMarkdown: "# Task Context\n\nUpdate the documentation.",
          },
        ],
      },
    });

    if (dispatchResponse.status !== 200) {
      console.error(dispatchResponse);
    }
    expect(dispatchResponse.status).toBe(200);

    const runtimeStatePath = path.join(stateDir, "runtime-state.json");
    const runtimeState = JSON.parse(fs.readFileSync(runtimeStatePath, "utf8"));
    const assignment = runtimeState.assignments.find((a: any) => a.taskId.includes("task-3"));
    expect(assignment).toBeDefined();
    expect(assignment.contextMarkdown).toContain("# Task Context");
    expect(assignment.contextMarkdown).toContain("Use Markdown for documentation");
    expect(assignment.contextMarkdown).toContain("Relevant Lessons");
  });
});
