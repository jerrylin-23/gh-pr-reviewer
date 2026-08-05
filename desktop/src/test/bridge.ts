/** A fake preload bridge for renderer tests. Nothing here touches Electron. */

import { vi } from 'vitest';

import type {
  ApiResult,
  AuthStatus,
  BackendState,
  PrReviewerApi,
  PullRequestDetail,
  ReviewResult,
} from '../types';

export const okResult = <T>(data: T): ApiResult<T> => ({ success: true, data, error: null });

export const errResult = <T>(code: string, message: string): ApiResult<T> => ({
  success: false,
  data: null,
  error: { code, message },
});

export const AUTHENTICATED: AuthStatus = {
  authenticated: true,
  username: 'octocat',
  detail: null,
  ghInstalled: true,
};

export const SIGNED_OUT: AuthStatus = {
  authenticated: false,
  username: null,
  detail: 'You are not logged into any GitHub hosts.',
  ghInstalled: true,
};

export const PR_DETAIL: PullRequestDetail = {
  repo: 'octocat/hello',
  number: 7,
  metadata: {
    title: 'Add retry to the worker',
    author: 'octocat',
    additions: 24,
    deletions: 6,
    changedFiles: 2,
    url: 'https://github.com/octocat/hello/pull/7',
    state: 'OPEN',
    headRefName: 'retry',
    baseRefName: 'main',
  },
  diff: [
    'diff --git a/app/worker.py b/app/worker.py',
    '--- a/app/worker.py',
    '+++ b/app/worker.py',
    '@@ -1,3 +1,4 @@',
    '-old line',
    '+new line',
  ].join('\n'),
};

export const STRUCTURED_REVIEW: ReviewResult = {
  markdown: '## Decision\n- Status: `Needs changes`\n',
  structured: {
    decision: { status: 'Needs changes', risk: 'Medium', main_reason: 'The retry loop never stops.' },
    findings: [
      {
        priority: 'P1',
        title: 'Unbounded retry loop',
        file: 'app/worker.py',
        line: 42,
        evidence: 'The new while block has no attempt counter.',
        impact: 'A failing job pins one CPU core.',
        fix: 'Add a maximum attempt count.',
      },
    ],
    summary: 'The change adds retries but no ceiling.',
  },
  provider: 'claude',
  participants: ['claude'],
  moderator: null,
  skipped: [],
};

export interface FakeBridgeOptions {
  backend?: BackendState;
  auth?: ApiResult<AuthStatus>;
  repos?: ApiResult<{ repos: string[] }>;
  pulls?: ApiResult<{ repo: string; pullRequests: { number: number; title: string; author: null }[] }>;
  detail?: ApiResult<PullRequestDetail>;
  providers?: ApiResult<{ providers: { value: string; label: string }[] }>;
  review?: ApiResult<ReviewResult>;
  post?: ApiResult<{ repo: string; number: number; posted: boolean }>;
}

/** Install a fake `window.prReviewer` and return it for assertions. */
export function installBridge(options: FakeBridgeOptions = {}) {
  const backendState: BackendState = options.backend ?? { status: 'ready', port: 51234 };
  const listeners = new Set<(state: BackendState) => void>();

  const api = {
    auth: {
      status: vi.fn().mockResolvedValue(options.auth ?? okResult(AUTHENTICATED)),
      login: vi.fn().mockResolvedValue(okResult({ authenticated: false, message: 'Opened a terminal.' })),
    },
    repos: {
      list: vi.fn().mockResolvedValue(options.repos ?? okResult({ repos: ['octocat/hello'] })),
      search: vi.fn().mockResolvedValue(okResult({ repos: [] })),
    },
    pullRequests: {
      list: vi
        .fn()
        .mockResolvedValue(
          options.pulls ??
            okResult({
              repo: 'octocat/hello',
              pullRequests: [{ number: 7, title: 'Add retry to the worker', author: null }],
            }),
        ),
      load: vi.fn().mockResolvedValue(options.detail ?? okResult(PR_DETAIL)),
    },
    providers: {
      list: vi.fn().mockResolvedValue(
        options.providers ?? okResult({ providers: [{ value: 'claude', label: 'Claude CLI' }] }),
      ),
    },
    review: {
      generate: vi.fn().mockResolvedValue(options.review ?? okResult(STRUCTURED_REVIEW)),
      post: vi
        .fn()
        .mockResolvedValue(options.post ?? okResult({ repo: 'octocat/hello', number: 7, posted: true })),
    },
    mcp: {
      status: vi.fn().mockResolvedValue(okResult({ configured: false, exists: false, path: '' })),
      setup: vi.fn().mockResolvedValue(okResult({ success: true, path: '', command: '' })),
    },
    system: {
      health: vi.fn(),
      openExternal: vi.fn().mockResolvedValue(okResult({ opened: true })),
      backendState: () => backendState,
      refreshBackendState: vi.fn().mockResolvedValue(backendState),
      onBackendState: (listener: (state: BackendState) => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
  };

  (window as unknown as { prReviewer: PrReviewerApi }).prReviewer = api as unknown as PrReviewerApi;
  return api;
}
