import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { DeleteSessionDialog } from './delete-session-dialog';

describe('DeleteSessionDialog', () => {
  it('states the irreversible and non-erasure caveats before deleting', async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn().mockResolvedValue(undefined);
    render(
      <DeleteSessionDialog
        open
        sessionTitle="History row"
        busy={false}
        error={null}
        onClose={vi.fn()}
        onDelete={onDelete}
      />,
    );

    expect(screen.getByRole('dialog', { name: 'Delete from history?' })).toBeDefined();
    expect(screen.getByText(/cannot be undone/)).toBeDefined();
    expect(screen.getByText(/not forensic erasure/)).toBeDefined();
    expect(screen.getByText(/SQLite journals or backups/)).toBeDefined();
    expect(screen.getByText(/Markdown files you exported remain/)).toBeDefined();
    expect(screen.getByText('Session: History row')).toBeDefined();

    await user.click(screen.getByRole('button', { name: 'Delete from history' }));
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it('disables both actions while busy and shows the failure', async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn();
    render(
      <DeleteSessionDialog
        open
        sessionTitle="History row"
        busy
        error="This session is busy."
        onClose={vi.fn()}
        onDelete={onDelete}
      />,
    );

    expect(screen.getByRole('alert').textContent).toContain('busy');
    expect((screen.getByRole('button', { name: 'Cancel' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    const deleteButton = screen.getByRole('button', {
      name: 'Deleting…',
    }) as HTMLButtonElement;
    expect(deleteButton.disabled).toBe(true);
    await user.click(deleteButton);
    expect(onDelete).not.toHaveBeenCalled();
  });
});
