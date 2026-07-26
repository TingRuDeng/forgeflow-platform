import { describe, expect, it } from 'vitest';
import { resolveLatestProgress, resolveTaskFailure } from './taskFailure';

describe('resolveTaskFailure', () => {
  it('prefers the newest delivery failure over an older worker result', () => {
    expect(resolveTaskFailure({
      review: {
        latestWorkerResult: {
          generatedAt: '2026-07-26T10:00:00Z',
          output: 'verification failed',
          evidence: {
            failureType: 'verification',
            failureSummary: 'tests failed',
            blockers: [{
              kind: 'verification',
              code: 'verification_failed',
              message: 'tests failed',
            }],
          },
        },
      },
      attempts: [{
        status: 'failed',
        endedAt: '2026-07-26T10:00:00Z',
        failureCode: 'verification_failed',
        failureMessage: 'tests failed',
      }],
      events: [{
        type: 'delivery_failed',
        at: '2026-07-26T10:01:00Z',
        payload: {
          failureCode: 'delivery_failed',
          error: 'dispatcher did not acknowledge the result',
        },
      }],
    })).toEqual({
      type: 'execution',
      code: 'delivery_failed',
      summary: 'dispatcher did not acknowledge the result',
      at: '2026-07-26T10:01:00Z',
      source: 'runtime_event',
    });
  });

  it('uses attempt expiration when no worker result was acknowledged', () => {
    expect(resolveTaskFailure({
      attempts: [{
        status: 'expired',
        endedAt: '2026-07-26T10:02:00Z',
        failureCode: 'attempt_lease_expired',
        failureMessage: 'attempt lease expired before worker result was submitted',
      }],
    })).toMatchObject({
      type: 'execution',
      code: 'attempt_lease_expired',
      source: 'attempt',
    });
  });

  it('returns an empty result when no failure evidence exists', () => {
    expect(resolveTaskFailure({
      review: {
        latestWorkerResult: {
          generatedAt: '2026-07-26T10:00:00Z',
          output: 'completed successfully',
        },
      },
    })).toEqual({
      type: null,
      code: null,
      summary: null,
      at: null,
      source: null,
    });
  });

  it('does not surface historical attempt failures after the task succeeds', () => {
    expect(resolveTaskFailure({
      taskStatus: 'merged',
      review: {
        latestWorkerResult: {
          generatedAt: '2026-07-26T09:00:00Z',
          output: 'old worker result',
          evidence: {
            failureType: 'execution',
            failureSummary: 'old worker failure',
            blockers: [{
              kind: 'execution',
              code: 'transient_gateway_timeout',
              message: 'old worker failure',
            }],
          },
        },
      },
      attempts: [{
        status: 'failed',
        endedAt: '2026-07-26T09:00:00Z',
        failureCode: 'transient_gateway_timeout',
        failureMessage: 'old attempt failed',
      }],
      events: [{
        type: 'delivery_failed',
        at: '2026-07-26T09:00:00Z',
        payload: { failureCode: 'delivery_failed', error: 'old delivery failure' },
      }],
    })).toEqual({
      type: null,
      code: null,
      summary: null,
      at: null,
      source: null,
    });
  });
});

describe('resolveLatestProgress', () => {
  it('selects progress by timestamp rather than input order', () => {
    expect(resolveLatestProgress([
      { type: 'progress_reported', at: '2026-07-26T10:02:00Z', summary: 'newest' },
      { type: 'progress_reported', at: '2026-07-26T10:01:00Z', summary: 'older' },
    ])?.summary).toBe('newest');
  });
});
