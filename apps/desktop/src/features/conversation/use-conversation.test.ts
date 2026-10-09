import { describe, expect, it, vi } from 'vitest';
import * as React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useConversation } from './use-conversation';
import { submissionNotice } from './submission-notice';

function fakeBackend() {
  return {
    getBootstrapState: vi.fn().mockResolvedValue({
      isInitialized: true,
      activeWorkspaceId: 'ws-1',
      activeProjectId: 'proj-1',
    }),
    createWorkspace: vi.fn(),
    createProject: vi.fn(),
    createSession: vi.fn().mockResolvedValue({
      sessionId: 'sess-1',
      projectId: 'proj-1',
      title: null,
      createdAt: '2026-10-09T00:00:00Z',
    }),
    submitMessage: vi.fn().mockResolvedValue({
      messageId: 'msg-1',
      sessionId: 'sess-1',
      text: 'hello',
      createdAt: '2026-10-09T00:00:01Z',
      streamSequence: '1',
      projectionPosition: '1',
    }),
    getConversation: vi.fn().mockResolvedValue({
      items: [],
      nextCursor: null,
      projectionPosition: '0',
    }),
    getStorageStatus: vi.fn(),
  };
}

describe('useConversation submit', () => {
  it('submits text through the backend and shows the backend-issued message', async () => {
    const backend = fakeBackend();
    const { result } = renderHook(() => useConversation({ backend }));

    await waitFor(() => expect(result.current.status).toBe('ready'));

    let outcome: unknown;
    await act(async () => {
      outcome = await result.current.submit('hello');
    });

    expect(backend.submitMessage).toHaveBeenCalledTimes(1);
    expect(outcome).toEqual({ ok: true });
    expect(result.current.messages).toEqual([
      expect.objectContaining({ id: 'msg-1', text: 'hello' }),
    ]);
  });

  it('reports failure without throwing so the caller can retain the draft', async () => {
    const backend = fakeBackend();
    backend.submitMessage.mockRejectedValueOnce(new Error('IPC offline'));
    const { result } = renderHook(() => useConversation({ backend }));

    await waitFor(() => expect(result.current.status).toBe('ready'));

    let outcome: unknown;
    await act(async () => {
      outcome = await result.current.submit('hello');
    });

    expect(outcome).toEqual({ ok: false, error: 'IPC offline' });
    expect(backend.submitMessage).toHaveBeenCalledTimes(1);
    expect(result.current.messages).toEqual([]);
    expect(result.current.status).toBe('error');
  });

  it('creates the session once when mounted under StrictMode replay', async () => {
    const backend = fakeBackend();
    const { result } = renderHook(() => useConversation({ backend }), {
      wrapper: ({ children }) => React.createElement(React.StrictMode, null, children),
    });

    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(backend.createSession).toHaveBeenCalledTimes(1);
  });

  it('provisions nothing and reports unavailable when bootstrap has no context', async () => {
    const backend = fakeBackend();
    backend.getBootstrapState.mockResolvedValueOnce({
      isInitialized: false,
      activeWorkspaceId: null,
      activeProjectId: null,
    });
    const { result } = renderHook(() => useConversation({ backend }));

    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(backend.createSession).not.toHaveBeenCalled();
    expect(backend.createWorkspace).not.toHaveBeenCalled();
    expect(backend.createProject).not.toHaveBeenCalled();
    expect(result.current.sessionId).toBeNull();
  });

  it('retries history load without creating a second session', async () => {
    const backend = fakeBackend();
    backend.getConversation
      .mockRejectedValueOnce(new Error('history unavailable'))
      .mockResolvedValueOnce({ items: [], nextCursor: null, projectionPosition: '1' });
    const { result } = renderHook(() => useConversation({ backend }));

    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(backend.createSession).toHaveBeenCalledTimes(1);

    await act(async () => {
      await result.current.retry();
    });

    expect(backend.createSession).toHaveBeenCalledTimes(1);
    expect(backend.getConversation).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(result.current.status).toBe('ready'));
  });

  it('ignores a late submit response after the session changes', async () => {
    const backend = fakeBackend();
    let resolveSubmit!: (value: unknown) => void;
    backend.submitMessage.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveSubmit = resolve;
        }),
    );
    const { result } = renderHook(() => useConversation({ backend }));
    await waitFor(() => expect(result.current.status).toBe('ready'));

    let outcome: unknown;
    let submitPromise: Promise<unknown>;
    await act(async () => {
      submitPromise = result.current.submit('hello');
    });
    await act(async () => {
      await result.current.openSession('sess-2');
    });
    await act(async () => {
      resolveSubmit({
        messageId: 'msg-late',
        sessionId: 'sess-1',
        text: 'hello',
        createdAt: '2026-10-09T00:00:01Z',
        streamSequence: '1',
        projectionPosition: '1',
      });
      outcome = await submitPromise;
    });

    expect(outcome).toEqual({ ok: false, error: 'Session changed while sending.' });
    expect(result.current.messages).toEqual([]);
  });
});

describe('conversation capabilities', () => {
  it('reports execution and stop as unsupported by the backend', async () => {
    const backend = fakeBackend();
    const { result } = renderHook(() => useConversation({ backend }));
    await waitFor(() => expect(result.current.status).toBe('ready'));

    expect(result.current.capabilities).toEqual({
      submitMessage: true,
      execution: false,
      stop: false,
    });
  });
});

describe('submissionNotice', () => {
  it('returns null for a plain text submission', () => {
    expect(submissionNotice({ attachmentCount: 0, hasCustomSettings: false })).toBeNull();
  });

  it('warns that attachments are not transmitted', () => {
    expect(submissionNotice({ attachmentCount: 2, hasCustomSettings: false })).toMatch(
      /attachment/i,
    );
  });

  it('warns that model and scope settings are not applied', () => {
    expect(submissionNotice({ attachmentCount: 0, hasCustomSettings: true })).toMatch(
      /not applied|not sent/i,
    );
  });
});

describe('useConversation reload', () => {
  it('refreshes history without resubmitting anything', async () => {
    const backend = fakeBackend();
    const { result } = renderHook(() => useConversation({ backend }));
    await waitFor(() => expect(result.current.status).toBe('ready'));

    backend.getConversation.mockResolvedValueOnce({
      items: [
        {
          messageId: 'msg-9',
          role: 'user',
          text: 'reloaded',
          createdAt: '2026-10-09T00:00:02Z',
          sourceEventId: 'evt-9',
        },
      ],
      nextCursor: null,
      projectionPosition: '2',
    });

    await act(async () => {
      await result.current.reload();
    });

    expect(backend.submitMessage).not.toHaveBeenCalled();
    expect(result.current.messages).toEqual([
      expect.objectContaining({ id: 'msg-9', text: 'reloaded' }),
    ]);
  });
});
