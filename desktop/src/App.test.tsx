import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import App from './App';
import {
  AUTHENTICATED,
  PR_DETAIL,
  SIGNED_OUT,
  STRUCTURED_REVIEW,
  errResult,
  installBridge,
  okResult,
} from './test/bridge';

afterEach(cleanup);

async function renderReady(options: Parameters<typeof installBridge>[0] = {}) {
  const api = installBridge(options);
  render(<App />);
  await screen.findByText('@octocat');
  return api;
}

describe('backend state', () => {
  it('shows a starting state before the backend is ready', () => {
    installBridge({ backend: { status: 'starting' } });
    render(<App />);
    expect(screen.getByText(/Starting the Python review engine/)).toBeTruthy();
  });

  it('shows an actionable error when the backend fails', () => {
    installBridge({
      backend: { status: 'failed', code: 'BACKEND_NOT_FOUND', message: 'Could not find the backend.' },
    });
    render(<App />);
    expect(screen.getByText('BACKEND_NOT_FOUND')).toBeTruthy();
    expect(screen.getByText('Could not find the backend.')).toBeTruthy();
    expect(screen.getAllByText(/pip install -e ./).length).toBeGreaterThan(0);
  });
});

describe('authentication', () => {
  it('shows a loading state, then the username', async () => {
    installBridge({ auth: okResult(AUTHENTICATED) });
    render(<App />);
    expect(screen.getByText('Checking GitHub…')).toBeTruthy();
    expect(await screen.findByText('@octocat')).toBeTruthy();
  });

  it('offers sign-in and explains the flow when signed out', async () => {
    installBridge({ auth: okResult(SIGNED_OUT) });
    render(<App />);
    expect(await screen.findByRole('button', { name: /Sign in to GitHub/ })).toBeTruthy();
    expect(screen.getByText(/The sign-in flow opens in a terminal/)).toBeTruthy();
  });

  it('explains a missing GitHub CLI', async () => {
    installBridge({ auth: okResult({ ...SIGNED_OUT, ghInstalled: false }) });
    render(<App />);
    expect(await screen.findByText(/The GitHub CLI \(gh\) is not installed/)).toBeTruthy();
  });
});

describe('repositories and Pull Requests', () => {
  it('lists repository suggestions from the account', async () => {
    await renderReady({ repos: okResult({ repos: ['octocat/hello', 'octocat/world'] }) });
    fireEvent.focus(screen.getByLabelText('Repository'));
    expect(await screen.findByRole('button', { name: 'octocat/world' })).toBeTruthy();
  });

  it('shows an empty Pull Request state', async () => {
    const api = await renderReady({
      pulls: okResult({ repo: 'octocat/hello', pullRequests: [] }),
    });
    fireEvent.focus(screen.getByLabelText('Repository'));
    fireEvent.mouseDown(await screen.findByRole('button', { name: 'octocat/hello' }));
    await waitFor(() => expect(api.pullRequests.list).toHaveBeenCalledWith('octocat/hello'));
    expect(await screen.findByText('No open Pull Requests')).toBeTruthy();
  });

  it('loads metadata and the diff for the selected Pull Request', async () => {
    const api = await renderReady();
    fireEvent.focus(screen.getByLabelText('Repository'));
    fireEvent.mouseDown(await screen.findByRole('button', { name: 'octocat/hello' }));
    await waitFor(() => expect(api.pullRequests.list).toHaveBeenCalled());

    fireEvent.change(screen.getByLabelText('Pull Request'), { target: { value: '7' } });
    await waitFor(() => expect(api.pullRequests.load).toHaveBeenCalledWith('octocat/hello', 7));
    expect(await screen.findAllByText('Add retry to the worker')).toBeTruthy();
    expect(screen.getByText('app/worker.py')).toBeTruthy();
  });

  it('shows an error state when the Pull Request cannot load', async () => {
    const api = await renderReady({ detail: errResult('PR_LOAD_FAILED', 'gh could not read that PR.') });
    fireEvent.focus(screen.getByLabelText('Repository'));
    fireEvent.mouseDown(await screen.findByRole('button', { name: 'octocat/hello' }));
    await waitFor(() => expect(api.pullRequests.list).toHaveBeenCalled());
    fireEvent.change(screen.getByLabelText('Pull Request'), { target: { value: '7' } });
    expect(await screen.findAllByText('gh could not read that PR.')).toBeTruthy();
  });

  it('shows the empty diff placeholder before anything is loaded', async () => {
    await renderReady();
    expect(screen.getByText('No diff loaded')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Review' }));
    expect(screen.getByText('No review generated')).toBeTruthy();
  });
});

async function loadPullRequest(api: ReturnType<typeof installBridge>) {
  fireEvent.focus(screen.getByLabelText('Repository'));
  fireEvent.mouseDown(await screen.findByRole('button', { name: 'octocat/hello' }));
  await waitFor(() => expect(api.pullRequests.list).toHaveBeenCalled());
  fireEvent.change(screen.getByLabelText('Pull Request'), { target: { value: '7' } });
  await screen.findAllByText(PR_DETAIL.metadata.title);
}

describe('review generation', () => {
  it('renders structured findings', async () => {
    const api = await renderReady();
    await loadPullRequest(api);

    fireEvent.click(screen.getByRole('button', { name: 'Generate review' }));
    expect(await screen.findByText('Unbounded retry loop')).toBeTruthy();
    expect(screen.getAllByText('P1').length).toBeGreaterThan(0);
    expect(screen.getByText('app/worker.py:42')).toBeTruthy();
    expect(screen.getAllByText('Needs changes').length).toBeGreaterThan(0);
    expect(api.review.generate).toHaveBeenCalledWith({ provider: 'claude', diff: PR_DETAIL.diff });
  });

  it('falls back to Markdown and warns when parsing failed', async () => {
    const api = await renderReady({
      review: okResult({
        ...STRUCTURED_REVIEW,
        structured: null,
        markdown: '# Free text\n\nI could not follow the template.',
      }),
    });
    await loadPullRequest(api);

    fireEvent.click(screen.getByRole('button', { name: 'Generate review' }));
    expect(await screen.findByText(/Structured rendering was unavailable/)).toBeTruthy();
    expect(screen.getByText('Free text')).toBeTruthy();
  });

  it('shows council participants and skipped providers', async () => {
    const api = await renderReady({
      review: okResult({
        ...STRUCTURED_REVIEW,
        provider: 'council',
        participants: ['claude', 'codex'],
        moderator: 'claude',
        skipped: [{ provider: 'antigravity', reason: 'quota or usage limit' }],
      }),
    });
    await loadPullRequest(api);

    fireEvent.click(screen.getByRole('button', { name: 'Generate review' }));
    expect(await screen.findByText(/Council: claude, codex/)).toBeTruthy();
    expect(screen.getByText(/antigravity \(quota or usage limit\)/)).toBeTruthy();
  });

  it('shows a review error state with a retry action', async () => {
    const api = await renderReady({
      review: errResult('PROVIDER_TIMEOUT', 'claude timed out after 5 minutes.'),
    });
    await loadPullRequest(api);

    fireEvent.click(screen.getByRole('button', { name: 'Generate review' }));
    expect(await screen.findByText('PROVIDER_TIMEOUT')).toBeTruthy();
    expect(screen.getAllByText('claude timed out after 5 minutes.').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Review again' })).toBeTruthy();
  });
});

describe('posting', () => {
  async function reachPostable() {
    const api = await renderReady();
    await loadPullRequest(api);
    fireEvent.click(screen.getByRole('button', { name: 'Generate review' }));
    await screen.findByText('Unbounded retry loop');
    return api;
  }

  it('requires an explicit confirmation before posting', async () => {
    const api = await reachPostable();
    fireEvent.click(screen.getByRole('button', { name: 'Post to GitHub' }));

    expect(await screen.findByText('Post this review to GitHub?')).toBeTruthy();
    expect(api.review.post).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByText('Post this review to GitHub?')).toBeNull());
    expect(api.review.post).not.toHaveBeenCalled();
  });

  it('posts after confirmation and reports success', async () => {
    const api = await reachPostable();
    fireEvent.click(screen.getByRole('button', { name: 'Post to GitHub' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Post review' }));

    await waitFor(() =>
      expect(api.review.post).toHaveBeenCalledWith({
        repo: 'octocat/hello',
        number: 7,
        body: STRUCTURED_REVIEW.markdown,
        confirm: true,
      }),
    );
    expect(await screen.findByText('Review posted')).toBeTruthy();
  });

  it('reports a posting failure', async () => {
    const api = installBridge({ post: errResult('POST_FAILED', 'GitHub rejected the review.') });
    render(<App />);
    await screen.findByText('@octocat');
    await loadPullRequest(api);
    fireEvent.click(screen.getByRole('button', { name: 'Generate review' }));
    await screen.findByText('Unbounded retry loop');

    fireEvent.click(screen.getByRole('button', { name: 'Post to GitHub' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Post review' }));

    expect(await screen.findByText('Posting failed')).toBeTruthy();
    expect(screen.getByText('GitHub rejected the review.')).toBeTruthy();
  });
});

describe('cockpit layout', () => {
  it('renders the three-region shell with AI activity', async () => {
    await renderReady();
    expect(screen.getByLabelText('Review sessions')).toBeTruthy();
    expect(screen.getByLabelText('Pull Request workspace')).toBeTruthy();
    expect(screen.getByLabelText('AI review agents')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'New review' })).toBeTruthy();
    expect(screen.getByText('Fetching Pull Request')).toBeTruthy();
  });
});

describe('renderer isolation', () => {
  it('has no Node globals', () => {
    expect((globalThis as Record<string, unknown>).require).toBeUndefined();
    expect((globalThis as Record<string, unknown>).module).toBeUndefined();
    expect((window as unknown as Record<string, unknown>).ipcRenderer).toBeUndefined();
    expect((window as unknown as Record<string, unknown>).electron).toBeUndefined();
  });
});
