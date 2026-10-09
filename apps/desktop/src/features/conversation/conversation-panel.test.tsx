import { describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConversationPanel } from './conversation-panel';

function fakeBackend() {
  return {
    getBootstrapState: vi.fn().mockResolvedValue({
      isInitialized: true,
      activeWorkspaceId: 'ws-1',
      activeProjectId: 'proj-1',
    }),
    createSession: vi.fn().mockResolvedValue({
      sessionId: 'sess-1',
      projectId: 'proj-1',
      title: null,
      createdAt: '2026-10-09T00:00:00Z',
    }),
    submitMessage: vi.fn().mockResolvedValue({
      messageId: 'msg-1',
      sessionId: 'sess-1',
      text: 'hello backend',
      createdAt: '2026-10-09T00:00:01Z',
      streamSequence: '1',
      projectionPosition: '1',
    }),
    getConversation: vi.fn().mockResolvedValue({
      items: [
        {
          messageId: 'msg-0',
          role: 'user',
          text: 'earlier truth',
          createdAt: '2026-10-09T00:00:00Z',
          sourceEventId: 'evt-0',
        },
      ],
      nextCursor: null,
      projectionPosition: '1',
    }),
  };
}

describe('ConversationPanel', () => {
  it('shows backend history without any simulated agent text', async () => {
    render(<ConversationPanel backend={fakeBackend()} />);

    await waitFor(() => expect(screen.getByText('earlier truth')).toBeDefined());
    expect(screen.queryByText(/Analyzing prompt/i)).toBeNull();
    expect(screen.queryByText(/Verified sandbox execution/i)).toBeNull();
  });

  it('submits text and shows the backend-issued message while clearing the draft', async () => {
    const user = userEvent.setup();
    const backend = fakeBackend();
    backend.getConversation.mockResolvedValueOnce({
      items: [],
      nextCursor: null,
      projectionPosition: '0',
    });
    render(<ConversationPanel backend={backend} />);
    await waitFor(() => expect(backend.createSession).toHaveBeenCalled());

    const box = screen.getByRole('textbox', { name: /composer input/i });
    await user.type(box, 'hello backend');
    await user.keyboard('{Enter}');

    await waitFor(() => expect(screen.getByText('hello backend')).toBeDefined());
    expect(backend.submitMessage).toHaveBeenCalledTimes(1);
    expect((box as HTMLTextAreaElement).value).toBe('');
  });

  it('retains the draft and reports truthfully when submission fails', async () => {
    const user = userEvent.setup();
    const backend = fakeBackend();
    backend.getConversation.mockResolvedValueOnce({
      items: [],
      nextCursor: null,
      projectionPosition: '0',
    });
    backend.submitMessage.mockRejectedValueOnce(new Error('IPC offline'));
    render(<ConversationPanel backend={backend} />);
    await waitFor(() => expect(backend.createSession).toHaveBeenCalled());

    const box = screen.getByRole('textbox', { name: /composer input/i }) as HTMLTextAreaElement;
    await user.type(box, 'unsaved words');
    await user.keyboard('{Enter}');

    await waitFor(() => expect(screen.getByText(/IPC offline/i)).toBeDefined());
    expect(box.value).toBe('unsaved words');
    expect(backend.submitMessage).toHaveBeenCalledTimes(1);
  });

  it('marks execution unavailable in execute mode without any approval flow', async () => {
    const user = userEvent.setup();
    const backend = fakeBackend();
    render(<ConversationPanel backend={backend} />);
    await waitFor(() => expect(backend.createSession).toHaveBeenCalled());

    expect(screen.queryByText(/execution.*unavailable|unavailable.*execution/i)).toBeNull();
    // Switch to execute mode via the mode radiogroup.
    await user.click(screen.getByRole('radio', { name: /execute/i }));

    expect(screen.getByText(/execution.*unavailable|unavailable.*execution/i)).toBeDefined();
    expect(screen.queryByText(/Verified sandbox execution/i)).toBeNull();
  });

  it('never renders a Stop button because no stop command exists', async () => {
    const backend = fakeBackend();
    render(<ConversationPanel backend={backend} />);
    await waitFor(() => expect(backend.createSession).toHaveBeenCalled());

    expect(screen.queryByRole('button', { name: /stop generation/i })).toBeNull();
  });

  it('discloses that pasted attachments are not transmitted', async () => {
    const user = userEvent.setup();
    const backend = fakeBackend();
    render(<ConversationPanel backend={backend} />);
    await waitFor(() => expect(backend.createSession).toHaveBeenCalled());

    const box = screen.getByRole('textbox', { name: /composer input/i });
    await user.click(box);
    await user.paste('A'.repeat(2500));

    expect(screen.getByText(/will not be sent/i)).toBeDefined();
  });

  it('reloads history from the error banner without resubmitting', async () => {
    const user = userEvent.setup();
    const backend = fakeBackend();
    backend.getConversation.mockResolvedValueOnce({
      items: [],
      nextCursor: null,
      projectionPosition: '0',
    });
    backend.submitMessage.mockRejectedValueOnce(new Error('IPC offline'));
    render(<ConversationPanel backend={backend} />);
    await waitFor(() => expect(backend.createSession).toHaveBeenCalled());

    const box = screen.getByRole('textbox', { name: /composer input/i });
    await user.type(box, 'unsaved words');
    await user.keyboard('{Enter}');
    await waitFor(() => expect(screen.getByText(/IPC offline/i)).toBeDefined());

    backend.getConversation.mockResolvedValueOnce({
      items: [
        {
          messageId: 'msg-found',
          role: 'user',
          text: 'already saved',
          createdAt: '2026-10-09T00:00:03Z',
          sourceEventId: 'evt-9',
        },
      ],
      nextCursor: null,
      projectionPosition: '2',
    });
    await user.click(screen.getByRole('button', { name: /reload history/i }));

    await waitFor(() => expect(screen.getByText('already saved')).toBeDefined());
    expect(backend.submitMessage).toHaveBeenCalledTimes(1);
  });

  it('keeps text typed before the session is ready', async () => {
    const user = userEvent.setup();
    const backend = fakeBackend();
    let resolveBootstrap!: () => void;
    backend.getBootstrapState.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveBootstrap = () =>
            resolve({
              isInitialized: true,
              activeWorkspaceId: 'ws-1',
              activeProjectId: 'proj-1',
            });
        }),
    );
    render(<ConversationPanel backend={backend} />);

    const box = screen.getByRole('textbox', {
      name: /composer input/i,
    }) as HTMLTextAreaElement;
    await user.type(box, 'early thought');
    await act(async () => {
      resolveBootstrap();
    });
    await waitFor(() => expect(backend.createSession).toHaveBeenCalled());

    expect(box.value).toBe('early thought');
  });
});
