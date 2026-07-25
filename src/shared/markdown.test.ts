import { describe, it, expect } from 'vitest';
import { renderMarkdown } from './markdown';

describe('renderMarkdown', () => {
  it('renders headings by level', () => {
    expect(renderMarkdown('# Title')).toBe('<h1>Title</h1>');
    expect(renderMarkdown('### Sub')).toBe('<h3>Sub</h3>');
  });

  it('renders bullet lists', () => {
    expect(renderMarkdown('- a\n- b')).toBe('<ul>\n<li>a</li>\n<li>b</li>\n</ul>');
  });

  it('renders bold inline', () => {
    expect(renderMarkdown('**Term** — def')).toBe('<p><strong>Term</strong> — def</p>');
  });

  it('escapes HTML to prevent injection', () => {
    expect(renderMarkdown('<script>alert(1)</script>')).toContain('&lt;script&gt;');
    expect(renderMarkdown('a & b')).toContain('a &amp; b');
  });

  it('closes an open list before a following paragraph', () => {
    const html = renderMarkdown('- a\n\ntext');
    expect(html).toBe('<ul>\n<li>a</li>\n</ul>\n<p>text</p>');
  });
});
