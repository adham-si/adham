import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Markdown } from './markdown-view';

function stubClipboard(writeText: (text: string) => Promise<void>) {
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
}

afterEach(() => {
  Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
});

describe('Markdown rendering', () => {
  it('renders headings, lists, quotes and tables as structure', () => {
    render(
      <Markdown
        source={'## Title\n\n- one\n- two\n\n> note\n\n| a | b |\n| --- | --- |\n| 1 | 2 |'}
      />,
    );

    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('Title');
    expect(screen.getAllByRole('listitem').map((item) => item.textContent)).toEqual(['one', 'two']);
    expect(screen.getByText('note')).toBeDefined();
    expect(screen.getAllByRole('columnheader').map((cell) => cell.textContent)).toEqual(['a', 'b']);
    expect(screen.getAllByRole('cell').map((cell) => cell.textContent)).toEqual(['1', '2']);
  });

  it('renders inline code and strong text as elements, not markers', () => {
    render(<Markdown source="**bold** and `code`" />);
    expect(screen.getByText('bold').tagName).toBe('STRONG');
    expect(screen.getByText('code').tagName).toBe('CODE');
  });

  it('renders an unterminated fence as a code block with a stable dir', () => {
    const { container } = render(<Markdown source={'```ts\nconst x = 1;'} />);
    const pre = container.querySelector('pre');
    expect(pre?.textContent).toBe('const x = 1;');
    expect(pre?.getAttribute('dir')).toBe('ltr');
    expect(container.textContent).toContain('ts');
  });

  it('falls back to a neutral label for a fence with no language', () => {
    const { container } = render(<Markdown source={'```\nplain\n```'} />);
    expect(container.textContent).toContain('Code');
    expect(container.querySelector('pre')?.textContent).toBe('plain');
  });

  it('keeps a long fenced block complete inside a bounded scroller', () => {
    const lines = Array.from({ length: 1200 }, (_, i) => `line ${i}`);
    const { container } = render(<Markdown source={`\`\`\`text\n${lines.join('\n')}\n\`\`\``} />);
    const pre = container.querySelector('pre');
    expect(pre?.textContent).toBe(lines.join('\n'));
    expect(pre?.className).toContain('max-h-');
    expect(pre?.className).toContain('overflow-auto');
  });

  it('copies code through the clipboard and reports success', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubClipboard(writeText);
    render(<Markdown source={'```ts\nconst x = 1;\n```'} />);

    fireEvent.click(screen.getByRole('button', { name: 'Copy code' }));

    expect(await screen.findByText('Copied')).toBeDefined();
    expect(writeText).toHaveBeenCalledWith('const x = 1;');
  });

  it('reports a rejected clipboard write', async () => {
    stubClipboard(vi.fn().mockRejectedValue(new Error('denied')));
    render(<Markdown source={'```\ncode\n```'} />);

    fireEvent.click(screen.getByRole('button', { name: 'Copy code' }));

    expect(await screen.findByText('Copy failed')).toBeDefined();
  });

  it('reports a missing clipboard API instead of failing silently', async () => {
    render(<Markdown source={'```\ncode\n```'} />);

    fireEvent.click(screen.getByRole('button', { name: 'Copy code' }));

    expect(await screen.findByText('Copy failed')).toBeDefined();
  });

  it('uses provided labels', async () => {
    stubClipboard(vi.fn().mockResolvedValue(undefined));
    render(
      <Markdown source={'```\ncode\n```'} labels={{ copyCode: 'Kopieren', copied: 'Kopiert' }} />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Kopieren' }));
    expect(await screen.findByText('Kopiert')).toBeDefined();
  });

  it('uses a caller-provided glyph for the copy control without losing its name', () => {
    render(
      <Markdown source={'```ts\nconst x = 1;\n```'} copyIcon={<span data-testid="copy-glyph" />} />,
    );

    expect(screen.getByTestId('copy-glyph')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Copy code' })).toBeDefined();
  });

  it('never makes an unsafe link openable, even with a handler', () => {
    const onOpenLink = vi.fn();
    const { container } = render(
      <Markdown source="[click](javascript:alert(1))" onOpenLink={onOpenLink} />,
    );

    expect(container.querySelector('a')).toBeNull();
    expect(container.textContent).toContain('click');
    expect(container.textContent).toContain('javascript:alert(1)');
    fireEvent.click(screen.getByText(/javascript/));
    expect(onOpenLink).not.toHaveBeenCalled();
  });

  it('renders a safe link as inert text when no handler is approved', () => {
    const { container } = render(<Markdown source="[docs](https://example.com/x)" />);

    expect(container.querySelector('a')).toBeNull();
    expect(container.textContent).toContain('docs');
    expect(container.textContent).toContain('https://example.com/x');
  });

  it('routes a safe link through the approved handler instead of navigating', () => {
    const onOpenLink = vi.fn();
    render(<Markdown source="[docs](https://example.com/x)" onOpenLink={onOpenLink} />);

    const link = screen.getByRole('link');
    expect(link.getAttribute('href')).toBe('https://example.com/x');
    fireEvent.click(link);
    expect(onOpenLink).toHaveBeenCalledWith('https://example.com/x');
  });

  it('never renders a remote image', () => {
    const { container } = render(<Markdown source="![diagram](https://example.com/i.png)" />);

    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toContain('Image not shown');
    expect(container.textContent).toContain('diagram');
    expect(container.textContent).toContain('https://example.com/i.png');
  });

  it('keeps raw HTML visible as text', () => {
    const { container } = render(<Markdown source={'<script>alert(1)</script> <b>bold</b>'} />);

    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('b')).toBeNull();
    expect(container.textContent).toContain('<script>alert(1)</script>');
  });

  it('renders a partial streaming document without throwing', () => {
    const source = '# Title\n\nSome **bold** text\n\n```ts\nconst x';
    for (let end = 0; end <= source.length; end += 1) {
      const { unmount } = render(<Markdown source={source.slice(0, end)} />);
      unmount();
    }
  });
});
