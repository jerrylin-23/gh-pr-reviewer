/** Renderer-facing types. The bridge is fully typed — the renderer has no `any`. */

export type {
  ApiError,
  ApiResult,
  AuthStatus,
  BackendState,
  FindingPriority,
  GenerateReviewInput,
  McpStatus,
  PostReviewInput,
  PrReviewerApi,
  ProviderOption,
  PullRequestDetail,
  PullRequestMetadata,
  PullRequestSummary,
  ReviewDecision,
  ReviewFinding,
  ReviewResult,
  SkippedProvider,
  StructuredReview,
  SystemHealth,
} from '../shared/contract';

import type { ApiError, PrReviewerApi } from '../shared/contract';

declare global {
  interface Window {
    prReviewer: PrReviewerApi;
  }
}

/** Loading state for one remote value. */
export interface Async<T> {
  status: 'idle' | 'loading' | 'ready' | 'error';
  data: T | null;
  error: ApiError | null;
}

export const idle = <T>(): Async<T> => ({ status: 'idle', data: null, error: null });
export const loading = <T>(previous?: Async<T>): Async<T> => ({
  status: 'loading',
  data: previous?.data ?? null,
  error: null,
});
export const ready = <T>(data: T): Async<T> => ({ status: 'ready', data, error: null });
export const failed = <T>(error: ApiError): Async<T> => ({ status: 'error', data: null, error });
