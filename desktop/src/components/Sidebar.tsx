/** Left session sidebar: brand, selectors, recent reviews, diagnostics. */

import { useEffect, useRef, useState } from 'react';

import type { ReviewerState } from '../state/useReviewer';
import { IconHistory, IconPlus, IconPr, IconRepo, IconSettings } from './Icons';

export interface SidebarProps {
  state: ReviewerState;
  onNewReview: () => void;
  onSearchRepos: (query: string) => void;
  onSelectRepo: (repo: string) => void;
  onSelectPr: (number: number) => void;
  onOpenSession: (repo: string, number: number) => void;
  onOpenDiagnostics: () => void;
  onResize: (width: number) => void;
}

export function Sidebar({
  state,
  onNewReview,
  onSearchRepos,
  onSelectRepo,
  onSelectPr,
  onOpenSession,
  onOpenDiagnostics,
  onResize,
}: SidebarProps) {
  const [repoQuery, setRepoQuery] = useState('');
  const [open, setOpen] = useState(false);
  const drag = useRef<{ startX: number; startWidth: number } | null>(null);

  useEffect(() => {
    if (state.selectedRepo) setRepoQuery(state.selectedRepo);
  }, [state.selectedRepo]);

  useEffect(() => {
    const onMove = (event: MouseEvent) => {
      if (!drag.current) return;
      onResize(drag.current.startWidth + (event.clientX - drag.current.startX));
    };
    const onUp = () => {
      drag.current = null;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [onResize]);

  const authenticated = state.auth.data?.authenticated ?? false;
  const prs = state.pullRequests.data ?? [];

  return (
    <aside className="sidebar" style={{ width: state.sidebarWidth }} aria-label="Review sessions">
      <div className="sidebar__brand">
        <span className="sidebar__mark" aria-hidden="true" />
        <div>
          <p className="sidebar__name">PR Reviewer</p>
          <p className="sidebar__tag">AI review cockpit</p>
        </div>
      </div>

      <button type="button" className="btn btn--primary sidebar__new" onClick={onNewReview}>
        <IconPlus size={13} />
        New review
      </button>

      <div className="sidebar__section">
        <label className="sidebar__label" htmlFor="repo-input">
          <IconRepo size={12} /> Repository
        </label>
        <div className="sidebar__field">
          <input
            id="repo-input"
            type="text"
            autoComplete="off"
            spellCheck={false}
            placeholder={authenticated ? 'owner/repo' : 'Sign in first'}
            disabled={!authenticated}
            value={repoQuery}
            onChange={(event) => {
              setRepoQuery(event.target.value);
              setOpen(true);
              onSearchRepos(event.target.value);
            }}
            onFocus={() => {
              setOpen(true);
              onSearchRepos(repoQuery);
            }}
            onBlur={() => window.setTimeout(() => setOpen(false), 120)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && /^[^\s/]+\/[^\s/]+$/.test(repoQuery.trim())) {
                setOpen(false);
                onSelectRepo(repoQuery.trim());
              }
            }}
          />
          {open && state.repoSuggestions.length > 0 ? (
            <ul className="suggestions" role="listbox" aria-label="Repository suggestions">
              {state.repoSuggestions.map((name) => (
                <li key={name}>
                  <button type="button" onMouseDown={() => onSelectRepo(name)}>
                    {name}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          {state.searching ? <span className="sidebar__hint">Searching…</span> : null}
        </div>
      </div>

      <div className="sidebar__section">
        <label className="sidebar__label" htmlFor="pr-select">
          <IconPr size={12} /> Pull Request
        </label>
        <select
          id="pr-select"
          disabled={state.pullRequests.status !== 'ready' || prs.length === 0}
          value={state.selectedPr ?? ''}
          onChange={(event) => onSelectPr(Number(event.target.value))}
        >
          <option value="" disabled>
            {state.pullRequests.status === 'loading'
              ? 'Loading Pull Requests…'
              : prs.length === 0
                ? 'No open Pull Requests'
                : 'Select a Pull Request'}
          </option>
          {prs.map((pr) => (
            <option key={pr.number} value={pr.number}>
              #{pr.number} · {pr.title}
            </option>
          ))}
        </select>
      </div>

      <div className="sidebar__section sidebar__section--grow">
        <p className="sidebar__label">
          <IconHistory size={12} /> Recent sessions
        </p>
        {state.sessions.length === 0 ? (
          <p className="sidebar__empty">Loaded Pull Requests appear here.</p>
        ) : (
          <ul className="session-list">
            {state.sessions.map((session) => {
              const active =
                state.selectedRepo === session.repo && state.selectedPr === session.number;
              return (
                <li key={session.id}>
                  <button
                    type="button"
                    className={active ? 'session-item session-item--active' : 'session-item'}
                    onClick={() => onOpenSession(session.repo, session.number)}
                    title={`${session.repo}#${session.number}`}
                  >
                    <span className="session-item__pr">
                      {session.repo} #{session.number}
                    </span>
                    <span className="session-item__title">{session.title}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="sidebar__footer">
        {state.auth.status === 'ready' && state.auth.data?.authenticated ? (
          <span className="sidebar__user" title="Signed-in GitHub user">
            @{state.auth.data.username}
          </span>
        ) : (
          <span className="sidebar__user sidebar__user--muted">Not signed in</span>
        )}
        <button
          type="button"
          className="btn btn--ghost btn--icon"
          onClick={onOpenDiagnostics}
          title="Settings and diagnostics"
          aria-label="Settings and diagnostics"
        >
          <IconSettings size={14} />
        </button>
      </div>

      <div
        className="sidebar__resize"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize sidebar"
        onMouseDown={(event) => {
          drag.current = { startX: event.clientX, startWidth: state.sidebarWidth };
          document.body.style.cursor = 'col-resize';
          document.body.style.userSelect = 'none';
        }}
      />
    </aside>
  );
}
