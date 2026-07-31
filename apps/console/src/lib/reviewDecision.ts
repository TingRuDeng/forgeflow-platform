import { extractResponseError, parseJsonResponse } from './http';

export type ReviewDecisionKind = 'merge' | 'rework' | 'block';

export interface ReviewFreshness {
  attemptId: string;
  artifactBundleId: string;
  commitSha?: string;
}

export interface ReviewDecisionInput {
  reasonCode?: string;
  mustFix?: string[];
  canRedrive?: boolean;
  redriveStrategy?: string;
  acknowledgeRisk?: boolean;
  expectedFreshness?: ReviewFreshness;
}

export async function postReviewDecision(input: {
  taskId: string;
  decision: ReviewDecisionKind;
  reviewInput: ReviewDecisionInput;
  notes: string;
}) {
  if (!input.reviewInput.expectedFreshness) {
    throw new Error(`Review freshness is unavailable for task ${input.taskId}`);
  }
  const res = await fetch(`/api/reviews/${encodeURIComponent(input.taskId)}/decision`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      decision: input.decision,
      actor: 'console-ui',
      notes: input.notes,
      acknowledgeRisk: input.reviewInput.acknowledgeRisk,
      expectedFreshness: input.reviewInput.expectedFreshness,
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
