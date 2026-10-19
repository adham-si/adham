import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { CompletionStartDto } from '@adham/contracts-generated';
import type { StreamEventParam } from './conversation-test-utils';
import { ConversationPanel } from './conversation-panel';
import { fakeBackend, registryProvider, pickRegistryModel } from './conversation-panel-test-utils';

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

describe('ConversationPanel retries and replies', () => {
  it('retries the failed turn as a new attempt without resending the user message', async () => {
    const user = userEvent.setup();
    const backend = fakeBackend();
    const rows: unknown[] = [
      {
        messageId: 'msg-user-1',
        role: 'user',
        text: 'retry me please',
        createdAt: '2026-10-09T00:00:00Z',
        sourceEventId: 'evt-u1',
      },
      {
        messageId: 'msg-failed-1',
        role: 'assistant',
        text: 'no answer was produced',
        createdAt: '2026-10-09T00:00:01Z',
        sourceEventId: 'evt-f1',
        completion: 'Failed',
      },
    ];
    backend.getConversation = vi.fn(async () => ({
      items: [...rows],
      nextCursor: null,
      projectionPosition: `${rows.length}`,
    }));
    const payloads: Array<Record<string, unknown>> = [];
    backend.retryCompletionStreaming = vi.fn(async (_ws, _p, _s, payload, onEvent) => {
      payloads.push(payload as unknown as Record<string, unknown>);
      // The attempt the backend persists is visible on the reload after the
      // terminal, exactly like the real projection.
      rows.push({
        messageId: 'msg-asst-1',
        role: 'assistant',
        text: 'second attempt',
        createdAt: '2026-10-09T00:00:02Z',
        sourceEventId: 'evt-a1',
        completion: { Completed: { truncated: false } },
      });
      onEvent({ opId: 'op-9', sequence: 0, event: { type: 'started' } });
      onEvent({ opId: 'op-9', sequence: 1, event: { type: 'delta', text: 'second attempt' } });
      onEvent({
        opId: 'op-9',
        sequence: 2,
        event: { type: 'completed', completion: 'completed', truncated: false, usage: null },
      });
      return { opId: 'op-9', messageId: 'msg-user-1', context: null };
    });
    backend.stopCompletion = vi.fn(async () => ({ opId: 'op-9', status: 'cancelled' }));
    render(<ConversationPanel backend={backend} provider={registryProvider()} />);

    await pickRegistryModel(user);
    await screen.findByText('no answer was produced');
    await user.click(screen.getByRole('button', { name: 'Retry' }));

    await waitFor(() => expect(payloads).toHaveLength(1));
    expect(payloads[0]).toEqual({
      accountId: 'acc-1',
      modelId: 'qwen2.5:latest',
      replyToMessageId: 'msg-user-1',
      mode: 'plan',
    });
    // The user turn is answered again, never re-sent as a new message.
    expect(backend.submitMessage).not.toHaveBeenCalled();
    expect(backend.completeOnceStreaming).toBeUndefined();
    // The original attempt stays visible with its failure note; the newest
    // attempt is now the completed one, so the offered action is Regenerate.
    await screen.findByText('second attempt');
    expect(screen.getByText('no answer was produced')).toBeDefined();
    expect(screen.getByText(/Generation failed/i)).toBeDefined();
    await screen.findByRole('button', { name: 'Regenerate' });
  });

  it('states why a retry cannot run without a resolved model instead of a silent no-op', async () => {
    const backend = fakeBackend();
    backend.getConversation = vi.fn(async () => ({
      items: [
        {
          messageId: 'msg-user-1',
          role: 'user',
          text: 'retry me please',
          createdAt: '2026-10-09T00:00:00Z',
          sourceEventId: 'evt-u1',
        },
        {
          messageId: 'msg-failed-1',
          role: 'assistant',
          text: 'no answer was produced',
          createdAt: '2026-10-09T00:00:01Z',
          sourceEventId: 'evt-f1',
          completion: 'Failed',
        },
      ],
      nextCursor: null,
      projectionPosition: '2',
    }));
    backend.retryCompletionStreaming = vi.fn();
    backend.stopCompletion = vi.fn();
    render(<ConversationPanel backend={backend} provider={registryProvider()} />);

    await screen.findByText('no answer was produced');
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByText(/Select a model to retry this turn/i)).toBeDefined();
    expect(backend.retryCompletionStreaming).not.toHaveBeenCalled();
  });

  it('sends a reply anchored to the persisted message id and shows the quote', async () => {
    const user = userEvent.setup();
    const backend = fakeBackend();
    const rows: unknown[] = [
      {
        messageId: 'msg-0',
        role: 'user',
        text: 'earlier truth',
        createdAt: '2026-10-09T00:00:00Z',
        sourceEventId: 'evt-0',
      },
      {
        messageId: 'msg-orphan',
        role: 'user',
        text: 'orphan quote',
        createdAt: '2026-10-09T00:00:01Z',
        sourceEventId: 'evt-o',
        reference: { refersToMessageId: 'msg-gone', relation: 'replied' },
      },
    ];
    backend.getConversation = vi.fn(async () => ({
      items: [...rows],
      nextCursor: null,
      projectionPosition: `${rows.length}`,
    }));
    const payloads: Array<Record<string, unknown>> = [];
    backend.completeOnceStreaming = vi.fn(async (_ws, _p, _s, payload, onEvent) => {
      payloads.push(payload as Record<string, unknown>);
      // The persisted reply becomes visible on the terminal reload, exactly
      // like the real projection.
      rows.push({
        messageId: 'msg-reply',
        role: 'user',
        text: 'quoted answer',
        createdAt: '2026-10-09T00:00:02Z',
        sourceEventId: 'evt-r',
        reference: { refersToMessageId: 'msg-0', relation: 'replied' },
      });
      onEvent({ opId: 'op-1', sequence: 0, event: { type: 'started' } });
      onEvent({
        opId: 'op-1',
        sequence: 1,
        event: { type: 'completed', completion: 'completed', truncated: false, usage: null },
      });
      return { opId: 'op-1', messageId: 'msg-reply', context: null };
    });
    backend.stopCompletion = vi.fn(async () => ({ opId: 'op-1', status: 'cancelled' }));
    render(<ConversationPanel backend={backend} provider={registryProvider()} />);

    await pickRegistryModel(user);
    await screen.findByText('earlier truth');
    // A reference whose target is not in the loaded history is stated,
    // never replaced by an invented excerpt.
    expect(screen.getByText('Quoted message is not in the loaded history.')).toBeDefined();

    await user.click(screen.getAllByRole('button', { name: 'Reply' })[0]!);
    expect(screen.getByRole('button', { name: 'Cancel reply' })).toBeDefined();

    const box = (await screen.findByRole('textbox', {
      name: /composer input/i,
    })) as HTMLTextAreaElement;
    await user.type(box, 'quoted answer');
    await user.keyboard('{Enter}');

    await waitFor(() => expect(payloads).toHaveLength(1));
    expect(payloads[0]).toEqual({
      accountId: 'acc-1',
      modelId: 'qwen2.5:latest',
      text: 'quoted answer',
      mode: 'plan',
      reference: { refersToMessageId: 'msg-0', relation: 'replied' },
    });
    // Acknowledged: the pending quote chip is consumed, and the persisted
    // reply renders the quote from loaded history.
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Cancel reply' })).toBeNull());
    await screen.findByText('quoted answer');
    expect(screen.getAllByText('earlier truth').length).toBe(2);
  });

  it('refuses a reply without a resolved model instead of dropping the anchor', async () => {
    const user = userEvent.setup();
    const backend = fakeBackend();
    backend.completeOnceStreaming = vi.fn();
    render(<ConversationPanel backend={backend} provider={registryProvider()} />);

    await screen.findByText('earlier truth');
    await user.click(screen.getByRole('button', { name: 'Reply' }));
    const box = (await screen.findByRole('textbox', {
      name: /composer input/i,
    })) as HTMLTextAreaElement;
    await user.type(box, 'quoted answer');
    await user.keyboard('{Enter}');

    // The refusal is stated; nothing was sent (not even text-only), and both
    // the text and the anchor stay for a retry as a reply.
    expect(await screen.findByText('Select a model to send the reply.')).toBeDefined();
    expect(backend.completeOnceStreaming).not.toHaveBeenCalled();
    expect(backend.submitMessage).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Cancel reply' })).toBeDefined();
    expect(box.value).toBe('quoted answer');
  });

  it('dispatches a queued reply with its anchor when the running turn settles', async () => {
    const user = userEvent.setup();
    const backend = fakeBackend();
    const payloads: Array<Record<string, unknown>> = [];
    let emit: StreamEventParam | null = null;
    let resolveDispatch!: (start: CompletionStartDto) => void;
    backend.completeOnceStreaming = vi.fn((_ws, _p, _s, payload, onEvent) => {
      payloads.push(payload as Record<string, unknown>);
      if (payloads.length === 1) {
        emit = onEvent;
        return new Promise((resolve) => {
          resolveDispatch = resolve;
        });
      }
      onEvent({ opId: 'op-2', sequence: 0, event: { type: 'started' } });
      onEvent({
        opId: 'op-2',
        sequence: 1,
        event: { type: 'completed', completion: 'completed', truncated: false, usage: null },
      });
      return Promise.resolve({ opId: 'op-2', messageId: 'm-2', context: null });
    });
    backend.stopCompletion = vi.fn(async () => ({ opId: 'op-1', status: 'cancelled' }));

    render(<ConversationPanel backend={backend} provider={registryProvider()} />);
    const box = (await screen.findByRole('textbox', {
      name: /composer input/i,
    })) as HTMLTextAreaElement;
    await pickRegistryModel(user);
    await screen.findByText('earlier truth');

    await user.type(box, 'first');
    await user.keyboard('{Enter}');
    await waitFor(() => expect(payloads).toHaveLength(1));

    // A reply clicked during the run is queued as a reply: the queued row says
    // so, and the anchor travels with the instruction.
    await user.click(screen.getByRole('button', { name: 'Reply' }));
    await user.type(box, 'queued reply');
    await user.keyboard('{Enter}');
    expect(await screen.findByText(/^queued$/i)).toBeDefined();
    expect(screen.getByText('Reply', { selector: 'span' })).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Cancel reply' })).toBeNull();

    await act(async () => {
      emit!({
        opId: 'op-1',
        sequence: 1,
        event: { type: 'completed', completion: 'completed', truncated: false, usage: null },
      });
      resolveDispatch({ opId: 'op-1', messageId: 'm-1', context: null });
    });
    await waitFor(() => expect(payloads).toHaveLength(2));
    expect(payloads[1]).toEqual({
      accountId: 'acc-1',
      modelId: 'qwen2.5:latest',
      text: 'queued reply',
      mode: 'plan',
      reference: { refersToMessageId: 'msg-0', relation: 'replied' },
    });
  });

  it('closes a crash-left provider operation through the dedicated recovery command, never a message resend', async () => {
    const backend = fakeBackend();
    const staleOp = {
      operationId: '01a14a4e-912d-728d-9a5b-235e6098ccb0',
      kind: 'provider-completion',
      workspaceId: 'ws-1',
      projectId: 'proj-1',
      sessionId: 'sess-1',
      createRequestId: null,
      messageRequestId: '01a14a4e-9400-728d-9a5b-235e6098ccb1',
      text: '',
      title: null,
      status: 'pending',
      createdAt: '2026-10-17T10:00:00Z',
    };
    backend.listPendingOperations
      .mockResolvedValueOnce({ operations: [staleOp], truncated: false })
      .mockResolvedValueOnce({ operations: [staleOp], truncated: false })
      .mockResolvedValue({ operations: [], truncated: false });

    render(<ConversationPanel backend={backend} />);

    // The message-recovery surface ignores provider handles; the dedicated
    // banner surfaces the stale operation instead.
    expect(await screen.findByText(/Unfinished generation/i)).toBeDefined();
    expect(screen.queryByText(/Review & Resend/i)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /Review/i }));
    fireEvent.click(screen.getByRole('button', { name: /Mark interrupted/i }));

    await waitFor(() => expect(backend.markCompletionInterrupted).toHaveBeenCalledTimes(1));
    expect(backend.markCompletionInterrupted).toHaveBeenCalledWith('ws-1', 'proj-1', 'sess-1', {
      operationId: staleOp.operationId,
      expectedMessageRequestId: staleOp.messageRequestId,
    });
    // Recovery never re-submits the prompt.
    expect(backend.submitMessage).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByText(/Unfinished generation/i)).toBeNull());
  });
});
