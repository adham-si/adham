import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Switch } from './switch';

describe('Switch', () => {
  it('renders the checked state and accessible name', () => {
    render(<Switch checked ariaLabel="Enabled in chat" onCheckedChange={() => {}} />);
    const switchControl = screen.getByRole('switch', { name: 'Enabled in chat' });
    expect(switchControl.getAttribute('aria-checked')).toBe('true');
    expect(switchControl.className).toContain('bg-action');
  });

  it('renders the unchecked track without the action token', () => {
    render(<Switch checked={false} ariaLabel="Enabled in chat" onCheckedChange={() => {}} />);
    const switchControl = screen.getByRole('switch', { name: 'Enabled in chat' });
    expect(switchControl.getAttribute('aria-checked')).toBe('false');
    expect(switchControl.className).not.toContain('bg-action');
  });

  it('notifies with the next value on click', async () => {
    const user = userEvent.setup();
    const onCheckedChange = vi.fn();
    render(<Switch checked={false} ariaLabel="Toggle" onCheckedChange={onCheckedChange} />);
    await user.click(screen.getByRole('switch'));
    expect(onCheckedChange).toHaveBeenCalledWith(true);
  });

  it('does not fire when disabled', async () => {
    const user = userEvent.setup();
    const onCheckedChange = vi.fn();
    render(<Switch checked onCheckedChange={onCheckedChange} disabled ariaLabel="Toggle" />);
    await user.click(screen.getByRole('switch'));
    expect(onCheckedChange).not.toHaveBeenCalled();
  });

  it('keeps the knob on the logical start side when unchecked (RTL-safe justify, not translate)', () => {
    render(<Switch checked={false} ariaLabel="Toggle" onCheckedChange={() => {}} />);
    expect(screen.getByRole('switch').className).toContain('justify-start');
  });
});
