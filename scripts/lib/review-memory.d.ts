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
export interface WorkerEvidence {
    failureType?: string;
    failureSummary?: string;
    blockers?: Array<{
        reason: string;
    }>;
    findings?: Array<{
        title: string;
        recommendation: string;
    }>;
    artifacts?: Record<string, unknown>;
}
export interface ReviewEvidence {
    reasonCode?: string;
    mustFix?: string[];
    canRedrive?: boolean;
    redriveStrategy?: string;
}
export interface LessonCriteria {
    repo?: string;
    scope?: string | string[];
    category?: string;
    worker_type?: string;
}
export declare function createMemoryStore(lessons?: Lesson[]): MemoryStore;
export declare function extractLessonFromReview(taskId: string, workerType: string, repo: string, finding: Finding, decision: string): Lesson | null;
export declare function extractLessonFromFailed(taskId: string, workerType: string, repo: string, evidence: WorkerEvidence): Lesson | null;
export declare function extractLessonFromRework(taskId: string, workerType: string, repo: string, evidence: ReviewEvidence): Lesson | null;
export declare function shouldInjectLesson(lesson: Lesson, criteria: LessonCriteria): boolean;
export declare function filterLessonsForInjection(lessons: Lesson[], criteria: LessonCriteria): Lesson[];
export declare function loadMemoryStore(stateDir: string | null): MemoryStore | null;
export declare function injectLessonsIntoContext(contextMarkdown: string, lessons: Lesson[], options?: {
    maxLessons?: number;
}): string;
