import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ExportSessionDialog } from './export-session-dialog';

describe('ExportSessionDialog', () => {
  it('warns before export, then shows the path, bytes, and copies it', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    const onExport = vi.fn().mockResolvedValue({ path: '/tmp/exports/History-id.md', bytes: 1536 });
    render(
      <ExportSessionDialog
        open
        sessionTitle="History row"
        busy={false}
        error={null}
        onClose={vi.fn()}
        onExport={onExport}
      />,
    );

    expect(screen.getByText(/unencrypted Markdown file/)).toBeDefined();
    expect(screen.getByText(/not deleted when you delete the session/)).toBeDefined();
    expect(screen.getByText(/fixed exports folder/)).toBeDefined();

    await user.click(screen.getByRole('button', { name: 'Export Markdown' }));
    await waitFor(() => expect(onExport).toHaveBeenCalledTimes(1));
    expect(screen.getByDisplayValue('/tmp/exports/History-id.md')).toBeDefined();
    expect(screen.getByText('1,536 bytes')).toBeDefined();

    await user.click(screen.getByRole('button', { name: 'Copy path' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('/tmp/exports/History-id.md'));
    expect(screen.getByRole('button', { name: 'Copied' })).toBeDefined();
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
