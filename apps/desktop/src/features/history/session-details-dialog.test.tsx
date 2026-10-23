import type * as React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { SessionDetailsDialog } from './session-details-dialog';

function renderDialog(overrides: Partial<React.ComponentProps<typeof SessionDetailsDialog>> = {}) {
  const onSave = vi.fn().mockResolvedValue(undefined);
  const onSaveSummary = vi.fn().mockResolvedValue(undefined);
  render(
    <SessionDetailsDialog
      open
      initialTitle="History row"
      initialSummary="First question — Latest answer"
      initialSummaryOrigin="auto"
      busy={false}
      error={null}
      onClose={vi.fn()}
      onSave={onSave}
      onSaveSummary={onSaveSummary}
      {...overrides}
    />,
  );
  return { onSave, onSaveSummary };
}

describe('SessionDetailsDialog summary', () => {
  it('saves a trimmed user summary', async () => {
    const user = userEvent.setup();
    const { onSave, onSaveSummary } = renderDialog();
    const summary = screen.getByRole('textbox', { name: 'Summary' });

    await user.clear(summary);
    await user.type(summary, '  My summary  ');
    await user.click(screen.getByRole('button', { name: 'Save summary' }));

    expect(onSaveSummary).toHaveBeenCalledWith('My summary');
    expect(onSave).not.toHaveBeenCalled();
  });

  it('sends null for an empty summary and for reset', async () => {
    const user = userEvent.setup();
    const { onSaveSummary } = renderDialog({ initialSummaryOrigin: 'user' });
    const summary = screen.getByRole('textbox', { name: 'Summary' });

    await user.clear(summary);
    await user.click(screen.getByRole('button', { name: 'Save summary' }));
    expect(onSaveSummary).toHaveBeenLastCalledWith(null);

    await user.click(screen.getByRole('button', { name: 'Reset to auto' }));
    expect(onSaveSummary).toHaveBeenLastCalledWith(null);
  });

  it('shows the localized limit error and refuses to save over 500 scalars', async () => {
    const user = userEvent.setup();
    const { onSaveSummary } = renderDialog();
    const summary = screen.getByRole('textbox', { name: 'Summary' });

    await user.clear(summary);
    fireEvent.change(summary, { target: { value: 'a'.repeat(501) } });

    expect(await screen.findByText('The summary must be 500 characters or fewer.')).toBeDefined();
    const save = screen.getByRole('button', { name: 'Save summary' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    await user.click(save);
    expect(onSaveSummary).not.toHaveBeenCalled();
  });
});
