import { useCallback, useMemo, useState } from 'react';

import { AiPanel } from './components/AiPanel';
import { CommandPalette, type CommandItem } from './components/CommandPalette';
import { DiagnosticsDialog } from './components/DiagnosticsDialog';
import { PostDialog } from './components/PostDialog';
import { Sidebar } from './components/Sidebar';
import { ErrorState, Spinner } from './components/States';
import { Workspace } from './components/Workspace';
import { useReviewer } from './state/useReviewer';

export default function App() {
  const { state, actions } = useReviewer();
  const [copiedFlash, setCopiedFlash] = useState(false);
  const [focusFile, setFocusFile] = useState<string | null>(null);

  const copyReview = useCallback(async () => {
    if (!state.review.data) return;
    await navigator.clipboard.writeText(state.review.data.markdown);
    setCopiedFlash(true);
    window.setTimeout(() => setCopiedFlash(false), 1600);
  }, [state.review.data]);

  const handleJumpToFile = useCallback(
    (file: string) => {
      setFocusFile(file);
      actions.setWorkspaceTab('diff');
    },
    [actions],
  );

  const commands: CommandItem[] = useMemo(
    () => [
      {
        id: 'generate',
        label: state.review.status === 'ready' ? 'Regenerate review' : 'Generate review',
        hint: '⌘⏎',
        disabled: state.detail.status !== 'ready' || !state.provider || state.review.status === 'loading',
        run: () => void actions.generateReview(),
      },
      {
        id: 'post',
        label: 'Post review to GitHub…',
        disabled: state.review.status !== 'ready' || state.postPhase === 'posting',
        run: actions.requestPost,
      },
      {
        id: 'copy',
        label: 'Copy review Markdown',
        disabled: state.review.status !== 'ready',
        run: () => void copyReview(),
      },
      {
        id: 'new',
        label: 'New review session',
        run: actions.newReview,
      },
      {
        id: 'diff',
        label: 'Show Diff tab',
        run: () => actions.setWorkspaceTab('diff'),
      },
      {
        id: 'review-tab',
        label: 'Show Review tab',
        run: () => actions.setWorkspaceTab('review'),
      },
      {
        id: 'activity',
        label: 'Show Activity tab',
        run: () => actions.setWorkspaceTab('activity'),
      },
      {
        id: 'toggle-ai',
        label: state.aiPanelOpen ? 'Hide AI panel' : 'Show AI panel',
        hint: '⌘B',
        run: actions.toggleAiPanel,
      },
      {
        id: 'diagnostics',
        label: 'Open settings and diagnostics',
        run: actions.openDiagnostics,
      },
      {
        id: 'login',
        label: 'Sign in to GitHub',
        disabled: !!state.auth.data?.authenticated,
        run: () => void actions.login(),
      },
    ],
    [state, actions, copyReview],
  );

  if (state.backend.status === 'failed') {
    return (
      <div className="app app--blocked">
        <main className="blocked">
          <div className="blocked__brand">
            <span className="sidebar__mark" aria-hidden="true" />
            <span className="sidebar__name">PR Reviewer</span>
          </div>
          <ErrorState
            error={{ code: state.backend.code, message: state.backend.message }}
            nextAction="Install the Python engine with pip install -e ., then start the app again."
          />
          <p className="blocked__hint">
            The desktop UI needs the Python review engine. Install it with <code>pip install -e .</code> in
            the gh-pr-reviewer repository, then start the app again.
          </p>
        </main>
      </div>
    );
  }

  if (state.backend.status !== 'ready') {
    return (
      <div className="app app--blocked">
        <main className="blocked">
          <div className="blocked__brand">
            <span className="sidebar__mark" aria-hidden="true" />
            <span className="sidebar__name">PR Reviewer</span>
          </div>
          <Spinner label="Starting the Python review engine…" />
        </main>
      </div>
    );
  }

  return (
    <div className={state.aiPanelOpen ? 'app app--shell' : 'app app--shell app--ai-collapsed'}>
      <Sidebar
        state={state}
        onNewReview={actions.newReview}
        onSearchRepos={actions.searchRepos}
        onSelectRepo={(repo) => void actions.selectRepo(repo)}
        onSelectPr={(number) => void actions.selectPullRequest(number)}
        onOpenSession={(repo, number) => void actions.selectPullRequest(number, repo)}
        onOpenDiagnostics={actions.openDiagnostics}
        onResize={actions.resizeSidebar}
      />

      <div className="shell-main">
        {state.auth.status === 'loading' ? (
          <p className="notice" role="status">
            Checking GitHub…
          </p>
        ) : null}

        {state.auth.status === 'ready' && !state.auth.data?.authenticated ? (
          <p className="notice notice--warn">
            {state.auth.data?.ghInstalled
              ? 'Sign in to GitHub to load repositories. The sign-in flow opens in a terminal.'
              : 'The GitHub CLI (gh) is not installed. Install it from cli.github.com, then sign in.'}
            {state.auth.data?.ghInstalled ? (
              <>
                {' '}
                <button type="button" className="btn btn--small" onClick={() => void actions.login()}>
                  Sign in to GitHub
                </button>
              </>
            ) : null}
          </p>
        ) : null}

        {copiedFlash ? <p className="notice notice--ok">Review Markdown copied.</p> : null}

        <Workspace
          state={state}
          onOpenExternal={actions.openExternal}
          onTab={actions.setWorkspaceTab}
          onSelectFinding={actions.setSelectedFindingIndex}
          onFilter={actions.setSeverityFilter}
          onRetry={() => void actions.generateReview()}
          onShowAiPanel={() => actions.setAiPanelOpen(true)}
          onJumpToFile={handleJumpToFile}
          focusFile={focusFile}
        />
      </div>

      {state.aiPanelOpen ? (
        <AiPanel
          state={state}
          onSelectProvider={actions.setProvider}
          onGenerate={() => void actions.generateReview()}
          onPost={actions.requestPost}
          onCopy={() => void copyReview()}
          onFilter={actions.setSeverityFilter}
          onClose={() => actions.setAiPanelOpen(false)}
        />
      ) : null}

      <PostDialog
        phase={state.postPhase}
        repo={state.selectedRepo}
        prNumber={state.selectedPr}
        error={state.postError}
        onCancel={actions.cancelPost}
        onConfirm={() => void actions.confirmPost()}
      />

      <CommandPalette
        open={state.commandPaletteOpen}
        state={state}
        onClose={() => actions.setCommandPaletteOpen(false)}
        commands={commands}
      />

      <DiagnosticsDialog
        open={state.diagnosticsOpen}
        state={state}
        onClose={actions.closeDiagnostics}
        onLogin={() => void actions.login()}
        onSetupMcp={() => void actions.setupMcp()}
        onRefresh={() => void actions.loadDiagnostics()}
      />
    </div>
  );
}
