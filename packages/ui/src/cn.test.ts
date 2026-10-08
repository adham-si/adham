import { describe, expect, it } from 'vitest';
import { cn } from './cn';

const someFlag: boolean = false;

describe('cn', () => {
  it('lets a caller className override the component base', () => {
    expect(cn('p-4', 'p-8')).toBe('p-8');
  });

  it('joins conditional classes and drops falsy values', () => {
    expect(cn('a', someFlag && 'b', 'c')).toBe('a c');
  });

  it('accepts objects and arrays the way clsx does', () => {
    expect(cn(['a', 'b'], { c: true, d: false })).toBe('a b c');
  });

  it('resolves conflicting variants across the group, not by string order', () => {
    expect(cn('bg-surface', 'bg-danger')).toBe('bg-danger');
    expect(cn('text-foreground', 'text-foreground-muted')).toBe('text-foreground-muted');
  });

  it('keeps non-conflicting utilities from every argument', () => {
    expect(cn('rounded-md border-border bg-surface', 'min-h-control-md')).toBe(
      'rounded-md border-border bg-surface min-h-control-md',
    );
  });

  // tailwind-merge only knows Tailwind's own scales. `--control-md` and friends
  // are aliased into `--spacing-*` in tokens.css, so these must be extended
  // explicitly — otherwise a caller's `min-h-control-lg` silently loses to the
  // component's `min-h-control-md`, which is exactly the bug cn() exists to stop.
  it('lets a caller override a control-height utility', () => {
    expect(cn('min-h-control-md px-4', 'min-h-control-lg')).toBe('px-4 min-h-control-lg');
  });

  it('lets a caller override an icon-size utility', () => {
    expect(cn('size-icon-md', 'size-icon-lg')).toBe('size-icon-lg');
  });

  it('lets a caller override a layering utility', () => {
    expect(cn('z-dialog', 'z-menu')).toBe('z-menu');
  });

  it('preserves arbitrary values that are not Tailwind conflicts', () => {
    expect(cn('grid-cols-[1fr_auto]', 'grid-rows-2')).toBe('grid-cols-[1fr_auto] grid-rows-2');
  });

  it('returns an empty string when every input is falsy', () => {
    expect(cn(false, undefined, null, '')).toBe('');
  });

  it('does not treat semantic token utilities as conflicts with each other', () => {
    expect(cn('bg-surface-subtle', 'text-foreground-secondary')).toBe(
      'bg-surface-subtle text-foreground-secondary',
    );
  });

  it('lets state variants override their base utility', () => {
    expect(cn('bg-surface', 'hover:bg-surface-hover')).toBe('bg-surface hover:bg-surface-hover');
    expect(cn('bg-surface', 'hover:bg-surface-hover', 'hover:bg-surface-muted')).toBe(
      'bg-surface hover:bg-surface-muted',
    );
  });
});
