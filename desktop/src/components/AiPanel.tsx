/** Right AI agent panel: provider, activity, filters, generate actions. */

import type { FindingPriority } from '../types';
import type { ReviewerState, SeverityFilter } from '../state/useReviewer';
import { STATUS_LABEL, statusTone } from '../lib/reviewStatus';
import { IconCheck, IconCopy, IconRefresh, IconSpark, IconX } from './Icons';

const FILTERS: { value: SeverityFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'P0', label: 'P0' },
  { value: 'P1', label: 'P1' },
  { value: 'P2', label: 'P2' },
  { value: 'P3', label: 'P3' },
];

function countByPriority(findings: { priority: FindingPriority | null }[]): Record<FindingPriority, number> {
  const counts: Record<FindingPriority, number> = { P0: 0, P1: 0, P2: 0, P3: 0 };
  for (const finding of findings) {
    const priority = finding.priority;
    if (priority === 'P0' || priority === 'P1' || priority === 'P2' || priority === 'P3') {
      counts[priority] = counts[priority] + 1;
    }
  }
  return counts;
}

export function AiPanel({
  state,
  onSelectProvider,
  onGenerate,
  onPost,
  onCopy,
  onFilter,
  onClose,
}: {
  state: ReviewerState;
  onSelectProvider: (provider: string) => void;
  onGenerate: () => void;
  onPost: () => void;
  onCopy: () => void;
  onFilter: (filter: SeverityFilter) => void;
  onClose: () => void;
}) {
  const canGenerate =
    state.detail.status === 'ready' && !!state.provider && state.review.status !== 'loading';
  const canPost = state.review.status === 'ready' && state.postPhase !== 'posting';
  const canCopy = state.review.status === 'ready';
  const findings = state.review.data?.structured?.findings ?? [];
  const counts = countByPriority(findings);
  const providers = state.providers.data ?? [];
  const isCouncil = state.provider === 'council';
  const tone = statusTone(state.reviewStatus);

  return (
    <aside className="ai-panel" aria-label="AI review agents">
      <div className="ai-panel__header">
        <div className="ai-panel__title-row">
          <IconSpark size={14} />
          <h2>AI agents</h2>
        </div>
        <button
          type="button"
          className="btn btn--ghost btn--icon"
          onClick={onClose}
          title="Hide AI panel (⌘B)"
          aria-label="Hide AI panel"
        >
          <IconX size={13} />
        </button>
      </div>

      <div className="ai-panel__status">
        <span className={`pill pill--${tone}`}>{STATUS_LABEL[state.reviewStatus]}</span>
        {state.provider ? <span className="ai-panel__provider-pill">{state.provider}</span> : null}
      </div>

      <div className="ai-panel__section">
        <label className="ai-panel__label" htmlFor="provider-select">
          Provider
        </label>
        <select
          id="provider-select"
          disabled={providers.length === 0 || state.review.status === 'loading'}
          value={state.provider}
          onChange={(event) => onSelectProvider(event.target.value)}
        >
          {providers.length === 0 ? <option value="">No AI CLI found</option> : null}
          {providers.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        {isCouncil ? (
          <p className="ai-panel__hint">Council Mode runs every installed agent, then synthesizes one report.</p>
        ) : null}
        {providers.length === 0 ? (
          <p className="ai-panel__hint ai-panel__hint--warn">
            No local AI CLI is available. Install Claude, Codex, or Antigravity, then restart the app.
          </p>
        ) : null}
      </div>

      <div className="ai-panel__section">
        <p className="ai-panel__label">Agent activity</p>
        <ol className="activity-list">
          {state.activity.length === 0 ? (
            <li className="activity-item activity-item--pending">
              <span className="activity-item__dot" />
              Waiting for a Pull Request
            </li>
          ) : (
            state.activity.map((step) => (
              <li key={step.id} className={`activity-item activity-item--${step.kind}`}>
                <span className="activity-item__dot" aria-hidden="true">
                  {step.kind === 'done' ? <IconCheck size={10} /> : null}
                  {step.kind === 'failed' ? <IconX size={10} /> : null}
                </span>
                <div>
                  <p className="activity-item__label">{step.label}</p>
                  {step.detail ? <p className="activity-item__detail">{step.detail}</p> : null}
                </div>
              </li>
            ))
          )}
        </ol>
      </div>

      {findings.length > 0 ? (
        <div className="ai-panel__section">
          <p className="ai-panel__label">Severity</p>
          <div className="severity-counts" aria-label="Finding severity counts">
            {(['P0', 'P1', 'P2', 'P3'] as FindingPriority[]).map((priority) => (
              <span key={priority} className={`severity-count severity-count--${priority.toLowerCase()}`}>
                {priority} {counts[priority]}
              </span>
            ))}
          </div>
          <div className="filter-row" role="group" aria-label="Filter findings by severity">
            {FILTERS.map((filter) => (
              <button
                key={filter.value}
                type="button"
                className={
                  state.severityFilter === filter.value ? 'filter-chip filter-chip--active' : 'filter-chip'
                }
                onClick={() => onFilter(filter.value)}
              >
                {filter.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {state.review.data?.structured?.decision ? (
        <div className="ai-panel__section">
          <p className="ai-panel__label">Summary</p>
          <p className="ai-panel__summary">
            {state.review.data.structured.decision.status ?? 'Unknown'}
            {state.review.data.structured.decision.risk
              ? ` · ${state.review.data.structured.decision.risk} risk`
              : ''}
          </p>
          {state.review.data.structured.decision.main_reason ? (
            <p className="ai-panel__reason">{state.review.data.structured.decision.main_reason}</p>
          ) : null}
        </div>
      ) : null}

      <div className="ai-panel__actions">
        <button
          type="button"
          className="btn btn--primary ai-panel__generate"
          disabled={!canGenerate}
          onClick={onGenerate}
          title="Generate review (⌘⏎)"
        >
          <IconRefresh size={13} />
          {state.review.status === 'loading'
            ? 'Reviewing…'
            : state.review.status === 'ready'
              ? 'Regenerate review'
              : 'Generate review'}
        </button>
        <div className="ai-panel__action-row">
          <button type="button" className="btn btn--ghost" disabled={!canCopy} onClick={onCopy}>
            <IconCopy size={12} />
            Copy
          </button>
          <button
            type="button"
            className="btn btn--publish"
            disabled={!canPost}
            onClick={onPost}
            title="Requires confirmation before posting"
          >
            Post to GitHub
          </button>
        </div>
        <p className="ai-panel__shortcuts">
          <kbd>⌘K</kbd> commands · <kbd>⌘B</kbd> panel · <kbd>⌘⏎</kbd> generate
        </p>
      </div>
    </aside>
  );
}
