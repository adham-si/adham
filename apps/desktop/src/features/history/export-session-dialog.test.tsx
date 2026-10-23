import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ExportSessionDialog } from './export-session-dialog';

describe('ExportSessionDialog', () => {
  it('warns before export and closes after a successful save', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const onExport = vi.fn().mockResolvedValue({ path: '/tmp/exports/History-id.md', bytes: 1536 });
    render(
      <ExportSessionDialog
        open
        sessionTitle="History row"
        busy={false}
        error={null}
        onClose={onClose}
        onExport={onExport}
      />,
    );

    expect(screen.getByText(/unencrypted Markdown file/)).toBeDefined();
    expect(screen.getByText(/not deleted when you delete the session/)).toBeDefined();
    expect(screen.queryByText(/fixed exports folder/)).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Export Markdown' }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(onExport).toHaveBeenCalledTimes(1);
    expect(screen.queryByDisplayValue('/tmp/exports/History-id.md')).toBeNull();
    expect(screen.queryByText(/Export complete/)).toBeNull();
  });

  it('keeps the dialog open when the native Save As panel is canceled', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const onExport = vi.fn().mockResolvedValue(null);
    render(
      <ExportSessionDialog
        open
        sessionTitle="History row"
        busy={false}
        error={null}
        onClose={onClose}
        onExport={onExport}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Export Markdown' }));
    await waitFor(() => expect(onExport).toHaveBeenCalledTimes(1));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('button', { name: 'Export Markdown' })).toBeDefined();
  });

  it('shows the localized failure and disables export while busy', async () => {
    const user = userEvent.setup();
    const onExport = vi.fn();
    render(
      <ExportSessionDialog
        open
        sessionTitle="History row"
        busy
        error="This session is too large to export."
        onClose={vi.fn()}
        onExport={onExport}
      />,
    );

    expect(screen.getByRole('alert').textContent).toContain('too large to export');
    const button = screen.getByRole('button', { name: 'Exporting…' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    await user.click(button);
    expect(onExport).not.toHaveBeenCalled();
  });
});
