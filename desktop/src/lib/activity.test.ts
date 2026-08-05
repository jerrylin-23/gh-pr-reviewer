import { describe, expect, it } from 'vitest';

import { buildActivitySteps } from './activity';
import { deriveReviewStatus } from './reviewStatus';
import { failed, idle, loading, ready } from '../types';
import type { PullRequestDetail, ReviewResult } from '../types';

const DETAIL = {
  repo: 'o/r',
  number: 1,
  metadata: {
    title: 't',
    author: 'a',
    additions: 1,
    deletions: 0,
    changedFiles: 1,
    url: 'https://example.com',
    state: 'OPEN',
    headRefName: 'h',
    baseRefName: 'main',
  },
  diff: 'diff',
} satisfies PullRequestDetail;

const REVIEW = {
  markdown: '# ok',
  structured: null,
  provider: 'claude',
  participants: ['claude'],
  moderator: null,
  skipped: [],
} satisfies ReviewResult;

describe('deriveReviewStatus', () => {
  it('maps real state to workflow labels', () => {
    expect(deriveReviewStatus({ detail: idle(), review: idle(), postPhase: 'idle' })).toBe('not_loaded');
    expect(deriveReviewStatus({ detail: loading(), review: idle(), postPhase: 'idle' })).toBe('loading');
    expect(deriveReviewStatus({ detail: ready(DETAIL), review: idle(), postPhase: 'idle' })).toBe(
      'ready_to_review',
    );
    expect(deriveReviewStatus({ detail: ready(DETAIL), review: loading(), postPhase: 'idle' })).toBe(
      'reviewing',
    );
    expect(deriveReviewStatus({ detail: ready(DETAIL), review: ready(REVIEW), postPhase: 'idle' })).toBe(
      'ready_to_post',
    );
    expect(deriveReviewStatus({ detail: ready(DETAIL), review: ready(REVIEW), postPhase: 'posted' })).toBe(
      'posted',
    );
  });
});

describe('buildActivitySteps', () => {
  it('does not invent progress when idle', () => {
    const steps = buildActivitySteps({
      detail: idle(),
      review: idle(),
      provider: 'claude',
      providers: [{ value: 'claude', label: 'Claude CLI' }],
    });
    expect(steps).toEqual([{ id: 'fetch', label: 'Fetching Pull Request', kind: 'pending' }]);
  });

  it('marks real review completion from backend data', () => {
    const steps = buildActivitySteps({
      detail: ready(DETAIL),
      review: ready(REVIEW),
      provider: 'claude',
      providers: [{ value: 'claude', label: 'Claude CLI' }],
    });
    expect(steps.some((step) => step.label === 'Running Claude CLI' && step.kind === 'done')).toBe(true);
    expect(steps.some((step) => step.label === 'Review ready' && step.kind === 'done')).toBe(true);
  });

  it('surfaces failed provider errors from backend state', () => {
    const steps = buildActivitySteps({
      detail: ready(DETAIL),
      review: failed({ code: 'PROVIDER_TIMEOUT', message: 'timed out' }),
      provider: 'claude',
      providers: [{ value: 'claude', label: 'Claude CLI' }],
    });
    expect(steps.at(-1)?.kind).toBe('failed');
    expect(steps.at(-1)?.detail).toBe('timed out');
  });
});
