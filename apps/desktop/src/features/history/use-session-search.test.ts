import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { SessionSearchResponse } from '@adham/contracts-generated';
import {
  EMPTY_SEARCH_FILTERS,
  hasActiveSearchFilter,
  useSessionSearch,
  type SessionSearchBackend,
  type SessionSearchFilters,
} from './use-session-search';

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

function filters(overrides: Partial<SessionSearchFilters> = {}): SessionSearchFilters {
  return { ...EMPTY_SEARCH_FILTERS, ...overrides };
}

function backend(): SessionSearchBackend & {
  searchHistory: ReturnType<typeof vi.fn>;
} {
  return {
    searchHistory: vi.fn().mockResolvedValue(response()),
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('useSessionSearch', () => {
  it('debounces and sends the current query and filters', async () => {
    const api = backend();
    const { rerender } = renderHook(
      ({ query, value }) =>
        useSessionSearch({
          backend: api,
          workspaceId: 'ws-1',
          projectId: 'proj-1',
          query,
          filters: value,
        }),
      { initialProps: { query: 'fi', value: filters() } },
    );

    await waitFor(() => expect(api.searchHistory).toHaveBeenCalledTimes(1));
    expect(api.searchHistory).toHaveBeenCalledWith('ws-1', 'proj-1', {
      query: 'fi',
      filters: {
        includeArchived: false,
        pinnedOnly: false,
        bookmarkedOnly: false,
        role: null,
        hasAttachments: false,
        from: null,
        to: null,
      },
    });

    rerender({ query: 'final', value: filters({ pinnedOnly: true }) });
    await waitFor(() => expect(api.searchHistory).toHaveBeenCalledTimes(2));
    expect(api.searchHistory).toHaveBeenLastCalledWith('ws-1', 'proj-1', {
      query: 'final',
      filters: {
        includeArchived: false,
        pinnedOnly: true,
        bookmarkedOnly: false,
        role: null,
        hasAttachments: false,
        from: null,
        to: null,
      },
    });
  });

  it('skips empty queries with no filter but runs filter-only bookmark searches', async () => {
    const api = backend();
    const { rerender } = renderHook(
      ({ value }) =>
        useSessionSearch({
          backend: api,
          workspaceId: 'ws-1',
          projectId: 'proj-1',
          query: '',
          filters: value,
        }),
      { initialProps: { value: filters() } },
    );

    await act(async () => {
      await Promise.resolve();
    });
    expect(api.searchHistory).not.toHaveBeenCalled();

    rerender({ value: filters({ bookmarkedOnly: true }) });
    await waitFor(() => expect(api.searchHistory).toHaveBeenCalledTimes(1));
    expect(api.searchHistory).toHaveBeenCalledWith(
      'ws-1',
      'proj-1',
      expect.objectContaining({
        query: '',
        filters: expect.objectContaining({ bookmarkedOnly: true }),
      }),
    );
  });

  it('ignores a stale response that resolves after a newer request', async () => {
    const first = deferred<SessionSearchResponse>();
    const second = deferred<SessionSearchResponse>();
    const api = backend();
    api.searchHistory.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);

    const { rerender, result } = renderHook(
      ({ query }) =>
        useSessionSearch({
          backend: api,
          workspaceId: 'ws-1',
          projectId: 'proj-1',
          query,
          filters: filters(),
        }),
      { initialProps: { query: 'first' } },
    );
    await waitFor(() => expect(api.searchHistory).toHaveBeenCalledTimes(1));

    rerender({ query: 'second' });
    await waitFor(() => expect(api.searchHistory).toHaveBeenCalledTimes(2));

    await act(async () => {
      second.resolve(
        response({
          results: [
            {
              sessionId: 'sess-2',
              title: 'Second',
              summary: null,
              summaryOrigin: null,
              lastActivityAt: '2026-10-22T00:00:00Z',
              matchKind: 'message',
              messageId: 'msg-2',
              role: 'user',
              snippet: 'second hit',
              attachmentName: null,
            },
          ],
        }),
      );
      await second.promise;
    });
    await waitFor(() => expect(result.current.results[0]?.sessionId).toBe('sess-2'));

    await act(async () => {
      first.resolve(
        response({
          results: [
            {
              sessionId: 'sess-1',
              title: 'First',
              summary: null,
              summaryOrigin: null,
              lastActivityAt: '2026-10-21T00:00:00Z',
              matchKind: 'message',
              messageId: 'msg-1',
              role: 'user',
              snippet: 'first hit',
              attachmentName: null,
            },
          ],
        }),
      );
      await first.promise;
    });
    expect(result.current.results[0]?.sessionId).toBe('sess-2');
  });

  it('reports the error and retries the same request', async () => {
    const api = backend();
    api.searchHistory.mockRejectedValueOnce(new Error('SEARCH_FAILED: disk unavailable'));
    const { result } = renderHook(() =>
      useSessionSearch({
        backend: api,
        workspaceId: 'ws-1',
        projectId: 'proj-1',
        query: 'needle',
        filters: filters(),
      }),
    );

    await waitFor(() => expect(result.current.error).toContain('SEARCH_FAILED'));
    act(() => result.current.retry());
    await waitFor(() => expect(api.searchHistory).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.error).toBeNull());
  });

  it('recognizes only non-archive filters as active', () => {
    expect(hasActiveSearchFilter(filters({ includeArchived: true }))).toBe(false);
    expect(hasActiveSearchFilter(filters({ pinnedOnly: true }))).toBe(true);
    expect(hasActiveSearchFilter(filters({ bookmarkedOnly: true }))).toBe(true);
    expect(hasActiveSearchFilter(filters({ hasAttachments: true }))).toBe(true);
    expect(hasActiveSearchFilter(filters({ role: 'assistant' }))).toBe(true);
    expect(hasActiveSearchFilter(filters({ from: '2026-10-01T00:00:00Z' }))).toBe(true);
  });
});
