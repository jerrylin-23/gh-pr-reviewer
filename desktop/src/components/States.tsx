/** Shared loading, empty, and error blocks so every pane behaves the same. */

import type { ApiError } from '../types';

export function Spinner({ label }: { label: string }) {
  return (
    <div className="state state--loading" role="status" aria-live="polite">
      <span className="spinner" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="state state--empty">
      <p className="state__title">{title}</p>
      {hint ? <p className="state__hint">{hint}</p> : null}
    </div>
  );
}

export function ErrorState({
  error,
  onRetry,
  retryLabel = 'Try again',
  nextAction,
}: {
  error: ApiError;
  onRetry?: () => void;
  retryLabel?: string;
  nextAction?: string;
}) {
  return (
    <div className="state state--error" role="alert">
      <p className="state__code">{error.code}</p>
      <p className="state__message">{error.message}</p>
      {nextAction ? <p className="state__hint">{nextAction}</p> : null}
      {onRetry ? (
        <button type="button" className="btn btn--ghost" onClick={onRetry}>
          {retryLabel}
        </button>
      ) : null}
    </div>
  );
}
