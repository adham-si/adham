import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Input } from './input';

const DIRECTION_LOCKED = /(^|\s)(left-|right-|ml-|mr-|pl-|pr-)/;

describe('Input', () => {
  it('renders and takes typing props', () => {
    render(<Input placeholder="Type here" defaultValue="hello" />);
    const input = screen.getByPlaceholderText('Type here');
    expect(input).toHaveProperty('value', 'hello');
  });

  // --- spec §7: default, hover, focus-visible, disabled, invalid, read-only
  it('default: quiet boundary; hover leaves the border alone', () => {
    render(<Input />);
    const { className } = screen.getByRole('textbox');
    expect(className).toContain('bg-surface');
    expect(className).toContain('border-border-subtle');
    expect(className).not.toContain('hover:border');
  });

  it('focus-visible: 2px branded ring drawn over the 1px border', () => {
    render(<Input />);
    const { className } = screen.getByRole('textbox');
    expect(className).toContain('focus-visible:outline-2');
    expect(className).toContain('focus-visible:-outline-offset-1');
    expect(className).toContain('focus-visible:outline-focus');
  });

  it('click feedback is instant: no transition utilities', () => {
    render(<Input />);
    expect(screen.getByRole('textbox').className).not.toContain('transition-');
  });

  it('vertical breathing room: py-1 so text never touches the border', () => {
    for (const size of ['sm', 'md', 'lg'] as const) {
      const { container, unmount } = render(<Input size={size} />);
      expect(container.querySelector('input')?.className, size).toContain('py-1');
      unmount();
    }
  });

  it('border widths stay 1px', () => {
    render(<Input invalid />);
    const { className } = screen.getByRole('textbox');
    expect(className).toMatch(/(^|\s)border(\s|$)/);
    expect(className).not.toMatch(/(^|\s)border-[0-9]/);
    expect(className).not.toMatch(/(^|\s)border-[xytblr]{1,2}-[0-9]/);
  });

  it('disabled: sets the native attribute and the disabled surface', () => {
    render(<Input disabled />);
    const input = screen.getByRole('textbox');
    expect(input).toHaveProperty('disabled', true);
    expect(input.className).toContain('disabled:bg-surface-disabled');
  });

  it('invalid: sets aria-invalid and switches the boundary to danger', () => {
    render(<Input invalid />);
    const input = screen.getByRole('textbox');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.className).toContain('border-danger');
    expect(input.className).toContain('focus-visible:outline-danger');
  });

  it('not invalid: omits aria-invalid', () => {
    render(<Input />);
    expect(screen.getByRole('textbox').hasAttribute('aria-invalid')).toBe(false);
  });

  it('read-only: sets the native readOnly attribute and the subtle surface', () => {
    render(<Input readOnly />);
    const input = screen.getByRole('textbox');
    expect(input).toHaveProperty('readOnly', true);
    expect(input.className).toContain('read-only:bg-surface-subtle');
  });

  it('errorMessage: renders role=alert and points aria-describedby at it', () => {
    render(<Input errorMessage="Required" />);
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toBe('Required');
    expect(screen.getByRole('textbox').getAttribute('aria-describedby')).toBe(alert.id);
  });

  it('errorMessage: keeps a caller-supplied aria-describedby', () => {
    render(<Input errorMessage="Required" aria-describedby="hint" />);
    const described = screen.getByRole('textbox').getAttribute('aria-describedby') ?? '';
    expect(described).toContain(screen.getByRole('alert').id);
    expect(described).toContain('hint');
  });

  it('associates a label via htmlFor and id', () => {
    render(
      <>
        <label htmlFor="workspace">Workspace</label>
        <Input id="workspace" />
      </>,
    );
    expect(screen.getByLabelText('Workspace')).toBe(screen.getByRole('textbox'));
  });

  it('associates a label that wraps the field, with no explicit id', () => {
    render(
      <label>
        Project
        <Input />
      </label>,
    );
    expect(screen.getByLabelText('Project')).toBe(screen.getByRole('textbox'));
  });

  it('gives every field a unique id so labels cannot collide', () => {
    render(
      <>
        <label htmlFor="first">First</label>
        <Input id="first" />
        <label htmlFor="second">Second</label>
        <Input id="second" />
      </>,
    );
    expect(screen.getByLabelText('First').id).not.toBe(screen.getByLabelText('Second').id);
  });

  it('error ids stay unique across instances', () => {
    render(
      <>
        <Input errorMessage="One" />
        <Input errorMessage="Two" />
      </>,
    );
    const alerts = screen.getAllByRole('alert');
    expect(alerts[0]?.id).not.toBe(alerts[1]?.id);
  });

  it.each([
    ['sm', 'min-h-control-sm'],
    ['md', 'min-h-control-md'],
    ['lg', 'min-h-control-lg'],
  ] as const)('size %s applies %s', (size, expected) => {
    render(<Input size={size} />);
    expect(screen.getByRole('textbox').className).toContain(expected);
  });

  it('never fixes a height', () => {
    for (const size of ['sm', 'md', 'lg'] as const) {
      const { container } = render(<Input size={size} />);
      const className = container.querySelector('input')?.className ?? '';
      expect(className, size).not.toMatch(/(^|\s)h-\d/);
      expect(className, size).not.toMatch(/(^|\s)h-\[/);
    }
  });

  it('renders no direction-locked utility', () => {
    const { container } = render(<Input size="lg" invalid />);
    expect(container.querySelector('input')?.className).not.toMatch(DIRECTION_LOCKED);
  });

  it('uses no magic values', () => {
    const { container } = render(<Input invalid errorMessage="x" />);
    const className = container.querySelector('input')?.className ?? '';
    expect(className).not.toContain('#');
    expect(className).not.toContain('[var(');
  });

  it('lets a caller className override the base padding', () => {
    render(<Input className="px-8" />);
    const { className } = screen.getByRole('textbox');
    expect(className).toContain('px-8');
    expect(className).not.toContain('px-4');
  });

  it('forwards a ref to the input element', () => {
    let captured: HTMLInputElement | null = null;
    render(
      <Input
        ref={(element) => {
          captured = element;
        }}
      />,
    );
    expect(captured).toBeInstanceOf(HTMLInputElement);
  });
});
