/** Explicit confirmation before anything reaches GitHub. */

import type { ApiError } from '../types';
import type { PostPhase } from '../state/useReviewer';

export function PostDialog({
  phase,
  repo,
  prNumber,
  error,
  onCancel,
  onConfirm,
}: {
  phase: PostPhase;
  repo: string | null;
  prNumber: number | null;
  error: ApiError | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  if (phase === 'idle') {
    return null;
  }

  const target = `${repo ?? 'unknown repository'} #${prNumber ?? '?'}`;

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="post-dialog-title">
      <div className="modal">
        {phase === 'posted' ? (
          <>
            <h2 id="post-dialog-title" className="modal__title">Review posted</h2>
            <p className="modal__body">The review is now a comment on {target}.</p>
            <div className="modal__actions">
              <button type="button" className="btn btn--primary" onClick={onCancel}>
                Close
              </button>
            </div>
          </>
        ) : phase === 'error' ? (
          <>
            <h2 id="post-dialog-title" className="modal__title">Posting failed</h2>
            <p className="modal__code">{error?.code ?? 'POST_FAILED'}</p>
            <p className="modal__body">{error?.message ?? 'GitHub rejected the review.'}</p>
            <div className="modal__actions">
              <button type="button" className="btn btn--ghost" onClick={onCancel}>
                Close
              </button>
              <button type="button" className="btn btn--primary" onClick={onConfirm}>
                Try again
              </button>
            </div>
          </>
        ) : (
          <>
            <h2 id="post-dialog-title" className="modal__title">Post this review to GitHub?</h2>
            <p className="modal__body">
              The review is posted as a public comment on {target}. This action is visible to everyone
              with access to the repository.
            </p>
            <div className="modal__actions">
              <button
                type="button"
                className="btn btn--ghost"
                onClick={onCancel}
                disabled={phase === 'posting'}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn--publish"
                onClick={onConfirm}
                disabled={phase === 'posting'}
              >
                {phase === 'posting' ? 'Posting…' : 'Post review'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
