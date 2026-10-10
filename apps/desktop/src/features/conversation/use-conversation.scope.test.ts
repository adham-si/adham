import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useConversation } from './use-conversation';
import { fakeBackend } from './conversation-test-utils';
import { clearSelectIntent, writeSelectIntent } from './conversation-identity';

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
});
