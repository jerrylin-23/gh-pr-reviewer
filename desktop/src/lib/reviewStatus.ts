/** Derive a single review-workflow status from real app state. */

import type { Async, PullRequestDetail, ReviewResult } from '../types';
import type { PostPhase } from '../state/useReviewer';

export type ReviewWorkflowStatus =
  | 'not_loaded'
  | 'loading'
  | 'ready_to_review'
  | 'reviewing'
  | 'review_complete'
  | 'review_failed'
  | 'ready_to_post'
  | 'posted'
  | 'post_failed';

export function deriveReviewStatus(input: {
  detail: Async<PullRequestDetail>;
  review: Async<ReviewResult>;
  postPhase: PostPhase;
}): ReviewWorkflowStatus {
  const { detail, review, postPhase } = input;

  if (postPhase === 'posted') return 'posted';
  if (postPhase === 'error') return 'post_failed';
  if (review.status === 'loading') return 'reviewing';
  if (review.status === 'error') return 'review_failed';
  if (review.status === 'ready') {
    return postPhase === 'confirming' || postPhase === 'posting' || postPhase === 'idle'
      ? 'ready_to_post'
      : 'review_complete';
  }
  if (detail.status === 'loading') return 'loading';
  if (detail.status === 'ready') return 'ready_to_review';
  return 'not_loaded';
}

export const STATUS_LABEL: Record<ReviewWorkflowStatus, string> = {
  not_loaded: 'Not loaded',
  loading: 'Loading',
  ready_to_review: 'Ready to review',
  reviewing: 'Reviewing',
  review_complete: 'Review complete',
  review_failed: 'Review failed',
  ready_to_post: 'Ready to post',
  posted: 'Posted',
  post_failed: 'Post failed',
};

export function statusTone(status: ReviewWorkflowStatus): 'ok' | 'warn' | 'bad' | 'neutral' | 'info' {
  switch (status) {
    case 'posted':
    case 'review_complete':
    case 'ready_to_post':
      return 'ok';
    case 'loading':
    case 'reviewing':
    case 'ready_to_review':
      return 'info';
    case 'review_failed':
    case 'post_failed':
      return 'bad';
    default:
      return 'neutral';
  }
}
