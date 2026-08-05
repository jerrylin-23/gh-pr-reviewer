/** Expandable finding card with severity colour and file navigation. */

import { useState } from 'react';

import type { ReviewFinding } from '../types';
import { IconCopy, IconFile } from './Icons';

const PRIORITY_LABEL: Record<string, string> = {
  P0: 'Blocker',
  P1: 'High',
  P2: 'Medium',
  P3: 'Low',
};

function priorityClass(priority: string | null): string {
  return `finding__priority finding__priority--${(priority ?? 'none').toLowerCase()}`;
}

export function FindingCard({
  finding,
  selected,
  source,
  onSelect,
  onJumpToFile,
}: {
  finding: ReviewFinding;
  selected: boolean;
  source?: string | null;
  onSelect: () => void;
  onJumpToFile?: (file: string) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const [copied, setCopied] = useState(false);

  const copyFinding = async () => {
    const parts = [
      `${finding.priority ?? '—'} ${finding.title}`,
      finding.file ? `File: ${finding.file}${finding.line !== null ? `:${finding.line}` : ''}` : null,
      finding.evidence ? `Evidence: ${finding.evidence}` : null,
      finding.impact ? `Impact: ${finding.impact}` : null,
      finding.fix ? `Fix: ${finding.fix}` : null,
    ].filter(Boolean);
    await navigator.clipboard.writeText(parts.join('\n'));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  };

  return (
    <article
      className={selected ? 'finding finding--selected' : 'finding'}
      data-priority={finding.priority ?? 'none'}
    >
      <header className="finding__head">
        <button type="button" className="finding__select" onClick={onSelect}>
          <span className={priorityClass(finding.priority)}>
            {finding.priority ?? '—'}
            <span className="finding__priority-word">
              {PRIORITY_LABEL[finding.priority ?? ''] ?? 'Unranked'}
            </span>
          </span>
          <h4 className="finding__title">{finding.title}</h4>
        </button>
        <div className="finding__actions">
          <button
            type="button"
            className="btn btn--ghost btn--icon"
            title={copied ? 'Copied' : 'Copy finding'}
            aria-label="Copy finding"
            onClick={() => void copyFinding()}
          >
            <IconCopy size={12} />
          </button>
          <button
            type="button"
            className="btn btn--ghost btn--small"
            onClick={() => setExpanded((value) => !value)}
            aria-expanded={expanded}
          >
            {expanded ? 'Collapse' : 'Expand'}
          </button>
        </div>
      </header>

      <div className="finding__meta">
        {finding.file ? (
          <button
            type="button"
            className="finding__file-btn"
            onClick={() => {
              onSelect();
              if (finding.file && onJumpToFile) onJumpToFile(finding.file);
            }}
            title="Open file in Diff tab"
          >
            <IconFile size={12} />
            <code>
              {finding.file}
              {finding.line !== null ? `:${finding.line}` : ''}
            </code>
          </button>
        ) : (
          <span className="finding__file-missing">No file reference</span>
        )}
        {source ? <span className="finding__source">{source}</span> : null}
      </div>

      {expanded ? (
        <dl className="finding__fields">
          {finding.evidence ? (
            <>
              <dt>Evidence</dt>
              <dd>{finding.evidence}</dd>
            </>
          ) : null}
          {finding.impact ? (
            <>
              <dt>Impact</dt>
              <dd>{finding.impact}</dd>
            </>
          ) : null}
          {finding.fix ? (
            <>
              <dt>Fix</dt>
              <dd>{finding.fix}</dd>
            </>
          ) : null}
        </dl>
      ) : null}
    </article>
  );
}
