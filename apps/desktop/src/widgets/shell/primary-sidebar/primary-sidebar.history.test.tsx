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
    const onDuplicateSession = vi.fn();
    const onExportSession = vi.fn();
    const onDeleteSession = vi.fn();
    const onSetPinned = vi.fn();
    const onSetArchived = vi.fn();
    render(
      <PrimarySidebar
        sessions={[session]}
        activeSessionId={session.id}
        onRenameSession={onRenameSession}
        onDuplicateSession={onDuplicateSession}
        onExportSession={onExportSession}
        onDeleteSession={onDeleteSession}
        onSetPinned={onSetPinned}
        onSetArchived={onSetArchived}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Session actions' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Rename' }));
    expect(onRenameSession).toHaveBeenCalledWith(session);

    fireEvent.click(screen.getByRole('button', { name: 'Session actions' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Duplicate' }));
    expect(onDuplicateSession).toHaveBeenCalledWith(session);

    fireEvent.click(screen.getByRole('button', { name: 'Session actions' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Export Markdown' }));
    expect(onExportSession).toHaveBeenCalledWith(session);

    fireEvent.click(screen.getByRole('button', { name: 'Session actions' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete from history' }));
    expect(onDeleteSession).toHaveBeenCalledWith(session);

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
      setSessionSummary: vi.fn().mockResolvedValue({ summaryOrigin: 'user' }),
      duplicateSession: vi.fn().mockResolvedValue({ sessionId: 'copy-1' }),
      exportSessionMarkdown: vi
        .fn()
        .mockResolvedValue({ path: '/tmp/exports/History.md', bytes: 12 }),
      deleteSession: vi.fn().mockResolvedValue({ sessionId: 'sess-1', deleted: true }),
    };
    const onChanged = vi.fn();
    const { result } = renderHook(() =>
      useSessionActions({
        workspaceId: 'ws-1',
        projectId: 'proj-1',
        activeSessionId: 'sess-1',
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

    act(() => result.current.openRename(session));
    await act(async () => {
      await result.current.saveSummary('Custom summary');
    });
    expect(backend.setSessionSummary).toHaveBeenCalledWith(
      'ws-1',
      'proj-1',
      'sess-1',
      'Custom summary',
    );
    expect(onChanged).toHaveBeenCalledTimes(4);

    const onSelect = vi.fn();
    window.addEventListener('adham:session-select', onSelect);
    await act(async () => {
      await result.current.duplicate(session);
    });
    expect(backend.duplicateSession).toHaveBeenCalledWith(
      'ws-1',
      'proj-1',
      'sess-1',
      'History row copy',
    );
    expect(onSelect).toHaveBeenCalled();
    const detail = (onSelect.mock.calls[0]?.[0] as CustomEvent | undefined)?.detail;
    expect(detail).toEqual({ workspaceId: 'ws-1', projectId: 'proj-1', sessionId: 'copy-1' });
    window.removeEventListener('adham:session-select', onSelect);

    act(() => result.current.openExport(session));
    let exported: { path: string; bytes: number } | null = null;
    await act(async () => {
      exported = await result.current.exportSession(session);
    });
    expect(backend.exportSessionMarkdown).toHaveBeenCalledWith('ws-1', 'proj-1', 'sess-1');
    expect(exported).toEqual({ path: '/tmp/exports/History.md', bytes: 12 });
    expect(onChanged).toHaveBeenCalledTimes(5);

    sessionStorage.setItem(
      'adham:compose:pending-send',
      JSON.stringify({
        requestId: 'req-1',
        text: 'pending',
        workspaceId: 'ws-1',
        projectId: 'proj-1',
        sessionId: 'sess-1',
      }),
    );
    const onDeleted = vi.fn();
    window.addEventListener('adham:session-select', onDeleted);
    act(() => result.current.openDelete(session));
    await act(async () => {
      await result.current.deleteSession(session);
    });
    expect(backend.deleteSession).toHaveBeenCalledWith('ws-1', 'proj-1', 'sess-1', true);
    expect(sessionStorage.getItem('adham:compose:pending-send')).toBeNull();
    const deletedDetail = (onDeleted.mock.calls[0]?.[0] as CustomEvent | undefined)?.detail;
    expect(deletedDetail).toEqual({ workspaceId: 'ws-1', projectId: 'proj-1', sessionId: null });
    window.removeEventListener('adham:session-select', onDeleted);
    expect(onChanged).toHaveBeenCalledTimes(6);
    expect(result.current.deleteTarget).toBeNull();
    await waitFor(() => expect(result.current.busyId).toBeNull());
  });
});
