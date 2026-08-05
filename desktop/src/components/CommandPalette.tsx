/** Command palette for common review actions. */

import { useEffect, useMemo, useState } from 'react';

import type { ReviewerState } from '../state/useReviewer';
import { IconCommand } from './Icons';

export interface CommandItem {
  id: string;
  label: string;
  hint?: string;
  disabled?: boolean;
  run: () => void;
}

export function CommandPalette({
  open,
  state,
  onClose,
  commands,
}: {
  open: boolean;
  state: ReviewerState;
  onClose: () => void;
  commands: CommandItem[];
}) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q
      ? commands.filter((item) => item.label.toLowerCase().includes(q) || item.hint?.toLowerCase().includes(q))
      : commands;
    return list;
  }, [commands, query]);

  useEffect(() => {
    if (open) {
      setQuery('');
      setActive(0);
    }
  }, [open]);

  useEffect(() => {
    setActive(0);
  }, [query]);

  if (!open) return null;

  return (
    <div
      className="modal-backdrop modal-backdrop--palette"
      role="dialog"
      aria-modal="true"
      aria-labelledby="command-palette-title"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="command-palette">
        <div className="command-palette__head">
          <IconCommand size={14} />
          <h2 id="command-palette-title" className="sr-only">
            Command palette
          </h2>
          <input
            autoFocus
            className="command-palette__input"
            placeholder="Run a review command…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') {
                event.preventDefault();
                setActive((index) => Math.min(filtered.length - 1, index + 1));
              } else if (event.key === 'ArrowUp') {
                event.preventDefault();
                setActive((index) => Math.max(0, index - 1));
              } else if (event.key === 'Enter') {
                event.preventDefault();
                const item = filtered[active];
                if (item && !item.disabled) {
                  item.run();
                  onClose();
                }
              } else if (event.key === 'Escape') {
                onClose();
              }
            }}
          />
          <kbd className="command-palette__esc">esc</kbd>
        </div>
        <ul className="command-palette__list" role="listbox">
          {filtered.length === 0 ? (
            <li className="command-palette__empty">No matching commands</li>
          ) : (
            filtered.map((item, index) => (
              <li key={item.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={index === active}
                  className={
                    index === active
                      ? 'command-palette__item command-palette__item--active'
                      : 'command-palette__item'
                  }
                  disabled={item.disabled}
                  onMouseEnter={() => setActive(index)}
                  onClick={() => {
                    if (item.disabled) return;
                    item.run();
                    onClose();
                  }}
                >
                  <span>{item.label}</span>
                  {item.hint ? <span className="command-palette__hint">{item.hint}</span> : null}
                </button>
              </li>
            ))
          )}
        </ul>
        <p className="command-palette__footer">
          {state.selectedRepo ?? 'No repository'}
          {state.selectedPr !== null ? ` · #${state.selectedPr}` : ''}
        </p>
      </div>
    </div>
  );
}
