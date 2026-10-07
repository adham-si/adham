import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Button } from './button';

describe('Button component', () => {
  it('renders children correctly', () => {
    render(<Button>Click me</Button>);
    expect(screen.getByRole('button', { name: /click me/i })).toBeDefined();
  });

  it('renders primary variant by default', () => {
    render(<Button>Primary Button</Button>);
    const btn = screen.getByRole('button', { name: /primary button/i });
    expect(btn.className).toContain('bg-[var(--color-brand,#2B2BFF)]');
  });

  it('supports secondary variant', () => {
    render(<Button variant="secondary">Secondary</Button>);
    const btn = screen.getByRole('button', { name: /secondary/i });
    expect(btn.className).toContain('bg-[var(--color-bg-subtle,#F4F4F6)]');
  });
});
