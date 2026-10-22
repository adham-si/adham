import type * as React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { SessionSearchResponse, SessionSearchResult } from '@adham/contracts-generated';
import { SessionHistoryPanel } from './session-history-panel';
import type { SessionSearchBackend } from './use-session-search';

const session = {
  id: 'sess-1',
  title: 'History row',
  updatedAt: '2026-10-22T10:00:00Z',
  summary: 'First question — Latest answer',
  pinned: true,
  archived: false,
};

function response(overrides: Partial<SessionSearchResponse> = {}): SessionSearchResponse {
  return {
    results: [],
    truncated: false,
    scannedSessions: 0,
    scanLimitReached: false,
    skippedUnreadable: 0,
    ...overrides,
  };
}

function hit(overrides: Partial<SessionSearchResult> = {}): SessionSearchResult {
  return {
    sessionId: 'sess-1',
    title: 'History row',
    summary: null,
    summaryOrigin: null,
    lastActivityAt: '2026-10-22T10:00:00Z',
    matchKind: 'message',
    messageId: 'msg-1',
    role: 'user',
    snippet: 'a needle in the saved text',
    attachmentName: null,
    ...overrides,
  };
}

function backend(result: SessionSearchResponse | Error): SessionSearchBackend & {
  searchHistory: ReturnType<typeof vi.fn>;
} {
  const searchHistory = vi.fn();
  if (result instanceof Error) searchHistory.mockRejectedValueOnce(result);
  else searchHistory.mockResolvedValue(result);
  return { searchHistory };
}

function renderPanel(props: Partial<React.ComponentProps<typeof SessionHistoryPanel>> = {}) {
  return render(
    <SessionHistoryPanel
      workspaceId="ws-1"
      projectId="proj-1"
      sessions={[session]}
      activeSessionId={null}
      includeArchived={false}
      onIncludeArchivedChange={vi.fn()}
      onSelectSession={vi.fn()}
      {...props}
    />,
  );
}

describe('SessionHistoryPanel', () => {
  it('renders the normal list with the existing action menu', () => {
    const onRenameSession = vi.fn();
    renderPanel({ onRenameSession });
    expect(screen.getByText('History row')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Session actions' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Rename' }));
    expect(onRenameSession).toHaveBeenCalledWith(session);
  });

  it('does not search a one-character query and explains the minimum', async () => {
    const api = backend(response());
    renderPanel({ backend: api });
    const input = screen.getByRole('textbox', { name: 'Search sessions and messages' });
    fireEvent.change(input, { target: { value: 'n' } });
    expect(screen.getByText('Type at least 2 characters.')).toBeDefined();
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(api.searchHistory).not.toHaveBeenCalled();
  });

  it('runs filter-only searches, disables role before a query, and opens a focused hit', async () => {
    const api = backend(
      response({
        results: [hit()],
        scannedSessions: 1,
      }),
    );
    const onSelect = vi.fn();
    const focus = vi.fn();
    window.addEventListener('adham:session-focus-message', focus);
    renderPanel({ backend: api, onSelectSession: onSelect });

    fireEvent.click(screen.getByRole('button', { name: 'Filters' }));
    expect((screen.getByRole('combobox', { name: 'Role' }) as HTMLSelectElement).disabled).toBe(
      true,
    );
    fireEvent.click(screen.getByRole('checkbox', { name: 'Pinned only' }));
    await waitFor(() => expect(api.searchHistory).toHaveBeenCalledTimes(1));
    expect(api.searchHistory).toHaveBeenCalledWith(
      'ws-1',
      'proj-1',
      expect.objectContaining({
        query: '',
        filters: expect.objectContaining({ pinnedOnly: true }),
      }),
    );
    await waitFor(() => expect(screen.getByText('Message')).toBeDefined());
    expect(screen.getByText('a needle in the saved text')).toBeDefined();
    fireEvent.click(screen.getByText('History row'));
    expect(onSelect).toHaveBeenCalledWith('sess-1');
    expect(focus).toHaveBeenCalledTimes(1);
    const focusEvent = focus.mock.calls[0]?.[0] as CustomEvent | undefined;
    expect(focusEvent?.detail).toEqual({
      workspaceId: 'ws-1',
      projectId: 'proj-1',
      sessionId: 'sess-1',
      messageId: 'msg-1',
    });
    window.removeEventListener('adham:session-focus-message', focus);
  });

  it('reports archived filtering, unreadable skips, scan limits, and truncation', async () => {
    const api = backend(
      response({
        results: [hit({ matchKind: 'bookmark', snippet: null })],
        skippedUnreadable: 2,
        scanLimitReached: true,
        truncated: true,
      }),
    );
    const onIncludeArchivedChange = vi.fn();
    renderPanel({ backend: api, onIncludeArchivedChange });

    fireEvent.click(screen.getByRole('button', { name: 'Filters' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Show archived' }));
    expect(onIncludeArchivedChange).toHaveBeenCalledWith(true);

    fireEvent.change(screen.getByRole('textbox', { name: 'Search sessions and messages' }), {
      target: { value: 'needle' },
    });
    await waitFor(() =>
      expect(
        screen.getByText('Some saved content could not be read and was skipped.'),
      ).toBeDefined(),
    );
    expect(screen.getByText('Search stopped after scanning 10,000 messages.')).toBeDefined();
    expect(screen.getByText('Showing the first 50 results (truncated).')).toBeDefined();
    expect(screen.getByText('Bookmark')).toBeDefined();
  });

  it('shows a search failure and retries it', async () => {
    const api = backend(new Error('SEARCH_FAILED: disk unavailable'));
    api.searchHistory.mockResolvedValueOnce(response({ results: [hit()] }));
    renderPanel({ backend: api });

    fireEvent.change(screen.getByRole('textbox', { name: 'Search sessions and messages' }), {
      target: { value: 'needle' },
    });
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('SEARCH_FAILED'));
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(api.searchHistory).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByText('a needle in the saved text')).toBeDefined());
  });
});
