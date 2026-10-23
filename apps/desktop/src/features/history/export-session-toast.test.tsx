import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ExportSessionToast } from './export-session-toast';

describe('ExportSessionToast', () => {
  it('shows the saved path and bytes, copies the path, and dismisses', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    const onClose = vi.fn();
    render(
      <ExportSessionToast
        result={{ path: '/tmp/exports/History-id.md', bytes: 1536 }}
        onClose={onClose}
      />,
    );

    expect(screen.getByRole('status').textContent).toContain('Export complete');
    expect(screen.getByText('/tmp/exports/History-id.md')).toBeDefined();
    expect(screen.getByText('1,536 bytes')).toBeDefined();

    await user.click(screen.getByRole('button', { name: 'Copy path' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('/tmp/exports/History-id.md'));
    expect(screen.getByRole('button', { name: 'Copied' })).toBeDefined();

    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('renders nothing without a result', () => {
    const { container } = render(<ExportSessionToast result={null} onClose={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });
});
