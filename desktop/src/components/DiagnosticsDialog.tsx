/** Settings and diagnostics drawer. Sensitive data stays in Python / main. */

import type { ReviewerState } from '../state/useReviewer';
import { Spinner } from './States';

export function DiagnosticsDialog({
  open,
  state,
  onClose,
  onLogin,
  onSetupMcp,
  onRefresh,
}: {
  open: boolean;
  state: ReviewerState;
  onClose: () => void;
  onLogin: () => void;
  onSetupMcp: () => void;
  onRefresh: () => void;
}) {
  if (!open) return null;

  const auth = state.auth.data;
  const health = state.health;
  const mcp = state.mcp;

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="diagnostics-title">
      <div className="modal modal--wide">
        <h2 id="diagnostics-title" className="modal__title">
          Settings and diagnostics
        </h2>
        <p className="modal__body">
          Credentials and provider secrets stay in the Python engine. This panel only shows readiness.
        </p>

        <div className="diagnostics">
          <section>
            <h3 className="section-title">GitHub</h3>
            {state.auth.status === 'loading' ? (
              <Spinner label="Checking GitHub…" />
            ) : auth?.authenticated ? (
              <p>
                Signed in as <code>@{auth.username}</code>
              </p>
            ) : (
              <div className="diagnostics__row">
                <p>
                  {auth?.ghInstalled
                    ? 'Sign in is required to load repositories.'
                    : 'Install the GitHub CLI from cli.github.com, then sign in.'}
                </p>
                {auth?.ghInstalled ? (
                  <button type="button" className="btn btn--primary btn--small" onClick={onLogin}>
                    Sign in to GitHub
                  </button>
                ) : null}
              </div>
            )}
          </section>

          <section>
            <h3 className="section-title">System health</h3>
            {health.status === 'loading' ? (
              <Spinner label="Loading health…" />
            ) : health.status === 'error' && health.error ? (
              <p className="state__message">{health.error.message}</p>
            ) : health.data ? (
              <ul className="checks__list">
                <li className="check check--neutral">
                  <span>Status</span>
                  <span>{health.data.status}</span>
                </li>
                <li className="check check--neutral">
                  <span>Providers</span>
                  <span>{health.data.providers.join(', ') || 'None'}</span>
                </li>
                {Object.entries(health.data.executables).map(([name, present]) => (
                  <li key={name} className={present ? 'check check--ok' : 'check check--warn'}>
                    <span>{name}</span>
                    <span>{present ? 'Found' : 'Missing'}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <button type="button" className="btn btn--ghost btn--small" onClick={onRefresh}>
                Load health
              </button>
            )}
          </section>

          <section>
            <h3 className="section-title">MCP</h3>
            {mcp.status === 'loading' ? (
              <Spinner label="Checking MCP config…" />
            ) : mcp.data ? (
              <div className="diagnostics__row">
                <p>
                  {mcp.data.configured
                    ? `Configured at ${mcp.data.path}`
                    : 'MCP config is not set up for this machine.'}
                </p>
                {!mcp.data.configured ? (
                  <button type="button" className="btn btn--ghost btn--small" onClick={onSetupMcp}>
                    Set up MCP
                  </button>
                ) : null}
              </div>
            ) : mcp.error ? (
              <p className="state__message">{mcp.error.message}</p>
            ) : null}
          </section>
        </div>

        <div className="modal__actions">
          <button type="button" className="btn btn--ghost" onClick={onRefresh}>
            Refresh
          </button>
          <button type="button" className="btn btn--primary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
