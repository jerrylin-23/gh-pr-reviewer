/** Diff viewer for the main workspace. */

import { useEffect, useMemo, useState } from 'react';

import type { Async, PullRequestDetail } from '../types';
import { EmptyState, ErrorState, Spinner } from './States';

interface DiffFile {
  path: string;
  lines: string[];
  added: number;
  removed: number;
}

export function splitDiff(diff: string): DiffFile[] {
  const files: DiffFile[] = [];
  let current: DiffFile | null = null;

  for (const line of diff.split('\n')) {
    if (line.startsWith('diff --git ')) {
      const match = /b\/(.+)$/.exec(line);
      current = { path: match?.[1] ?? line.slice(11), lines: [], added: 0, removed: 0 };
      files.push(current);
      continue;
    }
    if (!current) {
      current = { path: '(header)', lines: [], added: 0, removed: 0 };
      files.push(current);
    }
    current.lines.push(line);
    if (line.startsWith('+') && !line.startsWith('+++')) current.added += 1;
    if (line.startsWith('-') && !line.startsWith('---')) current.removed += 1;
  }

  return files;
}

function lineClass(line: string): string {
  if (line.startsWith('@@')) return 'diff__line diff__line--hunk';
  if (line.startsWith('+++') || line.startsWith('---')) return 'diff__line diff__line--meta';
  if (line.startsWith('+')) return 'diff__line diff__line--add';
  if (line.startsWith('-')) return 'diff__line diff__line--del';
  return 'diff__line';
}

export function DiffViewer({
  detail,
  repo,
  focusFile,
}: {
  detail: Async<PullRequestDetail>;
  repo: string | null;
  onOpenExternal?: (url: string) => void;
  focusFile?: string | null;
}) {
  const [activeFile, setActiveFile] = useState<string | null>(null);

  const files = useMemo(() => (detail.data ? splitDiff(detail.data.diff) : []), [detail.data]);

  useEffect(() => {
    if (focusFile) setActiveFile(focusFile);
  }, [focusFile]);

  if (detail.status === 'loading') {
    return (
      <div className="diff-pane">
        <Spinner label="Loading metadata and diff…" />
      </div>
    );
  }

  if (detail.status === 'error' && detail.error) {
    return (
      <div className="diff-pane">
        <ErrorState
          error={detail.error}
          nextAction={
            detail.error.code === 'AUTH_REQUIRED'
              ? 'Sign in to GitHub from Settings, then select the Pull Request again.'
              : 'Confirm the repository and Pull Request number, then try again.'
          }
        />
      </div>
    );
  }

  if (detail.status !== 'ready' || !detail.data) {
    return (
      <div className="diff-pane">
        <EmptyState
          title="No diff loaded"
          hint={repo ? 'Select an open Pull Request in the sidebar.' : 'Choose a repository to begin.'}
        />
      </div>
    );
  }

  const shown = activeFile ? files.filter((file) => file.path === activeFile) : files;
  const large = detail.data.diff.length > 200_000;

  return (
    <div className="diff-pane">
      {files.length > 0 ? (
        <nav className="file-tabs" aria-label="Changed files">
          <button
            type="button"
            className={activeFile === null ? 'file-tab file-tab--active' : 'file-tab'}
            onClick={() => setActiveFile(null)}
          >
            All files
          </button>
          {files.map((file) => (
            <button
              key={file.path}
              type="button"
              className={activeFile === file.path ? 'file-tab file-tab--active' : 'file-tab'}
              onClick={() => setActiveFile(file.path)}
              title={file.path}
            >
              {file.path.split('/').pop()}
              <span className="file-tab__counts">
                +{file.added} −{file.removed}
              </span>
            </button>
          ))}
        </nav>
      ) : null}

      <div className="diff-pane__body">
        {large ? (
          <p className="notice notice--warn notice--inline">
            Large diff loaded. Horizontal scrolling is enabled; filter by file for easier reading.
          </p>
        ) : null}

        {detail.data.diff.trim() === '' ? (
          <EmptyState title="This Pull Request has no file changes." />
        ) : (
          shown.map((file) => (
            <article key={file.path} className="diff" id={`diff-file-${file.path}`}>
              <h3 className="diff__path">{file.path}</h3>
              <pre className="diff__body">
                {file.lines.map((line, index) => (
                  <span key={`${file.path}-${index}`} className={lineClass(line)}>
                    <span className="diff__ln" aria-hidden="true">
                      {index + 1}
                    </span>
                    <span className="diff__code">{line || ' '}</span>
                  </span>
                ))}
              </pre>
            </article>
          ))
        )}
      </div>
    </div>
  );
}
