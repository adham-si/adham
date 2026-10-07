import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Textarea } from './textarea';

const DIRECTION_LOCKED = /(^|\s)(left-|right-|ml-|mr-|pl-|pr-)/;

describe('Textarea', () => {
  it('renders a multi-line textbox', () => {
    render(<Textarea rows={4} placeholder="Compose" />);
    const textarea = screen.getByPlaceholderText('Compose');
    expect(textarea.tagName).toBe('TEXTAREA');
    expect(textarea).toHaveProperty('rows', 4);
  });

  it('default: surface background and the control boundary token', () => {
    render(<Textarea />);
    const { className } = screen.getByRole('textbox');
    expect(className).toContain('bg-surface');
    expect(className).toContain('border-border');
  });

  it('focus-visible: strengthens the boundary with border-strong', () => {
    render(<Textarea />);
    expect(screen.getByRole('textbox').className).toContain('focus-visible:outline-border-strong');
  });

  it('disabled: sets the native attribute', () => {
    render(<Textarea disabled />);
    expect(screen.getByRole('textbox')).toHaveProperty('disabled', true);
  });

  it('invalid: sets aria-invalid and switches the boundary to danger', () => {
    render(<Textarea invalid />);
    expect(screen.getByRole('textbox').getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByRole('textbox').className).toContain('border-danger');
  });

  it('read-only: sets the native readOnly attribute', () => {
    render(<Textarea readOnly />);
    expect(screen.getByRole('textbox')).toHaveProperty('readOnly', true);
  });

  it('errorMessage: renders role=alert and points aria-describedby at it', () => {
    render(<Textarea errorMessage="Too short" />);
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toBe('Too short');
    expect(screen.getByRole('textbox').getAttribute('aria-describedby')).toBe(alert.id);
  });

  it('associates a label via htmlFor and id', () => {
    render(
      <>
        <label htmlFor="compose">Message</label>
        <Textarea id="compose" />
      </>,
    );
    expect(screen.getByLabelText('Message')).toBe(screen.getByRole('textbox'));
  });

  it.each([
    ['sm', 'min-h-control-sm'],
    ['md', 'min-h-control-md'],
    ['lg', 'min-h-control-lg'],
  ] as const)('size %s applies %s', (size, expected) => {
    render(<Textarea size={size} />);
    expect(screen.getByRole('textbox').className).toContain(expected);
  });

  it('never fixes a height so wrapped text grows the control', () => {
    const { container } = render(<Textarea rows={3} />);
    const className = container.querySelector('textarea')?.className ?? '';
    expect(className).not.toMatch(/(^|\s)h-\d/);
    expect(className).not.toMatch(/(^|\s)h-\[/);
  });

  it('renders no direction-locked utility', () => {
    const { container } = render(<Textarea size="lg" invalid />);
    expect(container.querySelector('textarea')?.className).not.toMatch(DIRECTION_LOCKED);
  });

  it('uses no magic values', () => {
    const { container } = render(<Textarea invalid errorMessage="x" />);
    const className = container.querySelector('textarea')?.className ?? '';
    expect(className).not.toContain('#');
    expect(className).not.toContain('[var(');
  });

  it('lets a caller className override the base padding', () => {
    render(<Textarea className="px-8" />);
    const { className } = screen.getByRole('textbox');
    expect(className).toContain('px-8');
    expect(className).not.toContain('px-4');
  });

  it('forwards a ref to the textarea element', () => {
    let captured: HTMLTextAreaElement | null = null;
    render(
      <Textarea
        ref={(element) => {
          captured = element;
        }}
      />,
    );
    expect(captured).toBeInstanceOf(HTMLTextAreaElement);
  });
});
