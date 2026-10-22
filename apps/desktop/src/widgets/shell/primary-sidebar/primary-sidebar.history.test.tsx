import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useSessionActions } from '@/features/history/use-session-actions';
import { PrimarySidebar } from './primary-sidebar';

const session = {
  id: 'sess-1',
  title: 'History row',
  updatedAt: '2026-10-20T11:00:00Z',
  summary: 'First question — Latest answer',
  pinned: true,
  archived: false,
};

describe('PrimarySidebar session actions', () => {
  it('opens the row menu and dispatches rename, pin, and archive', () => {
    const onRenameSession = vi.fn();
    const onSetPinned = vi.fn();
    const onSetArchived = vi.fn();
    render(
      <PrimarySidebar
        sessions={[session]}
        activeSessionId={session.id}
        onRenameSession={onRenameSession}
        onSetPinned={onSetPinned}
        onSetArchived={onSetArchived}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Session actions' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Rename' }));
    expect(onRenameSession).toHaveBeenCalledWith(session);

    fireEvent.click(screen.getByRole('button', { name: 'Session actions' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Unpin' }));
    expect(onSetPinned).toHaveBeenCalledWith('sess-1', false);

    fireEvent.click(screen.getByRole('button', { name: 'Session actions' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Archive' }));
    expect(onSetArchived).toHaveBeenCalledWith('sess-1', true);
  });

  it('keeps the archived badge on the active row', () => {
    render(
      <PrimarySidebar sessions={[{ ...session, archived: true }]} activeSessionId={session.id} />,
    );
    expect(screen.getByText('Archived')).toBeTruthy();
  });
});

describe('useSessionActions', () => {
  it('calls the client and refreshes after each action', async () => {
    const backend = {
      renameSession: vi.fn().mockResolvedValue({}),
      setSessionPinned: vi.fn().mockResolvedValue({}),
      setSessionArchived: vi.fn().mockResolvedValue({}),
    };
    const onChanged = vi.fn();
    const { result } = renderHook(() =>
      useSessionActions({
        workspaceId: 'ws-1',
        projectId: 'proj-1',
        backend,
        onChanged,
      }),
    );

    act(() => result.current.openRename(session));
    await act(async () => {
      await result.current.saveRename('Renamed row');
    });
    expect(backend.renameSession).toHaveBeenCalledWith('ws-1', 'proj-1', 'sess-1', 'Renamed row');
    expect(onChanged).toHaveBeenCalled();

    await act(async () => {
      await result.current.setPinned('sess-1', false);
    });
    expect(backend.setSessionPinned).toHaveBeenCalledWith('ws-1', 'proj-1', 'sess-1', false);
    await act(async () => {
      await result.current.setArchived('sess-1', true);
    });
    expect(backend.setSessionArchived).toHaveBeenCalledWith('ws-1', 'proj-1', 'sess-1', true);
    await waitFor(() => expect(result.current.busyId).toBeNull());
  });
});
