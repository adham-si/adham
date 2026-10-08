import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Button } from './button';

const DIRECTION_LOCKED = /(^|\s)(left-|right-|ml-|mr-|pl-|pr-)/;

describe('Button', () => {
  it('renders children', () => {
    render(<Button>Send</Button>);
    expect(screen.getByRole('button', { name: 'Send' })).toBeDefined();
  });

  it('defaults to primary at md', () => {
    render(<Button>Primary</Button>);
    const button = screen.getByRole('button');
    expect(button.className).toContain('bg-action');
    expect(button.className).toContain('min-h-control-md');
  });

  // --- spec §7 state matrix: default, hover, pressed, focus-visible, disabled, loading
  it('default: primary background and foreground', () => {
    render(<Button>Primary</Button>);
    const { className } = screen.getByRole('button');
    expect(className).toContain('bg-action');
    expect(className).toContain('text-action-foreground');
  });

  // regression: bg-danger vs text-danger-foreground is 1.00:1 (identical values) — label invisible
  it('default: danger background pairs with the surface foreground, never itself', () => {
    render(<Button variant="danger">Danger</Button>);
    const { className } = screen.getByRole('button');
    expect(className).toContain('bg-danger');
    expect(className).toContain('text-danger-surface');
    expect(className).not.toContain('text-danger-foreground');
  });

  it('secondary: rests on the subtle boundary, sharpens only on focus', () => {
    render(<Button variant="secondary">Secondary</Button>);
    const { className } = screen.getByRole('button');
    expect(className).toContain('border-border-subtle');
    expect(className).not.toContain('hover:border');
    expect(className).toContain('focus-visible:border-border');
  });

  it('hover: every variant declares a hover background', () => {
    for (const variant of ['primary', 'secondary', 'ghost', 'danger', 'link'] as const) {
      const { container } = render(<Button variant={variant}>Hover</Button>);
      const button = container.querySelector('button');
      expect(button?.className, `${variant} hover`).toContain('hover:');
    }
  });

  it('pressed: every non-link variant declares an active background', () => {
    for (const variant of ['primary', 'secondary', 'ghost', 'danger'] as const) {
      const { container } = render(<Button variant={variant}>Press</Button>);
      const button = container.querySelector('button');
      expect(button?.className, `${variant} active`).toContain('active:');
    }
  });

  it('focus-visible: outlines with the focus token rather than a shadow', () => {
    render(<Button>Focus</Button>);
    const { className } = screen.getByRole('button');
    expect(className).toContain('focus-visible:outline-2');
    expect(className).toContain('outline-focus');
    expect(className).not.toContain('focus-visible:shadow');
  });

  it('disabled: sets the native disabled attribute', () => {
    render(<Button disabled>Disabled</Button>);
    expect(screen.getByRole('button')).toHaveProperty('disabled', true);
  });

  it('loading: sets aria-busy and blocks activation', () => {
    render(<Button loading>Saving</Button>);
    const button = screen.getByRole('button');
    expect(button.getAttribute('aria-busy')).toBe('true');
    expect(button).toHaveProperty('disabled', true);
  });

  it('not loading: omits aria-busy', () => {
    render(<Button>Idle</Button>);
    expect(screen.getByRole('button').hasAttribute('aria-busy')).toBe(false);
  });

  it('iconOnly: square control that takes its name from aria-label', () => {
    render(
      <Button iconOnly size="sm" aria-label="Close">
        <span data-testid="glyph" />
      </Button>,
    );
    const { className } = screen.getByRole('button', { name: 'Close' });
    expect(className).toContain('aspect-square');
    expect(className).toContain('px-0');
    expect(screen.getByTestId('glyph')).toBeDefined();
  });

  it('iconOnly + loading: swaps the child for the spinner', () => {
    const { container } = render(
      <Button iconOnly loading aria-label="Saving">
        <span data-testid="glyph" />
      </Button>,
    );
    expect(container.querySelector('svg.animate-spin')).not.toBeNull();
    expect(screen.queryByTestId('glyph')).toBeNull();
  });

  it('loading: spinner is decorative, reduced-motion aware, sized with the button', () => {
    const { container } = render(
      <Button loading size="lg">
        Saving
      </Button>,
    );
    const spinner = container.querySelector('svg.animate-spin');
    expect(spinner?.getAttribute('aria-hidden')).toBe('true');
    expect(spinner?.getAttribute('class')).toContain('motion-reduce:animate-none');
    expect(spinner?.getAttribute('class')).toContain('size-icon-lg');
    expect(screen.getByRole('button', { name: 'Saving' })).toBeDefined();
  });

  // --- sizes: min-h + padding, never a fixed height
  it.each([
    ['xs', 'min-h-control-xs'],
    ['sm', 'min-h-control-sm'],
    ['md', 'min-h-control-md'],
    ['lg', 'min-h-control-lg'],
  ] as const)('size %s applies %s', (size, expected) => {
    render(<Button size={size}>Sized</Button>);
    expect(screen.getByRole('button').className).toContain(expected);
  });

  it.each(['xs', 'sm', 'md', 'lg'] as const)('size %s never fixes a height', (size) => {
    render(<Button size={size}>Sized</Button>);
    const { className } = screen.getByRole('button');
    expect(className).not.toMatch(/(^|\s)h-\d/);
    expect(className).not.toMatch(/(^|\s)h-\[/);
  });

  it('every size keeps rounded-md', () => {
    for (const size of ['xs', 'sm', 'md', 'lg'] as const) {
      const { container } = render(<Button size={size}>Rounded</Button>);
      expect(container.querySelector('button')?.className).toContain('rounded-md');
    }
  });

  it('link variant drops the control radius and horizontal padding', () => {
    render(<Button variant="link">Link</Button>);
    const { className } = screen.getByRole('button');
    expect(className).toContain('rounded-none');
    expect(className).toContain('text-accent');
  });

  // --- shared assertions from the plan
  it('renders no direction-locked utility', () => {
    const { container } = render(
      <Button variant="secondary" size="lg">
        Direction
      </Button>,
    );
    expect(container.querySelector('button')?.className).not.toMatch(DIRECTION_LOCKED);
  });

  it('lets a caller className override the base padding', () => {
    render(<Button className="px-8">Override</Button>);
    const { className } = screen.getByRole('button');
    expect(className).toContain('px-8');
    expect(className).not.toContain('px-4');
  });

  it('lets a caller override the control height', () => {
    render(<Button className="min-h-control-lg">Override</Button>);
    const { className } = screen.getByRole('button');
    expect(className).toContain('min-h-control-lg');
    expect(className).not.toContain('min-h-control-md');
  });

  it('uses no magic values', () => {
    const { container } = render(<Button variant="danger">Danger</Button>);
    const className = container.querySelector('button')?.className ?? '';
    expect(className).not.toContain('#');
    expect(className).not.toContain('[var(');
    expect(className).not.toMatch(/(^|\s)bg-red-/);
  });

  // --- React 19: ref is a plain prop, no forwardRef
  it('forwards a ref to the underlying button element', () => {
    let captured: HTMLButtonElement | null = null;
    render(
      <Button
        ref={(element) => {
          captured = element;
        }}
      >
        Ref
      </Button>,
    );
    expect(captured).toBeInstanceOf(HTMLButtonElement);
  });

  it('defaults type to button so it never submits a form by accident', () => {
    render(<Button>Safe</Button>);
    expect(screen.getByRole('button').getAttribute('type')).toBe('button');
  });

  it('honours an explicit type', () => {
    render(<Button type="submit">Send</Button>);
    expect(screen.getByRole('button').getAttribute('type')).toBe('submit');
  });

  it('fullWidth applies w-full', () => {
    render(<Button fullWidth>Wide</Button>);
    expect(screen.getByRole('button').className).toContain('w-full');
  });
});
