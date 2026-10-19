import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { contentFromText } from './message-content';
import { MessageCard } from './message-card';

const DIRECTION_LOCKED = /(^|\s)(left-|right-|ml-|mr-|pl-|pr-)/;

/** The card surface: the article's only direct div child, since the identity
 *  header and the actions row are header/footer elements outside the card. */
function surface(container: HTMLElement): Element | null {
  return container.querySelector('article > div');
}

function stubClipboard(writeText: (text: string) => Promise<void>) {
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
}

afterEach(() => {
  Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
});

describe('MessageCard', () => {
  it('renders an article', () => {
    const { container } = render(
      <MessageCard role="user" content={contentFromText('Hello')} timestamp="10:04" />,
    );
    expect(container.querySelector('article')).not.toBeNull();
  });

  it('keeps a very long message complete inside a bounded body', () => {
    const text = Array.from({ length: 1500 }, (_, i) => `line ${i}`).join('\n');
    const { container } = render(
      <MessageCard role="user" content={contentFromText(text)} timestamp="10:04" />,
    );
    const body = container.querySelector('p.whitespace-pre-wrap');
    expect(body?.textContent).toBe(text);
    const scroller = body?.parentElement;
    expect(scroller?.className).toContain('max-h-[70vh]');
    expect(scroller?.className).toContain('overflow-y-auto');
  });

  it('states the role as visible text, not colour alone', () => {
    render(<MessageCard role="assistant" content={contentFromText('Hi')} timestamp="10:04" />);
    expect(screen.getByText('Assistant')).toBeDefined();
  });

  it.each([
    ['user', 'You'],
    ['assistant', 'Assistant'],
    ['system', 'System'],
  ] as const)('role %s renders the label %s', (role, label) => {
    render(<MessageCard role={role} content={contentFromText('Body')} timestamp="10:04" />);
    expect(screen.getByText(label)).toBeDefined();
  });

  it('labels the article for assistive tech too', () => {
    const { container } = render(
      <MessageCard role="system" content={contentFromText('Body')} timestamp="10:04" />,
    );
    expect(container.querySelector('article')?.getAttribute('aria-label')).toBe('System');
  });

  it('renders the body text', () => {
    render(
      <MessageCard
        role="user"
        content={contentFromText('Deploy the staging build')}
        timestamp="10:04"
      />,
    );
    expect(screen.getByText('Deploy the staging build')).toBeDefined();
  });

  it('renders the timestamp in a time element', () => {
    const { container } = render(
      <MessageCard
        role="user"
        content={contentFromText('Body')}
        timestamp="10:04"
        dateTime="2026-10-07T10:04:00Z"
      />,
    );
    const time = container.querySelector('time');
    expect(time?.textContent).toBe('10:04');
    expect(time?.getAttribute('datetime')).toBe('2026-10-07T10:04:00Z');
  });

  it('selected applies the selection surface to the card, not the identity header', () => {
    const { container } = render(
      <MessageCard role="user" content={contentFromText('Body')} timestamp="10:04" selected />,
    );
    expect(surface(container)?.className).toContain('bg-selection');
  });

  it('not selected omits the selection surface', () => {
    const { container } = render(
      <MessageCard role="user" content={contentFromText('Body')} timestamp="10:04" />,
    );
    expect(surface(container)?.className).not.toContain('bg-selection');
  });

  it('editable marks the card with a dashed boundary', () => {
    const { container } = render(
      <MessageCard role="user" content={contentFromText('Body')} timestamp="10:04" editable />,
    );
    expect(surface(container)?.className).toContain('border-dashed');
  });

  it('read-only by default: no dashed boundary', () => {
    const { container } = render(
      <MessageCard role="user" content={contentFromText('Body')} timestamp="10:04" />,
    );
    expect(surface(container)?.className).not.toContain('border-dashed');
  });

  it('keeps the body read-only when editable is false', () => {
    const { container } = render(
      <MessageCard
        role="user"
        content={contentFromText('Body')}
        timestamp="10:04"
        editable={false}
      />,
    );
    expect(surface(container)?.className).not.toContain('border-dashed');
  });

  it('keeps the identity header and the actions outside the card surface', () => {
    const { container } = render(
      <MessageCard
        role="user"
        content={contentFromText('Body')}
        timestamp="10:04"
        onReply={() => {}}
      />,
    );
    const card = screen.getByRole('article');
    const bubble = surface(container);
    expect(bubble).not.toBeNull();
    expect(bubble?.contains(screen.getByText('You'))).toBe(false);
    expect(bubble?.contains(screen.getByText('10:04'))).toBe(false);
    expect(bubble?.querySelector('button')).toBeNull();
    expect(card.querySelector('footer button')).not.toBeNull();
  });

  it('aligns incoming turns to the start and outgoing turns to the end', () => {
    const { container, rerender } = render(
      <MessageCard role="assistant" content={contentFromText('Body')} timestamp="10:04" />,
    );
    expect(screen.getByRole('article').className).toContain('self-start');
    rerender(<MessageCard role="user" content={contentFromText('Body')} timestamp="10:04" />);
    expect(container.querySelector('article')?.className).toContain('self-end');
  });

  it('is focusable so a selected card can be reached by keyboard', () => {
    const { container } = render(
      <MessageCard role="user" content={contentFromText('Body')} timestamp="10:04" tabIndex={0} />,
    );
    expect(container.querySelector('article')?.getAttribute('tabindex')).toBe('0');
    expect(screen.getByRole('article').className).toContain('focus-visible:outline-focus');
  });

  it('renders no direction-locked utility', () => {
    const { container } = render(
      <MessageCard
        role="user"
        content={contentFromText('Body')}
        timestamp="10:04"
        selected
        editable
      />,
    );
    expect(container.querySelector('article')?.className).not.toMatch(DIRECTION_LOCKED);
    expect(surface(container)?.className).not.toMatch(DIRECTION_LOCKED);
  });

  it('uses no magic values', () => {
    const { container } = render(
      <MessageCard role="assistant" content={contentFromText('Body')} timestamp="10:04" selected />,
    );
    const className = surface(container)?.className ?? '';
    expect(className).not.toContain('#');
    expect(className).not.toContain('[var(');
  });

  it('lets a caller className override the base padding on the card surface', () => {
    const { container } = render(
      <MessageCard
        role="user"
        content={contentFromText('Body')}
        timestamp="10:04"
        className="p-8"
      />,
    );
    const className = surface(container)?.className ?? '';
    expect(className).toContain('p-8');
    expect(className).not.toContain('p-4');
  });

  it('forwards a ref to the article element', () => {
    let captured: HTMLElement | null = null;
    render(
      <MessageCard
        role="user"
        content={contentFromText('Body')}
        timestamp="10:04"
        ref={(element) => {
          captured = element;
        }}
      />,
    );
    expect(captured).toBeInstanceOf(HTMLElement);
  });

  it('renders assistant content as Markdown instead of literal markers', () => {
    const { container } = render(
      <MessageCard
        role="assistant"
        content={contentFromText('## Heading\n\n**bold**')}
        timestamp="10:04"
      />,
    );
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('Heading');
    expect(screen.getByText('bold').tagName).toBe('STRONG');
    expect(container.textContent).not.toContain('**bold**');
  });

  it('keeps user text literal', () => {
    const { container } = render(
      <MessageCard
        role="user"
        content={contentFromText('**not bold** and `not code`')}
        timestamp="10:04"
      />,
    );
    expect(container.querySelector('strong')).toBeNull();
    expect(container.querySelector('code')).toBeNull();
    expect(container.textContent).toContain('**not bold** and `not code`');
  });

  it('preserves an unrenderable part as inert source instead of dropping history', () => {
    const content = {
      schema: 1,
      parts: [{ type: 'unknown' as const, raw: '{"kind":"chart"}' }],
    };
    const { container } = render(
      <MessageCard role="assistant" content={content} timestamp="10:04" />,
    );
    expect(screen.getByText('Unsupported content')).toBeDefined();
    expect(container.textContent).toContain('{"kind":"chart"}');
  });

  it('accepts localized renderer labels', () => {
    const content = { schema: 1, parts: [{ type: 'unknown' as const, raw: 'x' }] };
    render(
      <MessageCard
        role="assistant"
        content={content}
        timestamp="10:04"
        labels={{ unsupportedContent: 'Inhalt nicht unterstützt' }}
      />,
    );
    expect(screen.getByText('Inhalt nicht unterstützt')).toBeDefined();
  });

  it('copies the message source and reports success', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubClipboard(writeText);
    render(
      <MessageCard
        role="assistant"
        content={contentFromText('## Plan\n\n- step one')}
        timestamp="10:04"
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Copy message' }));

    expect(await screen.findByText('Copied')).toBeDefined();
    expect(writeText).toHaveBeenCalledWith('## Plan\n\n- step one');
  });

  it('reports a rejected clipboard write instead of pretending the copy worked', async () => {
    stubClipboard(vi.fn().mockRejectedValue(new Error('denied')));
    render(<MessageCard role="user" content={contentFromText('Body')} timestamp="10:04" />);

    fireEvent.click(screen.getByRole('button', { name: 'Copy message' }));

    expect(await screen.findByText('Copy failed')).toBeDefined();
  });

  it('reports a missing clipboard API instead of failing silently', async () => {
    render(<MessageCard role="user" content={contentFromText('Body')} timestamp="10:04" />);

    fireEvent.click(screen.getByRole('button', { name: 'Copy message' }));

    expect(await screen.findByText('Copy failed')).toBeDefined();
  });

  it('offers no copy action when there is no text to copy', () => {
    const content = { schema: 1, parts: [{ type: 'unknown' as const, raw: '{"kind":"chart"}' }] };
    render(<MessageCard role="assistant" content={content} timestamp="10:04" />);
    expect(screen.queryByRole('button', { name: 'Copy message' })).toBeNull();
  });

  it('takes the copy label from the caller locale', () => {
    render(
      <MessageCard
        role="user"
        content={contentFromText('Body')}
        timestamp="10:04"
        labels={{ copyMessage: 'Nachricht kopieren' }}
      />,
    );
    expect(screen.getByRole('button', { name: 'Nachricht kopieren' })).toBeDefined();
  });

  it('names the author with the caller-provided name instead of the role label', () => {
    render(
      <MessageCard
        role="assistant"
        name="Qwen 2.5 (latest)"
        content={contentFromText('Body')}
        timestamp="10:04"
      />,
    );
    expect(screen.getByText('Qwen 2.5 (latest)')).toBeDefined();
    expect(screen.queryByText('Assistant')).toBeNull();
    // The role stays the accessible name, so locate-by-role never depends on
    // which model answered.
    expect(screen.getByRole('article').getAttribute('aria-label')).toBe('Assistant');
  });

  it('renders a caller-provided avatar as a decorative header glyph', () => {
    const { container } = render(
      <MessageCard
        role="assistant"
        avatar={<span data-testid="glyph" />}
        content={contentFromText('Body')}
        timestamp="10:04"
      />,
    );
    const glyph = screen.getByTestId('glyph');
    expect(container.querySelector('[aria-hidden="true"]')?.contains(glyph)).toBe(true);
  });

  it('offers Reply in the ⋮ menu only when the caller can anchor one, and fires it', () => {
    const onReply = vi.fn();
    render(
      <MessageCard
        role="user"
        content={contentFromText('Body')}
        timestamp="10:04"
        onReply={onReply}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Reply' }));
    expect(onReply).toHaveBeenCalledTimes(1);
  });

  it('renders no ⋮ menu when no menu action exists', () => {
    render(<MessageCard role="user" content={contentFromText('Body')} timestamp="10:04" />);
    expect(screen.queryByRole('button', { name: 'More actions' })).toBeNull();
  });

  it('offers Edit beside Copy when the caller can branch, and fires it', () => {
    const onEdit = vi.fn();
    render(
      <MessageCard
        role="user"
        content={contentFromText('Body')}
        timestamp="10:04"
        onEdit={onEdit}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect(onEdit).toHaveBeenCalledTimes(1);
    // Edit is a visible control, not hidden behind the ⋮ menu.
    expect(screen.queryByRole('button', { name: 'More actions' })).toBeNull();
  });

  it('offers Make active in the ⋮ menu for an inactive branch member, and fires it', () => {
    const onMakeActive = vi.fn();
    render(
      <MessageCard
        role="user"
        content={contentFromText('Body')}
        timestamp="10:04"
        branch={{ active: false, onMakeActive }}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Make active' }));
    expect(onMakeActive).toHaveBeenCalledTimes(1);
  });

  it('marks the active branch member without offering the switch', () => {
    render(
      <MessageCard
        role="user"
        content={contentFromText('Body')}
        timestamp="10:04"
        branch={{ active: true }}
      />,
    );
    expect(screen.getByText('Active')).toBeDefined();
    expect(screen.queryByRole('button', { name: 'More actions' })).toBeNull();
  });

  it('offers Regenerate only when the caller can rerun this attempt, and fires it', () => {
    const onRegenerate = vi.fn();
    render(
      <MessageCard
        role="assistant"
        content={contentFromText('Body')}
        timestamp="10:04"
        onRegenerate={onRegenerate}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Regenerate' }));
    expect(onRegenerate).toHaveBeenCalledTimes(1);
  });

  it('disables Regenerate while a turn is already running', () => {
    render(
      <MessageCard
        role="assistant"
        content={contentFromText('Body')}
        timestamp="10:04"
        onRegenerate={() => {}}
        regenerateDisabled
      />,
    );
    expect(screen.getByRole('button', { name: 'Regenerate' }).hasAttribute('disabled')).toBe(true);
  });

  it('uses action glyphs when given and keeps the accessible names', () => {
    render(
      <MessageCard
        role="assistant"
        content={contentFromText('Body')}
        timestamp="10:04"
        icons={{ copy: <span data-testid="copy-glyph" />, edit: <span data-testid="edit-glyph" /> }}
        onEdit={() => {}}
      />,
    );
    expect(screen.getByTestId('copy-glyph')).toBeDefined();
    expect(screen.getByTestId('edit-glyph')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Copy message' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Edit' })).toBeDefined();
  });

  it('trails a still-arriving answer with a caret and keeps settled cards clean', () => {
    const { container, rerender } = render(
      <MessageCard
        role="assistant"
        content={contentFromText('Body')}
        timestamp="10:04"
        streaming
      />,
    );
    expect(container.querySelector('.animate-pulse')).not.toBeNull();
    rerender(<MessageCard role="assistant" content={contentFromText('Body')} timestamp="10:04" />);
    expect(container.querySelector('.animate-pulse')).toBeNull();
  });

  it('labels an edited-from lineage as an edit, not a reply quote', () => {
    render(
      <MessageCard
        role="user"
        content={contentFromText('Body')}
        timestamp="10:04"
        quotedExcerpt="the original prompt"
        quotedRelation="edited-from"
      />,
    );
    expect(screen.getByText('Edited from')).toBeDefined();
    expect(screen.queryByText('Replying to')).toBeNull();
  });

  it('renders no quote block when no quote is recorded', () => {
    render(<MessageCard role="user" content={contentFromText('Body')} timestamp="10:04" />);
    expect(screen.queryByText('Replying to')).toBeNull();
  });

  it('states the quoted excerpt a reply is anchored to', () => {
    render(
      <MessageCard
        role="user"
        content={contentFromText('Body')}
        timestamp="10:04"
        quotedExcerpt="the original question"
      />,
    );
    expect(screen.getByText('Replying to')).toBeDefined();
    expect(screen.getByText('the original question')).toBeDefined();
  });

  it('states an unavailable quote instead of inventing an excerpt', () => {
    render(
      <MessageCard
        role="user"
        content={contentFromText('Body')}
        timestamp="10:04"
        quotedExcerpt={null}
      />,
    );
    expect(screen.getByText('Quoted message is not in the loaded history.')).toBeDefined();
  });
});
