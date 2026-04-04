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
export interface StructuredBlocker {
    code: string;
    summary: string;
    actionType: "auto_action" | "human_action";
    blocksCompletion: boolean;
}
export interface StructuredArtifactRef {
    kind: "log" | "report" | "file" | "url";
    label: string;
    value: string;
}
export interface StructuredWorkerResult {
    failureType?: "verification_failed" | "implementation_incomplete" | "blocked_external" | "blocked_human" | "infra_error";
    failureSummary?: string;
    blockers?: StructuredBlocker[];
    findings?: Finding[];
    artifacts?: StructuredArtifactRef[];
}
export interface StructuredReviewDecision {
    reasonCode?: "scope_miss" | "test_gap" | "quality_issue" | "behavior_regression" | "human_confirmation_required" | "other";
    mustFix?: string[];
    canRedrive?: boolean;
    redriveStrategy?: "same_worker_continue" | "redispatch_same_pool" | "manual_only";
}
export interface WorkerResult {
    status: string;
    verification: {
        commands: VerificationCommand[];
    };
    structured?: StructuredWorkerResult;
}
export interface LessonCriteria {
    repo?: string;
    scope?: string | string[];
    category?: string;
    worker_type?: string;
}
export declare function createMemoryStore(lessons?: Lesson[]): MemoryStore;
export declare function extractLessonFromReview(taskId: string, workerType: string, repo: string, finding: Finding, decision: string): Lesson | null;
export declare function extractLessonFromFailed(taskId: string, workerType: string, repo: string, result: WorkerResult, structured?: StructuredWorkerResult): Lesson | null;
export declare function extractLessonFromRework(taskId: string, workerType: string, repo: string, reworkCount: number, rootCause: string, structured?: StructuredReviewDecision): Lesson | null;
export declare function shouldInjectLesson(lesson: Lesson, criteria: LessonCriteria): boolean;
export declare function filterLessonsForInjection(lessons: Lesson[], criteria: LessonCriteria): Lesson[];
export declare function loadMemoryStore(stateDir: string | null): MemoryStore | null;
export declare function injectLessonsIntoContext(contextMarkdown: string, lessons: Lesson[], options?: {
    maxLessons?: number;
}): string;
