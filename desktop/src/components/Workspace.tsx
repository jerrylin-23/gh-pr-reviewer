/** Central workspace: Pull Request header, tabs, diff, findings, activity. */

import { useMemo, useState } from 'react';

import type { ReviewerState, SeverityFilter, WorkspaceTab } from '../state/useReviewer';
import { STATUS_LABEL, statusTone } from '../lib/reviewStatus';
import { DiffViewer, splitDiff } from './DiffViewer';
import { FindingCard } from './FindingCard';
import { Markdown } from './Markdown';
import { EmptyState, ErrorState, Spinner } from './States';
import { IconPanel } from './Icons';

const TABS: { id: WorkspaceTab; label: string }[] = [
  { id: 'diff', label: 'Diff' },
  { id: 'review', label: 'Review' },
  { id: 'activity', label: 'Activity' },
  { id: 'checks', label: 'Checks' },
];

function decisionTone(status: string | null): string {
  const value = (status ?? '').toLowerCase();
  if (value.includes('ready')) return 'ok';
  if (value.includes('block')) return 'bad';
  if (value.includes('need')) return 'warn';
  return 'neutral';
}

export function Workspace({
  state,
  onOpenExternal,
  onTab,
  onSelectFinding,
  onFilter,
  onRetry,
  onShowAiPanel,
  onJumpToFile,
  focusFile,
}: {
  state: ReviewerState;
  onOpenExternal: (url: string) => void;
  onTab: (tab: WorkspaceTab) => void;
  onSelectFinding: (index: number | null) => void;
  onFilter: (filter: SeverityFilter) => void;
  onRetry: () => void;
  onShowAiPanel: () => void;
  onJumpToFile: (file: string) => void;
  focusFile?: string | null;
}) {
  const [rawMarkdown, setRawMarkdown] = useState(false);
  const detail = state.detail;
  const review = state.review;
  const meta = detail.data?.metadata;
  const tone = statusTone(state.reviewStatus);

  const filteredFindings = useMemo(() => {
    const findings = review.data?.structured?.findings ?? [];
    if (state.severityFilter === 'all') return findings.map((finding, index) => ({ finding, index }));
    return findings
      .map((finding, index) => ({ finding, index }))
      .filter(({ finding }) => finding.priority === state.severityFilter);
  }, [review.data, state.severityFilter]);

  return (
    <section className="workspace" aria-label="Pull Request workspace">
      <header className="workspace__header">
        {detail.status === 'ready' && meta ? (
          <>
            <div className="workspace__title-row">
              <h1 className="workspace__title">{meta.title}</h1>
              <div className="workspace__header-actions">
                {!state.aiPanelOpen ? (
                  <button
                    type="button"
                    className="btn btn--ghost btn--small"
                    onClick={onShowAiPanel}
                    title="Show AI panel (⌘B)"
                  >
                    <IconPanel size={12} />
                    AI panel
                  </button>
                ) : null}
                {meta.url ? (
                  <button
                    type="button"
                    className="btn btn--ghost btn--small"
                    onClick={() => onOpenExternal(meta.url)}
                  >
                    Open on GitHub
                  </button>
                ) : null}
              </div>
            </div>
            <div className="workspace__facts">
              <span className="workspace__fact workspace__fact--mono">
                {state.selectedRepo} #{state.selectedPr}
              </span>
              <span className="workspace__fact">@{meta.author || 'unknown'}</span>
              <span className="workspace__fact workspace__fact--mono">
                {meta.headRefName} → {meta.baseRefName}
              </span>
              <span className="workspace__fact">{meta.changedFiles} files</span>
              <span className="workspace__fact workspace__fact--add">+{meta.additions}</span>
              <span className="workspace__fact workspace__fact--del">−{meta.deletions}</span>
              <span className={`pill pill--${tone}`}>{STATUS_LABEL[state.reviewStatus]}</span>
            </div>
          </>
        ) : (
          <div className="workspace__title-row">
            <h1 className="workspace__title workspace__title--muted">
              {state.selectedRepo ? 'Select a Pull Request' : 'Select a repository'}
            </h1>
            <div className="workspace__header-actions">
              {!state.aiPanelOpen ? (
                <button type="button" className="btn btn--ghost btn--small" onClick={onShowAiPanel}>
                  <IconPanel size={12} />
                  AI panel
                </button>
              ) : null}
              <span className={`pill pill--${tone}`}>{STATUS_LABEL[state.reviewStatus]}</span>
            </div>
          </div>
        )}
      </header>

      <nav className="workspace__tabs" aria-label="Workspace views">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={state.workspaceTab === tab.id ? 'workspace-tab workspace-tab--active' : 'workspace-tab'}
            onClick={() => onTab(tab.id)}
          >
            {tab.label}
            {tab.id === 'review' && review.data?.structured?.findings.length
              ? ` (${review.data.structured.findings.length})`
              : ''}
          </button>
        ))}
      </nav>

      <div className="workspace__body">
        {state.workspaceTab === 'diff' ? (
          <DiffViewer
            detail={detail}
            repo={state.selectedRepo}
            onOpenExternal={onOpenExternal}
            focusFile={focusFile ?? null}
          />
        ) : null}

        {state.workspaceTab === 'review' ? (
          <ReviewWorkspace
            state={state}
            filteredFindings={filteredFindings}
            rawMarkdown={rawMarkdown}
            onToggleRaw={() => setRawMarkdown((value) => !value)}
            onSelectFinding={onSelectFinding}
            onFilter={onFilter}
            onRetry={onRetry}
            onJumpToFile={onJumpToFile}
          />
        ) : null}

        {state.workspaceTab === 'activity' ? (
          <ActivityWorkspace state={state} />
        ) : null}

        {state.workspaceTab === 'checks' ? (
          <ChecksWorkspace state={state} />
        ) : null}
      </div>
    </section>
  );
}

function ReviewWorkspace({
  state,
  filteredFindings,
  rawMarkdown,
  onToggleRaw,
  onSelectFinding,
  onFilter,
  onRetry,
  onJumpToFile,
}: {
  state: ReviewerState;
  filteredFindings: { finding: import('../types').ReviewFinding; index: number }[];
  rawMarkdown: boolean;
  onToggleRaw: () => void;
  onSelectFinding: (index: number | null) => void;
  onFilter: (filter: SeverityFilter) => void;
  onRetry: () => void;
  onJumpToFile: (file: string) => void;
}) {
  const review = state.review;
  const canReview = state.detail.status === 'ready' && !!state.provider;

  if (review.status === 'loading') {
    return <Spinner label="Generating the review. Local AI CLIs can take a few minutes." />;
  }

  if (review.status === 'error' && review.error) {
    return (
      <ErrorState
        error={review.error}
        onRetry={canReview ? onRetry : undefined}
        retryLabel="Review again"
        nextAction={
          review.error.code === 'PROVIDER_UNAVAILABLE'
            ? 'Install or authenticate an AI CLI, then try again.'
            : 'Check the provider status in the AI panel, then regenerate.'
        }
      />
    );
  }

  if (review.status !== 'ready' || !review.data) {
    return (
      <EmptyState
        title="No review generated"
        hint={
          canReview
            ? 'Use Generate review in the AI panel, or press ⌘⏎.'
            : 'Load a Pull Request first, then generate a review.'
        }
      />
    );
  }

  const data = review.data;
  const structured = data.structured;
  const sourceLabel =
    data.participants.length > 1
      ? `Council · ${data.participants.join(', ')}`
      : data.provider;

  return (
    <div className="review-workspace">
      <div className="review-workspace__toolbar">
        <div className="review-provenance">
          <span className="pill pill--neutral">{data.provider}</span>
          {data.participants.length > 1 ? (
            <span className="review-provenance__item">
              Council: {data.participants.join(', ')}
              {data.moderator ? ` · moderator ${data.moderator}` : ''}
            </span>
          ) : null}
          {data.skipped.length > 0 ? (
            <span className="review-provenance__item review-provenance__item--warn">
              Skipped: {data.skipped.map((s) => `${s.provider} (${s.reason})`).join(', ')}
            </span>
          ) : null}
        </div>
        <div className="pane__actions">
          {structured ? (
            <button type="button" className="btn btn--ghost btn--small" onClick={onToggleRaw}>
              {rawMarkdown ? 'Structured view' : 'Markdown view'}
            </button>
          ) : null}
        </div>
      </div>

      {!structured ? (
        <p className="notice notice--warn notice--inline">
          Structured rendering was unavailable for this response. The original Markdown is shown below.
        </p>
      ) : null}

      {structured && !rawMarkdown ? (
        <>
          <div className={`decision decision--${decisionTone(structured.decision.status)}`}>
            <div className="decision__row">
              <span className="decision__label">Status</span>
              <span className="decision__value">{structured.decision.status ?? 'Unknown'}</span>
            </div>
            <div className="decision__row">
              <span className="decision__label">Risk</span>
              <span className="decision__value">{structured.decision.risk ?? 'Unknown'}</span>
            </div>
            {structured.decision.main_reason ? (
              <p className="decision__reason">{structured.decision.main_reason}</p>
            ) : null}
          </div>

          <div className="review-workspace__findings-head">
            <h3 className="section-title">
              Findings <span className="section-title__count">{structured.findings.length}</span>
            </h3>
            {state.severityFilter !== 'all' ? (
              <button type="button" className="btn btn--ghost btn--small" onClick={() => onFilter('all')}>
                Clear filter ({state.severityFilter})
              </button>
            ) : null}
          </div>

          {filteredFindings.length === 0 ? (
            <EmptyState
              title={structured.findings.length === 0 ? 'No blocking issues found.' : 'No findings match this filter.'}
            />
          ) : (
            filteredFindings.map(({ finding, index }) => (
              <FindingCard
                key={`${finding.title}-${index}`}
                finding={finding}
                selected={state.selectedFindingIndex === index}
                source={sourceLabel}
                onSelect={() => onSelectFinding(index)}
                onJumpToFile={onJumpToFile}
              />
            ))
          )}

          {structured.summary ? (
            <>
              <h3 className="section-title">Summary</h3>
              <Markdown source={structured.summary} />
            </>
          ) : null}
        </>
      ) : (
        <Markdown source={data.markdown} />
      )}
    </div>
  );
}

function ActivityWorkspace({ state }: { state: ReviewerState }) {
  if (state.activity.length === 0) {
    return <EmptyState title="No activity yet" hint="Select a Pull Request to start the review workflow." />;
  }

  return (
    <ol className="activity-list activity-list--workspace">
      {state.activity.map((step) => (
        <li key={step.id} className={`activity-item activity-item--${step.kind}`}>
          <span className="activity-item__dot" />
          <div>
            <p className="activity-item__label">{step.label}</p>
            {step.detail ? <p className="activity-item__detail">{step.detail}</p> : null}
          </div>
        </li>
      ))}
    </ol>
  );
}

function ChecksWorkspace({ state }: { state: ReviewerState }) {
  const providers = state.providers.data ?? [];
  const auth = state.auth.data;
  const files = state.detail.data ? splitDiff(state.detail.data.diff).length : 0;

  return (
    <div className="checks">
      <p className="checks__intro">
        Local readiness checks from the desktop bridge. GitHub Actions check runs are not loaded in this
        surface.
      </p>
      <ul className="checks__list">
        <li className={state.backend.status === 'ready' ? 'check check--ok' : 'check check--bad'}>
          <span>Python review engine</span>
          <span>{state.backend.status === 'ready' ? 'Ready' : state.backend.status}</span>
        </li>
        <li className={auth?.ghInstalled ? 'check check--ok' : 'check check--bad'}>
          <span>GitHub CLI</span>
          <span>{auth?.ghInstalled ? 'Installed' : 'Missing'}</span>
        </li>
        <li className={auth?.authenticated ? 'check check--ok' : 'check check--warn'}>
          <span>GitHub authentication</span>
          <span>{auth?.authenticated ? `@${auth.username}` : 'Required'}</span>
        </li>
        <li className={providers.length > 0 ? 'check check--ok' : 'check check--warn'}>
          <span>AI providers</span>
          <span>{providers.length > 0 ? providers.map((p) => p.value).join(', ') : 'None found'}</span>
        </li>
        <li className={state.detail.status === 'ready' ? 'check check--ok' : 'check check--neutral'}>
          <span>Diff loaded</span>
          <span>{state.detail.status === 'ready' ? `${files} file section(s)` : 'Not loaded'}</span>
        </li>
      </ul>
    </div>
  );
}
