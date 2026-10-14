import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useConversation } from './use-conversation';
import { fakeBackend } from './conversation-test-utils';
import { clearSelectIntent, writeSelectIntent } from '../provisioning';

beforeEach(() => {
  sessionStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useConversation scope-change guards', () => {
  it('blocks sending while a scope selection is unresolved', async () => {
    const backend = fakeBackend();
    const { result } = renderHook(() => useConversation({ backend }));
    await waitFor(() => expect(result.current.status).toBe('ready'));

    writeSelectIntent({ requestId: 'req-select-1', workspaceId: 'ws-1', projectId: 'proj-2' });
    let blocked: unknown;
    await act(async () => {
      blocked = await result.current.submit('hello');
    });
    expect(blocked).toEqual({
      ok: false,
      uncertain: false,
      error: expect.stringMatching(/selection.*unknown status/i),
    });
    expect(backend.submitMessage).not.toHaveBeenCalled();

    clearSelectIntent();
    let outcome: unknown;
    await act(async () => {
      outcome = await result.current.submit('hello');
    });
    expect(outcome).toEqual({ ok: true });
    expect(backend.submitMessage).toHaveBeenCalledTimes(1);
  });

  it('discards late history for the previous scope after a scope refresh', async () => {
    const backend = fakeBackend();
    const { result } = renderHook(() => useConversation({ backend }));
    await waitFor(() => expect(result.current.status).toBe('ready'));

    let resolveOld!: (value: unknown) => void;
    backend.getConversation.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveOld = resolve as (value: unknown) => void;
        }),
    );
    backend.getConversation.mockResolvedValueOnce({
      items: [
        {
          messageId: 'msg-new',
          role: 'user',
          text: 'new scope words',
          createdAt: '2026-10-09T00:00:02Z',
          sourceEventId: 'evt-new',
        },
      ],
      nextCursor: null,
      projectionPosition: '2',
    });

    // Old-scope history load starts, then a scope change supersedes it.
    let reloadPromise: Promise<void>;
    await act(async () => {
      reloadPromise = result.current.reload();
    });
    await act(async () => {
      result.current.refreshScope();
    });
    await act(async () => {
      resolveOld({
        items: [
          {
            messageId: 'msg-old',
            role: 'user',
            text: 'old scope words',
            createdAt: '2026-10-09T00:00:01Z',
            sourceEventId: 'evt-old',
          },
        ],
        nextCursor: null,
        projectionPosition: '1',
      });
      await reloadPromise;
    });

    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.messages).toEqual([
      expect.objectContaining({ id: 'msg-new', text: 'new scope words' }),
    ]);
  });

  it('blocks sending while a scope refresh is unresolved', async () => {
    const backend = fakeBackend();
    const { result } = renderHook(() => useConversation({ backend }));
    await waitFor(() => expect(result.current.status).toBe('ready'));

    let resolveBootstrap!: (value: unknown) => void;
    backend.getBootstrapState.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveBootstrap = resolve as (value: unknown) => void;
        }),
    );
    await act(async () => {
      result.current.refreshScope();
    });
    let blocked: unknown;
    await act(async () => {
      blocked = await result.current.submit('hello');
    });
    expect(blocked).toEqual({
      ok: false,
      uncertain: false,
      error: expect.stringMatching(/scope is changing/i),
    });
    expect(backend.submitMessage).not.toHaveBeenCalled();

    await act(async () => {
      resolveBootstrap({
        isInitialized: true,
        activeWorkspaceId: 'ws-1',
        activeProjectId: 'proj-1',
      });
    });
    await waitFor(() => expect(result.current.status).toBe('ready'));
    let outcome: unknown;
    await act(async () => {
      outcome = await result.current.submit('hello');
    });
    expect(outcome).toEqual({ ok: true });
    expect(backend.submitMessage).toHaveBeenCalledTimes(1);
  });

  it('keeps sending blocked after a failed scope refresh until resolve', async () => {
    const backend = fakeBackend();
    const { result } = renderHook(() => useConversation({ backend }));
    await waitFor(() => expect(result.current.status).toBe('ready'));

    backend.getBootstrapState.mockRejectedValueOnce(new Error('read outage'));
    await act(async () => {
      result.current.refreshScope();
    });
    await waitFor(() => expect(result.current.status).toBe('error'));
    let blocked: unknown;
    await act(async () => {
      blocked = await result.current.submit('hello');
    });
    expect(blocked).toEqual({
      ok: false,
      uncertain: false,
      error: expect.stringMatching(/scope is changing/i),
    });
    expect(backend.submitMessage).not.toHaveBeenCalled();

    await act(async () => {
      result.current.refreshScope();
    });
    await waitFor(() => expect(result.current.status).toBe('ready'));
    let outcome: unknown;
    await act(async () => {
      outcome = await result.current.submit('hello');
    });
    expect(outcome).toEqual({ ok: true });
  });

  it('pins authoritative recovery: ready A -> confirmed B -> B bootstrap outage -> reload/retry cannot load retained A or unlock sends to A -> B-only dispatch after recovery', async () => {
    const backend = fakeBackend();
    // Scope A: ws-A, proj-A
    backend.getBootstrapState.mockResolvedValueOnce({
      isInitialized: true,
      activeWorkspaceId: 'ws-A',
      activeProjectId: 'proj-A',
    });
    backend.listSessions.mockResolvedValueOnce({
      sessions: [
        {
          sessionId: 'sess-A',
          title: null,
          createdAt: '2026-10-09T00:00:00Z',
        },
      ],
      truncated: false,
    });
    backend.getConversation.mockImplementation(async (_ws, _proj, sessId) => {
      if (sessId === 'sess-A') {
        return {
          items: [
            {
              messageId: 'msg-A',
              role: 'user',
              text: 'existing A message',
              createdAt: '2026-10-09T00:00:01Z',
              sourceEventId: 'evt-A',
            },
          ],
          nextCursor: null,
          projectionPosition: '1',
        };
      }
      return { items: [], nextCursor: null, projectionPosition: '0' };
    });

    const { result } = renderHook(() => useConversation({ backend }));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.context).toEqual({
      workspaceId: 'ws-A',
      projectId: 'proj-A',
      sessionId: 'sess-A',
    });
    expect(result.current.messages).toHaveLength(1);

    // Now confirmed scope B is announced / refreshed, but B bootstrap experiences an outage
    backend.getBootstrapState.mockRejectedValueOnce(new Error('B bootstrap outage'));
    await act(async () => {
      result.current.refreshScope();
    });
    await waitFor(() => expect(result.current.status).toBe('error'));

    // Verify context A was not retained and sending is blocked
    expect(result.current.context).toBeNull();
    let blocked1: unknown;
    await act(async () => {
      blocked1 = await result.current.submit('send during outage');
    });
    expect(blocked1).toEqual({
      ok: false,
      uncertain: false,
      error: expect.stringMatching(/scope is changing/i),
    });
    expect(backend.submitMessage).not.toHaveBeenCalled();

    // Calling reload() during outage must route to bootstrap (not load retained A history or clear the latch)
    backend.getBootstrapState.mockRejectedValueOnce(new Error('B bootstrap outage on reload'));
    await act(async () => {
      await result.current.reload();
    });
    expect(result.current.status).toBe('error');
    expect(result.current.context).toBeNull();
    let blocked2: unknown;
    await act(async () => {
      blocked2 = await result.current.submit('send after reload');
    });
    expect(blocked2).toEqual({
      ok: false,
      uncertain: false,
      error: expect.stringMatching(/scope is changing/i),
    });
    expect(backend.submitMessage).not.toHaveBeenCalled();

    // Calling retry() during outage must also route to bootstrap (not load retained A session)
    backend.getBootstrapState.mockRejectedValueOnce(new Error('B bootstrap outage on retry'));
    await act(async () => {
      await result.current.retry();
    });
    expect(result.current.status).toBe('error');
    expect(result.current.context).toBeNull();
    let blocked3: unknown;
    await act(async () => {
      blocked3 = await result.current.submit('send after retry');
    });
    expect(blocked3).toEqual({
      ok: false,
      uncertain: false,
      error: expect.stringMatching(/scope is changing/i),
    });
    expect(backend.submitMessage).not.toHaveBeenCalled();

    // Assert ZERO sends to A occurred across all failed/repeated reload/retry attempts
    expect(backend.submitMessage.mock.calls.filter((call) => call[0] === 'ws-A')).toHaveLength(0);

    // Now connectivity returns and B bootstrap succeeds
    backend.getBootstrapState.mockResolvedValueOnce({
      isInitialized: true,
      activeWorkspaceId: 'ws-B',
      activeProjectId: 'proj-B',
    });
    backend.listSessions.mockResolvedValueOnce({
      sessions: [
        {
          sessionId: 'sess-B',
          title: null,
          createdAt: '2026-10-09T00:00:02Z',
        },
      ],
      truncated: false,
    });
    backend.getConversation.mockResolvedValueOnce({
      items: [],
      nextCursor: null,
      projectionPosition: '0',
    });

    await act(async () => {
      await result.current.retry();
    });
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.context).toEqual({
      workspaceId: 'ws-B',
      projectId: 'proj-B',
      sessionId: 'sess-B',
    });

    // Now submit permits ONLY B sends
    backend.submitMessage.mockResolvedValueOnce({
      messageId: 'msg-B1',
      sessionId: 'sess-B',
      text: 'hello B',
      createdAt: '2026-10-09T00:00:03Z',
      streamSequence: '1',
      projectionPosition: '1',
    });
    let outcome: unknown;
    await act(async () => {
      outcome = await result.current.submit('hello B');
    });
    expect(outcome).toEqual({ ok: true });
    expect(backend.submitMessage).toHaveBeenCalledTimes(1);
    expect(backend.submitMessage).toHaveBeenCalledWith(
      'ws-B',
      'proj-B',
      'sess-B',
      { text: 'hello B' },
      expect.objectContaining({ requestId: expect.any(String) }),
    );
    // Absolute guarantee: zero sends ever targeted ws-A
    expect(backend.submitMessage.mock.calls.some((call) => call[0] === 'ws-A')).toBe(false);
  });
});
