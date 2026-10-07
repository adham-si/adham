import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import {
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogRoot,
  DialogTitle,
  DialogTrigger,
} from './dialog';

const DIRECTION_LOCKED = /(^|\s)(left-|right-|ml-|mr-|pl-|pr-)/;

function BasicDialog({ onOpenChange }: { onOpenChange?: (open: boolean) => void } = {}) {
  return (
    <DialogRoot onOpenChange={onOpenChange}>
      <DialogTrigger>Delete project</DialogTrigger>
      <DialogContent label="Confirm delete">
        <DialogTitle>Delete project?</DialogTitle>
        <DialogDescription>This cannot be undone.</DialogDescription>
        <input aria-label="Confirm name" />
        <DialogClose>Cancel</DialogClose>
        <DialogClose>Delete</DialogClose>
      </DialogContent>
    </DialogRoot>
  );
}

describe('Dialog', () => {
  it('renders nothing until opened', () => {
    render(<BasicDialog />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('exposes dialog, aria-modal and an accessible name', async () => {
    const user = userEvent.setup();
    render(<BasicDialog />);
    await user.click(screen.getByRole('button', { name: 'Delete project' }));

    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('aria-label')).toBe('Confirm delete');
  });

  it('falls back to the title for its accessible name', async () => {
    const user = userEvent.setup();
    render(
      <DialogRoot>
        <DialogTrigger>Open</DialogTrigger>
        <DialogContent>
          <DialogTitle>Delete project?</DialogTitle>
        </DialogContent>
      </DialogRoot>,
    );
    await user.click(screen.getByRole('button', { name: 'Open' }));
    const dialog = screen.getByRole('dialog');
    const labelledBy = dialog.getAttribute('aria-labelledby');
    expect(labelledBy).not.toBeNull();
    expect(document.getElementById(labelledBy ?? '')?.textContent).toBe('Delete project?');
  });

  it('describes itself with the description', async () => {
    const user = userEvent.setup();
    render(<BasicDialog />);
    await user.click(screen.getByRole('button', { name: 'Delete project' }));
    const describedBy = screen.getByRole('dialog').getAttribute('aria-describedby') ?? '';
    expect(document.getElementById(describedBy)?.textContent).toBe('This cannot be undone.');
  });

  it('moves focus into the dialog on open', async () => {
    const user = userEvent.setup();
    render(<BasicDialog />);
    await user.click(screen.getByRole('button', { name: 'Delete project' }));
    expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true);
  });

  it('returns focus to the trigger on close', async () => {
    const user = userEvent.setup();
    render(<BasicDialog />);
    const trigger = screen.getByRole('button', { name: 'Delete project' });
    await user.click(trigger);
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(document.activeElement).toBe(trigger);
  });

  it('Escape closes and returns focus to the trigger', async () => {
    const user = userEvent.setup();
    render(<BasicDialog />);
    const trigger = screen.getByRole('button', { name: 'Delete project' });
    await user.click(trigger);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('reports the open state change', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(<BasicDialog onOpenChange={onOpenChange} />);
    await user.click(screen.getByRole('button', { name: 'Delete project' }));
    expect(onOpenChange).toHaveBeenCalledWith(true);
    await user.keyboard('{Escape}');
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('traps Tab: from the last control it wraps to the first', async () => {
    const user = userEvent.setup();
    render(<BasicDialog />);
    await user.click(screen.getByRole('button', { name: 'Delete project' }));

    const dialog = screen.getByRole('dialog');
    const focusable = [...dialog.querySelectorAll<HTMLElement>('button, input')];
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    last?.focus();

    await user.tab();
    expect(document.activeElement).toBe(first);
  });

  it('traps Shift+Tab: from the first control it wraps to the last', async () => {
    const user = userEvent.setup();
    render(<BasicDialog />);
    await user.click(screen.getByRole('button', { name: 'Delete project' }));

    const dialog = screen.getByRole('dialog');
    const focusable = [...dialog.querySelectorAll<HTMLElement>('button, input')];
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    first?.focus();

    await user.tab({ shift: true });
    expect(document.activeElement).toBe(last);
  });

  it('clicking the scrim closes the dialog', async () => {
    const user = userEvent.setup();
    render(<BasicDialog />);
    await user.click(screen.getByRole('button', { name: 'Delete project' }));
    const scrim = document.querySelector('[data-dialog-scrim]');
    expect(scrim).not.toBeNull();
    await user.click(scrim as Element);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('uses the scrim token and the dialog layer', async () => {
    const user = userEvent.setup();
    render(<BasicDialog />);
    await user.click(screen.getByRole('button', { name: 'Delete project' }));
    const scrim = document.querySelector('[data-dialog-scrim]');
    expect(scrim?.className).toContain('bg-scrim');
    expect(screen.getByRole('dialog').parentElement?.className).toContain('z-dialog');
  });

  it.each([
    ['sm', 'max-w-sm'],
    ['md', 'max-w-lg'],
    ['lg', 'max-w-2xl'],
  ] as const)('size %s applies %s', async (size, expected) => {
    const user = userEvent.setup();
    render(
      <DialogRoot>
        <DialogTrigger>Open</DialogTrigger>
        <DialogContent size={size} label="Sized">
          Body
        </DialogContent>
      </DialogRoot>,
    );
    await user.click(screen.getByRole('button', { name: 'Open' }));
    expect(screen.getByRole('dialog').className).toContain(expected);
  });

  it('renders no direction-locked utility and no magic values', async () => {
    const user = userEvent.setup();
    const { container } = render(<BasicDialog />);
    await user.click(screen.getByRole('button', { name: 'Delete project' }));
    for (const element of container.querySelectorAll('[class]')) {
      expect(element.className).not.toMatch(DIRECTION_LOCKED);
      expect(element.className).not.toContain('#');
      expect(element.className).not.toContain('[var(');
    }
  });

  it('refuses to render parts outside a DialogRoot', () => {
    expect(() => render(<DialogContent label="orphan">x</DialogContent>)).toThrow(/DialogRoot/);
  });
});
