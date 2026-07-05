import { extractResponseError, parseJsonResponse } from './http';

export type ReviewDecisionKind = 'merge' | 'rework' | 'block';

export interface ReviewDecisionInput {
  reasonCode?: string;
  mustFix?: string[];
  canRedrive?: boolean;
  redriveStrategy?: string;
  acknowledgeRisk?: boolean;
}

export async function postReviewDecision(input: {
  taskId: string;
  decision: ReviewDecisionKind;
  reviewInput: ReviewDecisionInput;
  notes: string;
}) {
  const res = await fetch(`/api/reviews/${encodeURIComponent(input.taskId)}/decision`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      decision: input.decision,
      actor: 'console-ui',
      notes: input.notes,
      acknowledgeRisk: input.reviewInput.acknowledgeRisk,
      evidence: {
        reasonCode: input.reviewInput.reasonCode,
        mustFix: input.reviewInput.mustFix,
        canRedrive: input.reviewInput.canRedrive,
        redriveStrategy: input.reviewInput.redriveStrategy,
      },
      at: new Date().toISOString(),
    }),
  });

  if (!res.ok) {
    const errorMessage = extractResponseError(await parseJsonResponse(res), 'Failed to submit review decision');
    throw new Error(errorMessage);
  }
}
