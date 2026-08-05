/**
 * Safe Markdown rendering.
 *
 * AI output is never trusted. It is parsed by `marked`, then sanitized by
 * DOMPurify with a narrow allow-list before it reaches the DOM.
 */

import DOMPurify from 'dompurify';
import { marked } from 'marked';
import { useMemo } from 'react';

const ALLOWED_TAGS = [
  'a', 'blockquote', 'br', 'code', 'del', 'em', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'hr', 'li', 'ol', 'p', 'pre', 'strong', 'table', 'tbody', 'td', 'th', 'thead',
  'tr', 'ul',
];

const ALLOWED_ATTR = ['href', 'title'];

export function renderMarkdown(source: string): string {
  const html = marked.parse(source, { async: false, gfm: true, breaks: false });
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOWED_URI_REGEXP: /^https?:\/\//i,
    FORBID_TAGS: ['style', 'script', 'iframe', 'object', 'embed', 'form', 'img'],
    FORBID_ATTR: ['style', 'srcset', 'onerror', 'onload'],
  });
}

export function Markdown({ source }: { source: string }) {
  const html = useMemo(() => renderMarkdown(source), [source]);
  // The string above is sanitized on every render, so this is the safe path.
  return <div className="markdown" dangerouslySetInnerHTML={{ __html: html }} />;
}
