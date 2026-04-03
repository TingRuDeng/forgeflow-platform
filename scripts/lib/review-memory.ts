import fs from "node:fs";
import path from "node:path";

export interface Lesson {
  id: string;
  source_type: string;
  source_task_id: string;
  source_worker_type: string;
  repo: string;
  scope: string;
  category: string;
  rule: string;
  rationale: string;
  trigger_paths: string[];
  trigger_tags: string[];
  severity: string;
  created_at: string;
}

export interface MemoryStore {
  version: number;
  lessons: Lesson[];
  updated_at: string;
}

export interface Finding {
  title: string;
  recommendation: string;
  severity?: string;
  category?: string;
  evidence?: {
    file?: string;
  };
}

export interface VerificationCommand {
  exitCode: number;
  output: string;
}

export interface WorkerResult {
  status: string;
  verification: {
    commands: VerificationCommand[];
  };
}

export interface LessonCriteria {
  repo?: string;
  scope?: string | string[];
  category?: string;
  worker_type?: string;
}

export function createMemoryStore(lessons?: Lesson[]): MemoryStore {
  return {
    version: 1,
    lessons: lessons || [],
    updated_at: new Date().toISOString(),
  };
}

function generateLessonId(): string {
  return `lesson-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

const VALID_REVIEW_CATEGORIES = new Set(['structure', 'behavior']);
const VALID_REVIEW_SEVERITIES = new Set(['critical', 'warning']);

function hasActionableRecommendation(recommendation: string): boolean {
  if (!recommendation || recommendation.length < 10) {
    return false;
  }
  const actionablePatterns = [
    'always', 'never', 'avoid', 'use', 'prefer',
    'should', 'must', 'ensure', 'make sure',
    'refactor', 'replace', 'implement', 'add', 'remove'
  ];
  return actionablePatterns.some(p =>
    recommendation.toLowerCase().includes(p)
  );
}

function isExtractableFromReview(finding: Finding, decision: string): boolean {
  if (decision === 'blocked') {
    if (!finding.severity || !VALID_REVIEW_SEVERITIES.has(finding.severity)) {
      return false;
    }
    return hasActionableRecommendation(finding.recommendation);
  }

  if (decision === 'merge') {
    if (!finding.category || !VALID_REVIEW_CATEGORIES.has(finding.category.toLowerCase())) {
      return false;
    }
    return hasActionableRecommendation(finding.recommendation);
  }

  return false;
}

function isExtractableFromFailed(result: WorkerResult): boolean {
  if (result.status !== 'failed') {
    return false;
  }
  if (!result.verification.commands || result.verification.commands.length === 0) {
    return false;
  }
  const failedCommands = result.verification.commands.filter(c => c.exitCode !== 0);
  if (failedCommands.length === 0) {
    return false;
  }
  const abstractablePatterns = [
    'test', 'mock', 'timeout', 'flaky', 'race condition',
    'undefined', 'null', 'permission', 'not found'
  ];
  const errorText = failedCommands.map(c => c.output).join(' ').toLowerCase();
  return abstractablePatterns.some(p => errorText.includes(p));
}

function inferCategory(finding: Finding): string {
  const title = finding.title.toLowerCase();
  const recommendation = finding.recommendation.toLowerCase();

  if (title.includes('security') || recommendation.includes('security') || recommendation.includes('injection') || recommendation.includes('xss')) {
    return 'security';
  }
  if (title.includes('performance') || recommendation.includes('performance') || recommendation.includes('slow') || recommendation.includes('memory')) {
    return 'performance';
  }
  if (title.includes('structure') || recommendation.includes('structure') || recommendation.includes('architecture') || recommendation.includes('coupling')) {
    return 'structure';
  }
  if (title.includes('behavior') || recommendation.includes('behavior') || recommendation.includes('logic')) {
    return 'behavior';
  }
  return 'other';
}

function inferTriggerPaths(evidence: Finding['evidence']): string[] {
  if (evidence && evidence.file) {
    const parts = evidence.file.split('/');
    const dir = parts.slice(0, -1).join('/');
    return dir ? [`${dir}/**`, evidence.file] : [evidence.file];
  }
  return [];
}

export function extractLessonFromReview(taskId: string, workerType: string, repo: string, finding: Finding, decision: string): Lesson | null {
  if (!isExtractableFromReview(finding, decision)) {
    return null;
  }

  return {
    id: generateLessonId(),
    source_type: 'review',
    source_task_id: taskId,
    source_worker_type: workerType,
    repo,
    scope: finding.evidence?.file || '',
    category: inferCategory(finding),
    rule: finding.title,
    rationale: finding.recommendation,
    trigger_paths: inferTriggerPaths(finding.evidence),
    trigger_tags: [finding.category].filter(Boolean) as string[],
    severity: finding.severity || 'warning',
    created_at: new Date().toISOString(),
  };
}

export function extractLessonFromFailed(taskId: string, workerType: string, repo: string, result: WorkerResult): Lesson | null {
  if (!isExtractableFromFailed(result)) {
    return null;
  }

  const failedCommand = result.verification.commands.find(c => c.exitCode !== 0);
  const isTestError = failedCommand?.output.toLowerCase().includes('test');
  const category = isTestError ? 'testing' : 'runtime';

  return {
    id: generateLessonId(),
    source_type: 'failed',
    source_task_id: taskId,
    source_worker_type: workerType,
    repo,
    scope: '',
    category,
    rule: `Handle ${category} errors gracefully`,
    rationale: failedCommand?.output || 'Unknown error',
    trigger_paths: [],
    trigger_tags: [category],
    severity: 'warning',
    created_at: new Date().toISOString(),
  };
}

export function extractLessonFromRework(taskId: string, workerType: string, repo: string, reworkCount: number, rootCause: string): Lesson | null {
  if (reworkCount < 2) {
    return null;
  }

  return {
    id: generateLessonId(),
    source_type: 'rework',
    source_task_id: taskId,
    source_worker_type: workerType,
    repo,
    scope: '',
    category: 'process',
    rule: 'Reduce rework through better requirements',
    rationale: rootCause,
    trigger_paths: [],
    trigger_tags: ['rework'],
    severity: 'info',
    created_at: new Date().toISOString(),
  };
}

function matchRepo(criteriaRepo: string, lessonRepo: string): boolean {
  if (criteriaRepo === lessonRepo) {
    return true;
  }
  const criteriaOrg = criteriaRepo.split('/')[0];
  const lessonOrg = lessonRepo.split('/')[0];
  return criteriaOrg === lessonOrg;
}

function matchScope(criteriaScope: string, lessonTriggerPaths: string[]): boolean {
  if (!criteriaScope || lessonTriggerPaths.length === 0) {
    return false;
  }
  const normalizedScope = criteriaScope.replace(/\*\*$/, '').replace(/\/$/, '');
  return lessonTriggerPaths.some(path => {
    const normalizedPath = path.replace(/\*\*$/, '').replace(/\/$/, '');
    return normalizedScope.startsWith(normalizedPath) || normalizedPath.startsWith(normalizedScope);
  });
}

function matchScopes(scopes: string[], lessonTriggerPaths: string[]): boolean {
  if (!scopes || scopes.length === 0 || lessonTriggerPaths.length === 0) {
    return false;
  }
  return scopes.some(scope => matchScope(scope, lessonTriggerPaths));
}

function matchCategory(criteriaCategory: string, lessonCategory: string): boolean {
  if (!criteriaCategory) {
    return false;
  }
  return criteriaCategory.toLowerCase() === lessonCategory.toLowerCase();
}

function matchWorkerType(criteriaWorkerType: string, lessonWorkerType: string): boolean {
  if (!criteriaWorkerType) {
    return false;
  }
  return criteriaWorkerType.toLowerCase() === lessonWorkerType.toLowerCase();
}

export function shouldInjectLesson(lesson: Lesson, criteria: LessonCriteria): boolean {
  if (!criteria.repo || !matchRepo(criteria.repo, lesson.repo)) {
    return false;
  }

  const scopes = Array.isArray(criteria.scope) ? criteria.scope : criteria.scope ? [criteria.scope] : [];
  const scopeMatch = scopes.length > 0 && matchScopes(scopes, lesson.trigger_paths);
  const categoryMatch = criteria.category ? matchCategory(criteria.category, lesson.category) : false;
  const workerTypeMatch = criteria.worker_type ? matchWorkerType(criteria.worker_type, lesson.source_worker_type) : false;

  return scopeMatch || categoryMatch || workerTypeMatch;
}

export function filterLessonsForInjection(lessons: Lesson[], criteria: LessonCriteria): Lesson[] {
  return lessons
    .filter(lesson => shouldInjectLesson(lesson, criteria))
    .sort((a, b) => {
      const severityOrder: Record<string, number> = { critical: 0, warning: 1, info: 2 };
      return severityOrder[a.severity] - severityOrder[b.severity];
    });
}

export function loadMemoryStore(stateDir: string | null): MemoryStore | null {
  const memoryPath = stateDir
    ? path.join(stateDir, "memory.json")
    : null;

  if (!memoryPath || !fs.existsSync(memoryPath)) {
    return null;
  }

  try {
    const content = fs.readFileSync(memoryPath, "utf8");
    return JSON.parse(content);
  } catch {
    return null;
  }
}

export function injectLessonsIntoContext(contextMarkdown: string, lessons: Lesson[], options: { maxLessons?: number } = {}): string {
  if (!lessons || lessons.length === 0) {
    return contextMarkdown;
  }

  const maxLessons = options.maxLessons ?? 5;

  const sortedLessons = [...lessons].sort((a, b) => {
    const severityOrder: Record<string, number> = { critical: 0, warning: 1, info: 2 };
    return severityOrder[a.severity] - severityOrder[b.severity];
  });

  const selectedLessons = sortedLessons.slice(0, maxLessons);

  const lessonsSection = selectedLessons.map(lesson => {
    const severityIcon = lesson.severity === 'critical' ? '⚠️'
      : lesson.severity === 'warning' ? '⚡'
      : 'ℹ️';

    let entry = `### ${severityIcon} [${lesson.severity.toUpperCase()}] ${lesson.category}: ${lesson.rule}\n`;
    entry += `**Rationale**: ${lesson.rationale}\n`;

    if (lesson.trigger_paths && lesson.trigger_paths.length > 0) {
      entry += `**Trigger Paths**: ${lesson.trigger_paths.join(', ')}\n`;
    }

    if (lesson.source_type) {
      entry += `**Source**: ${lesson.source_type}\n`;
    }

    return entry;
  }).join('\n');

  const header = `---
## 📚 Relevant Lessons from Past Reviews

`;
  const footer = `
---

*These lessons are selectively injected based on repo/scope/category match.*
`;

  return contextMarkdown + header + lessonsSection + footer;
}
