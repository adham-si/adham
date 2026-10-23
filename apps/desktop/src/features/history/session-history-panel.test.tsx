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

  it('keeps the same layout contract for long/short, pinned/unpinned, and active/inactive rows', () => {
    const longSummary =
      'Alpha — a long mixed العربية English summary that must stay clamped without changing the stored text.';
    const longSession = {
      id: 'sess-long',
      title: 'Alpha — العربية English title',
      updatedAt: '2026-10-22T10:00:00Z',
      summary: longSummary,
      pinned: true,
      archived: false,
    };
    const shortSession = {
      id: 'sess-short',
      title: 'djfh',
      updatedAt: '2026-10-22T09:00:00Z',
      summary: 'short',
      pinned: false,
      archived: false,
    };
    renderPanel({
      sessions: [longSession, shortSession],
      activeSessionId: shortSession.id,
      onRenameSession: vi.fn(),
    });

    const longButton = screen.getByText(longSession.title).closest('button');
    const shortButton = screen.getByText(shortSession.title).closest('button');
    if (!longButton || !shortButton) throw new Error('session row buttons were not rendered');

    for (const button of [longButton, shortButton]) {
      for (const className of [
        'w-full',
        'h-22',
        'font-normal',
        'items-start',
        'overflow-hidden',
        'ps-3',
        'pe-8',
        'rtl:text-right',
        'ltr:text-left',
      ]) {
        expect(button.classList.contains(className)).toBe(true);
      }
      expect(button.className).not.toContain('font-medium');
      expect(button.querySelector('svg')).toBeNull();
    }
    expect(shortButton.classList.contains('bg-selection')).toBe(true);
    expect(longButton.classList.contains('bg-selection')).toBe(false);

    expect(screen.getByText(longSession.title).getAttribute('dir')).toBe('auto');
    expect(screen.getByText(longSummary).getAttribute('dir')).toBe('auto');
    expect(screen.getByText(longSummary).classList.contains('line-clamp-2')).toBe(true);
    expect(screen.getByText(longSummary).classList.contains('break-words')).toBe(true);
    expect(screen.getByText(longSummary).textContent).toBe(longSummary);

    const triggers = screen.getAllByRole('button', { name: 'Session actions' });
    expect(triggers).toHaveLength(2);
    for (const trigger of triggers) {
      expect(trigger.classList.contains('size-6')).toBe(true);
      expect(trigger.classList.contains('end-2')).toBe(true);
      expect(trigger.classList.contains('top-2')).toBe(true);
    }
  });

  it('shows attachment text as the match source and distinguishes a filename-only hit', async () => {
    const attachmentSnippet = 'ADHAM_ATTACHMENT_SEARCH_CANARY_7f3a9c — synthetic attachment text';
    const api = backend(
      response({
        results: [
          hit({
            matchKind: 'attachment',
            messageId: 'msg-content',
            snippet: attachmentSnippet,
            attachmentName: 'adham-attachment-search-canary.txt',
          }),
          hit({
            matchKind: 'attachment',
            messageId: 'msg-name',
            snippet: null,
            attachmentName: 'filename-only.txt',
          }),
        ],
      }),
    );
    renderPanel({ backend: api });
    fireEvent.change(screen.getByRole('textbox', { name: 'Search sessions and messages' }), {
      target: { value: 'ADHAM_ATTACHMENT_SEARCH_CANARY_7f3a9c' },
    });

    const textSource = await screen.findByText('Attachment text');
    expect(screen.getByText('Attachment file name')).toBeDefined();
    expect(screen.getByText(attachmentSnippet)).toBeDefined();
    expect(screen.getByText('adham-attachment-search-canary.txt').getAttribute('title')).toBe(
      'adham-attachment-search-canary.txt',
    );
    expect(screen.getByText('filename-only.txt').getAttribute('title')).toBe('filename-only.txt');
    const row = textSource.closest('button');
    if (!row) throw new Error('attachment row button was not rendered');
    expect(row.classList.contains('h-22')).toBe(true);
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

    const filtersButton = screen.getByRole('button', { name: 'Filters' });
    expect(filtersButton.getAttribute('aria-expanded')).toBe('false');
    expect(filtersButton.classList.contains('size-7')).toBe(true);
    expect(filtersButton.textContent).toBe('');
    expect(screen.queryByRole('checkbox', { name: 'Show archived' })).toBeNull();
    fireEvent.click(filtersButton);
    expect(filtersButton.getAttribute('aria-expanded')).toBe('true');
    for (const name of ['Show archived', 'Pinned only', 'Bookmarked only', 'Has attachments']) {
      expect(screen.getByRole('checkbox', { name })).toBeDefined();
    }
    expect((screen.getByRole('combobox', { name: 'Role' }) as HTMLSelectElement).disabled).toBe(
      true,
    );
    expect(screen.getByLabelText('From')).toBeDefined();
    expect(screen.getByLabelText('To')).toBeDefined();
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

  it('clears and disables the role filter when the query empties', async () => {
    const api = backend(response());
    renderPanel({ backend: api });

    const input = screen.getByRole('textbox', { name: 'Search sessions and messages' });
    fireEvent.change(input, { target: { value: 'needle' } });
    fireEvent.click(screen.getByRole('button', { name: 'Filters' }));
    const role = screen.getByRole('combobox', { name: 'Role' }) as HTMLSelectElement;
    expect(role.disabled).toBe(false);
    fireEvent.change(role, { target: { value: 'user' } });
    await waitFor(() =>
      expect(api.searchHistory).toHaveBeenCalledWith(
        'ws-1',
        'proj-1',
        expect.objectContaining({
          filters: expect.objectContaining({ role: 'user' }),
        }),
      ),
    );

    fireEvent.change(input, { target: { value: '' } });
    await waitFor(() => expect(role.value).toBe(''));
    expect(role.disabled).toBe(true);
    expect(screen.getByText(/Not available yet:/)).toBeDefined();
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
