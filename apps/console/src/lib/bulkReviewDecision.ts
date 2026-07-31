import {
  postReviewDecision,
  type ReviewDecisionInput,
  type ReviewFreshness,
} from './reviewDecision';

export interface BulkReviewResult {
  total: number;
  succeeded: string[];
  failed: Array<{ taskId: string; message: string }>;
}

export async function submitBulkReviewDecision(
  decision: 'merge' | 'rework' | 'block',
  taskIds: string[],
  input: ReviewDecisionInput,
  freshnessByTaskId: Record<string, ReviewFreshness | undefined> = {},
): Promise<BulkReviewResult> {
  const results = await Promise.allSettled(
    taskIds.map((taskId) => postReviewDecision({
      taskId,
      decision,
      reviewInput: {
        ...input,
        expectedFreshness: freshnessByTaskId[taskId],
      },
      notes: `${decision} from console bulk review`,
    })),
  );

  return {
    total: taskIds.length,
    succeeded: results.flatMap((result, index) => (
      result.status === 'fulfilled' ? [taskIds[index]] : []
    )),
    failed: results.flatMap((result, index) => {
      if (result.status !== 'rejected') return [];
      const message = result.reason instanceof Error ? result.reason.message : String(result.reason);
      return [{ taskId: taskIds[index], message }];
    }),
  };
}
