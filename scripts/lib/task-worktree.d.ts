interface TaskInfo {
    taskId?: string;
    task_id?: string;
    branchName?: string;
    branch?: string;
    defaultBranch?: string;
    default_branch?: string;
}
interface PrepareOptions {
    allowReuse?: boolean;
}
export declare function safeTaskDirName(taskId: unknown): string;
export declare function prepareTaskWorktree(repoDir: string, task: TaskInfo, options?: PrepareOptions): string;
export {};
