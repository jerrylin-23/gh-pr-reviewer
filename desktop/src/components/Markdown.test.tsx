import { describe, expect, it } from 'vitest';

import { renderMarkdown } from './Markdown';
import { splitDiff } from './DiffViewer';

describe('renderMarkdown', () => {
  it('renders normal review Markdown', () => {
    const html = renderMarkdown('## Decision\n\n- Status: `Ready`\n');
    expect(html).toContain('<h2>Decision</h2>');
    expect(html).toContain('<code>Ready</code>');
  });

  it('removes script tags and event handlers', () => {
    const html = renderMarkdown('<script>alert(1)</script>\n\n<p onclick="steal()">text</p>');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('onclick');
    expect(html).toContain('text');
  });

  it('removes images and iframes that AI output may contain', () => {
    const html = renderMarkdown('![x](https://evil.example.com/pixel.png)\n\n<iframe src="x"></iframe>');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<iframe');
  });

  it('drops javascript: links but keeps https links', () => {
    const html = renderMarkdown('[bad](javascript:alert(1)) and [good](https://github.com)');
    expect(html).not.toContain('javascript:');
    expect(html).toContain('https://github.com');
  });

  it('handles empty and broken Markdown without throwing', () => {
    expect(renderMarkdown('')).toBe('');
    expect(() => renderMarkdown('### unterminated `code')).not.toThrow();
  });
});

describe('splitDiff', () => {
  it('splits a unified diff by file and counts changed lines', () => {
    const diff = [
      'diff --git a/one.py b/one.py',
      '--- a/one.py',
      '+++ b/one.py',
      '@@ -1 +1 @@',
      '-old',
      '+new',
      'diff --git a/two.py b/two.py',
      '+added',
    ].join('\n');

    const files = splitDiff(diff);
    expect(files.map((file) => file.path)).toEqual(['one.py', 'two.py']);
    expect(files[0]?.added).toBe(1);
    expect(files[0]?.removed).toBe(1);
    expect(files[1]?.added).toBe(1);
  });

  it('handles a diff with no file header', () => {
    expect(splitDiff('just text')[0]?.path).toBe('(header)');
  });
});
