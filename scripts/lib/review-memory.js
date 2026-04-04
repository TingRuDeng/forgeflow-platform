import fs from "node:fs";
import path from "node:path";
function pad(value, width = 2) {
    return String(Math.trunc(Math.abs(value))).padStart(width, "0");
}
function formatLocalTimestamp(date = new Date()) {
    const offsetMinutes = -date.getTimezoneOffset();
    const sign = offsetMinutes >= 0 ? "+" : "-";
    const absOffsetMinutes = Math.abs(offsetMinutes);
    const offsetHours = Math.floor(absOffsetMinutes / 60);
    const offsetRemainderMinutes = absOffsetMinutes % 60;
    return [
        `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
        `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`,
        `${sign}${pad(offsetHours)}:${pad(offsetRemainderMinutes)}`,
    ].join("");
}
export function createMemoryStore(lessons) {
    return {
        version: 1,
        lessons: lessons || [],
        updated_at: formatLocalTimestamp(),
    };
}
function generateLessonId() {
    return `lesson-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
const VALID_REVIEW_CATEGORIES = new Set(['structure', 'behavior']);
const VALID_REVIEW_SEVERITIES = new Set(['critical', 'warning']);
function hasActionableRecommendation(recommendation) {
    if (!recommendation || recommendation.length < 10) {
        return false;
    }
    const actionablePatterns = [
        'always', 'never', 'avoid', 'use', 'prefer',
        'should', 'must', 'ensure', 'make sure',
        'refactor', 'replace', 'implement', 'add', 'remove'
    ];
    return actionablePatterns.some(p => recommendation.toLowerCase().includes(p));
}
function isExtractableFromReview(finding, decision) {
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
function isExtractableFromFailed(result) {
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
function inferCategory(finding) {
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
function inferTriggerPaths(evidence) {
    if (evidence && evidence.file) {
        const parts = evidence.file.split('/');
        const dir = parts.slice(0, -1).join('/');
        return dir ? [`${dir}/**`, evidence.file] : [evidence.file];
    }
    return [];
}
export function extractLessonFromReview(taskId, workerType, repo, finding, decision) {
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
        trigger_tags: [finding.category].filter(Boolean),
        severity: finding.severity || 'warning',
        created_at: formatLocalTimestamp(),
    };
}
export function extractLessonFromFailed(taskId, workerType, repo, result, structured) {
    if (!isExtractableFromFailed(result) && !structured?.failureType) {
        return null;
    }
    if (structured?.failureType) {
        const categoryMap = {
            verification_failed: 'testing',
            implementation_incomplete: 'implementation',
            blocked_external: 'infrastructure',
            blocked_human: 'process',
            infra_error: 'infrastructure',
        };
        const category = categoryMap[structured.failureType] || 'other';
        const severity = structured.blockers && structured.blockers.length > 0 ? 'critical' : 'warning';
        let rule = '';
        let rationale = '';
        if (structured.failureSummary) {
            rule = structured.failureSummary;
            rationale = structured.failureSummary;
        }
        else if (structured.blockers && structured.blockers.length > 0) {
            rule = `Handle blocker: ${structured.blockers[0].code}`;
            rationale = structured.blockers.map(b => b.summary).join('; ');
        }
        else {
            rule = `Handle ${category} failures`;
            rationale = structured.failureType;
        }
        const triggerPaths = [];
        if (structured.findings) {
            for (const f of structured.findings) {
                if (f.evidence?.file) {
                    triggerPaths.push(f.evidence.file);
                }
            }
        }
        if (structured.artifacts) {
            for (const a of structured.artifacts) {
                if (a.kind === 'file') {
                    triggerPaths.push(a.value);
                }
            }
        }
        return {
            id: generateLessonId(),
            source_type: 'failed',
            source_task_id: taskId,
            source_worker_type: workerType,
            repo,
            scope: '',
            category,
            rule,
            rationale,
            trigger_paths: triggerPaths,
            trigger_tags: [category, structured.failureType],
            severity,
            created_at: formatLocalTimestamp(),
        };
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
        created_at: formatLocalTimestamp(),
    };
}
export function extractLessonFromRework(taskId, workerType, repo, reworkCount, rootCause, structured) {
    if (reworkCount < 2 && !structured?.reasonCode) {
        return null;
    }
    if (structured?.reasonCode) {
        const reasonCodeCategoryMap = {
            scope_miss: 'requirements',
            test_gap: 'testing',
            quality_issue: 'quality',
            behavior_regression: 'behavior',
            human_confirmation_required: 'process',
            other: 'other',
        };
        const category = reasonCodeCategoryMap[structured.reasonCode] || 'process';
        const severity = structured.canRedrive === false ? 'critical' : 'warning';
        let rule = '';
        let rationale = '';
        if (structured.mustFix && structured.mustFix.length > 0) {
            rule = structured.mustFix[0];
            rationale = structured.mustFix.join('; ');
        }
        else if (structured.reasonCode) {
            rule = `Address reason: ${structured.reasonCode}`;
            rationale = structured.reasonCode;
        }
        else {
            rule = 'Reduce rework through better requirements';
            rationale = rootCause;
        }
        return {
            id: generateLessonId(),
            source_type: 'rework',
            source_task_id: taskId,
            source_worker_type: workerType,
            repo,
            scope: '',
            category,
            rule,
            rationale,
            trigger_paths: [],
            trigger_tags: ['rework', structured.reasonCode].filter(Boolean),
            severity,
            created_at: formatLocalTimestamp(),
        };
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
        created_at: formatLocalTimestamp(),
    };
}
function matchRepo(criteriaRepo, lessonRepo) {
    if (criteriaRepo === lessonRepo) {
        return true;
    }
    const criteriaOrg = criteriaRepo.split('/')[0];
    const lessonOrg = lessonRepo.split('/')[0];
    return criteriaOrg === lessonOrg;
}
function matchScope(criteriaScope, lessonTriggerPaths) {
    if (!criteriaScope || lessonTriggerPaths.length === 0) {
        return false;
    }
    const normalizedScope = criteriaScope.replace(/\*\*$/, '').replace(/\/$/, '');
    return lessonTriggerPaths.some(path => {
        const normalizedPath = path.replace(/\*\*$/, '').replace(/\/$/, '');
        return normalizedScope.startsWith(normalizedPath) || normalizedPath.startsWith(normalizedScope);
    });
}
function matchScopes(scopes, lessonTriggerPaths) {
    if (!scopes || scopes.length === 0 || lessonTriggerPaths.length === 0) {
        return false;
    }
    return scopes.some(scope => matchScope(scope, lessonTriggerPaths));
}
function matchCategory(criteriaCategory, lessonCategory) {
    if (!criteriaCategory) {
        return false;
    }
    return criteriaCategory.toLowerCase() === lessonCategory.toLowerCase();
}
function matchWorkerType(criteriaWorkerType, lessonWorkerType) {
    if (!criteriaWorkerType) {
        return false;
    }
    return criteriaWorkerType.toLowerCase() === lessonWorkerType.toLowerCase();
}
export function shouldInjectLesson(lesson, criteria) {
    if (!criteria.repo || !matchRepo(criteria.repo, lesson.repo)) {
        return false;
    }
    const scopes = Array.isArray(criteria.scope) ? criteria.scope : criteria.scope ? [criteria.scope] : [];
    const scopeMatch = scopes.length > 0 && matchScopes(scopes, lesson.trigger_paths);
    const categoryMatch = criteria.category ? matchCategory(criteria.category, lesson.category) : false;
    const workerTypeMatch = criteria.worker_type ? matchWorkerType(criteria.worker_type, lesson.source_worker_type) : false;
    return scopeMatch || categoryMatch || workerTypeMatch;
}
export function filterLessonsForInjection(lessons, criteria) {
    return lessons
        .filter(lesson => shouldInjectLesson(lesson, criteria))
        .sort((a, b) => {
        const severityOrder = { critical: 0, warning: 1, info: 2 };
        return severityOrder[a.severity] - severityOrder[b.severity];
    });
}
export function loadMemoryStore(stateDir) {
    const memoryPath = stateDir
        ? path.join(stateDir, "memory.json")
        : null;
    if (!memoryPath || !fs.existsSync(memoryPath)) {
        return null;
    }
    try {
        const content = fs.readFileSync(memoryPath, "utf8");
        return JSON.parse(content);
    }
    catch {
        return null;
    }
}
export function injectLessonsIntoContext(contextMarkdown, lessons, options = {}) {
    if (!lessons || lessons.length === 0) {
        return contextMarkdown;
    }
    const maxLessons = options.maxLessons ?? 5;
    const sortedLessons = [...lessons].sort((a, b) => {
        const severityOrder = { critical: 0, warning: 1, info: 2 };
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
