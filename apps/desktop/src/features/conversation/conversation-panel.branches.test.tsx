import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConversationPanel } from './conversation-panel';
import { fakeBackend, registryProvider, pickRegistryModel } from './conversation-panel-test-utils';

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

/** Reply/Make active live in the card's ⋮ menu; Edit sits beside Copy. */
async function clickMessageMenu(
  user: ReturnType<typeof userEvent.setup>,
  card: HTMLElement,
  item: string,
) {
  await user.click(within(card).getByRole('button', { name: 'More actions' }));
  await user.click(within(card).getByRole('menuitem', { name: item }));
}

describe('ConversationPanel edit branches', () => {
  it('edits a persisted user prompt into a branch and shows the edit lineage', async () => {
    const user = userEvent.setup();
    const backend = fakeBackend();
    const rows: unknown[] = [
      {
        messageId: 'msg-0',
        role: 'user',
        text: 'original prompt',
        createdAt: '2026-10-09T00:00:00Z',
        sourceEventId: 'evt-0',
      },
      {
        messageId: 'msg-a',
        role: 'assistant',
        text: 'first answer',
        createdAt: '2026-10-09T00:00:01Z',
        sourceEventId: 'evt-a',
        completion: { Completed: { truncated: false } },
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
      // The persisted branch becomes visible on the terminal reload, exactly
      // like the real projection.
      rows.push({
        messageId: 'msg-branch',
        role: 'user',
        text: 'edited prompt',
        createdAt: '2026-10-09T00:00:02Z',
        sourceEventId: 'evt-b',
        reference: { refersToMessageId: 'msg-0', relation: 'edited-from' },
      });
      onEvent({ opId: 'op-1', sequence: 0, event: { type: 'started' } });
      onEvent({
        opId: 'op-1',
        sequence: 1,
        event: { type: 'completed', completion: 'completed', truncated: false, usage: null },
      });
      return { opId: 'op-1', messageId: 'msg-branch', context: null };
    });
    backend.stopCompletion = vi.fn(async () => ({ opId: 'op-1', status: 'cancelled' }));
    render(<ConversationPanel backend={backend} provider={registryProvider()} />);

    await pickRegistryModel(user);
    await screen.findByText('original prompt');

    // Edit rewrites a prompt — user-only, and visible beside Copy. The
    // assistant row still offers Reply.
    const userCard = screen.getByRole('article', { name: 'You' });
    const assistantCard = screen.getByRole('article', { name: 'Assistant' });
    expect(within(userCard).getByRole('button', { name: 'Edit' })).toBeDefined();
    expect(within(assistantCard).queryByRole('button', { name: 'Edit' })).toBeNull();
    await user.click(within(userCard).getByRole('button', { name: 'Edit' }));

    await user.click(within(assistantCard).getByRole('button', { name: 'More actions' }));
    expect(within(assistantCard).getByRole('menuitem', { name: 'Reply' })).toBeDefined();
    // Close the assistant menu before the composer takes the interaction.
    await user.keyboard('{Escape}');
    const box = (await screen.findByRole('textbox', {
      name: /composer input/i,
    })) as HTMLTextAreaElement;
    // Edit prefills the original text and states the pending edit.
    expect(box.value).toBe('original prompt');
    expect(screen.getByRole('button', { name: 'Cancel edit' })).toBeDefined();

    await user.clear(box);
    await user.type(box, 'edited prompt');
    await user.keyboard('{Enter}');

    await waitFor(() => expect(payloads).toHaveLength(1));
    expect(payloads[0]).toEqual({
      accountId: 'acc-1',
      modelId: 'qwen2.5:latest',
      text: 'edited prompt',
      mode: 'plan',
      reference: { refersToMessageId: 'msg-0', relation: 'edited-from' },
    });
    // Acknowledged: the chip is consumed, and the persisted branch renders its
    // lineage ("Edited from"), not a reply quote.
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Cancel edit' })).toBeNull());
    await screen.findByText('edited prompt');
    expect(screen.getByText('Edited from')).toBeDefined();
    expect(screen.queryByText('Replying to')).toBeNull();
  });

  it('cancels an edit by restoring the draft it displaced', async () => {
    const user = userEvent.setup();
    const backend = fakeBackend();
    render(<ConversationPanel backend={backend} provider={registryProvider()} />);

    await screen.findByText('earlier truth');
    const box = (await screen.findByRole('textbox', {
      name: /composer input/i,
    })) as HTMLTextAreaElement;
    await user.type(box, 'draft in progress');

    const userCard = screen.getByRole('article', { name: 'You' });
    await user.click(within(userCard).getByRole('button', { name: 'Edit' }));
    expect(box.value).toBe('earlier truth');

    await user.click(screen.getByRole('button', { name: 'Cancel edit' }));
    // The displaced draft comes back; nothing was sent.
    expect(screen.queryByRole('button', { name: 'Cancel edit' })).toBeNull();
    expect(box.value).toBe('draft in progress');
    expect(backend.submitMessage).not.toHaveBeenCalled();
  });

  it('refuses an edit without a resolved model instead of dropping the lineage', async () => {
    const user = userEvent.setup();
    const backend = fakeBackend();
    backend.completeOnceStreaming = vi.fn();
    render(<ConversationPanel backend={backend} provider={registryProvider()} />);

    await screen.findByText('earlier truth');
    const userCard = screen.getByRole('article', { name: 'You' });
    await user.click(within(userCard).getByRole('button', { name: 'Edit' }));
    const box = (await screen.findByRole('textbox', {
      name: /composer input/i,
    })) as HTMLTextAreaElement;
    // The prefilled text is what a retry would send: Enter from the composer.
    await user.click(box);
    await user.keyboard('{Enter}');

    // The refusal is stated; nothing was sent (not even text-only), and both
    // the edited text and the lineage stay for a retry.
    expect(await screen.findByText('Select a model to send the edited prompt.')).toBeDefined();
    expect(backend.completeOnceStreaming).not.toHaveBeenCalled();
    expect(backend.submitMessage).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Cancel edit' })).toBeDefined();
    expect(box.value).toBe('earlier truth');
  });

  it('labels an edited branch, marks the newest edit active, and switches on demand', async () => {
    const user = userEvent.setup();
    const backend = fakeBackend();
    backend.getConversation = vi.fn().mockResolvedValue({
      items: [
        {
          messageId: 'msg-0',
          role: 'user',
          text: 'original prompt',
          createdAt: '2026-10-09T00:00:00Z',
          sourceEventId: 'evt-0',
          completion: null,
          reference: null,
        },
        {
          messageId: 'msg-branch',
          role: 'user',
          text: 'edited prompt',
          createdAt: '2026-10-09T00:00:02Z',
          sourceEventId: 'evt-b',
          completion: null,
          reference: { refersToMessageId: 'msg-0', relation: 'edited-from' },
        },
      ],
      nextCursor: null,
      projectionPosition: '2',
      branchSelections: [],
    });
    backend.setActiveAlternative = vi
      .fn()
      .mockResolvedValue([{ rootMessageId: 'msg-0', activeMessageId: 'msg-0' }]);
    render(<ConversationPanel backend={backend} provider={registryProvider()} />);

    const userCards = await screen.findAllByRole('article', { name: 'You' });
    // The quote block in the edited card repeats the original text, so the
    // cards are located by role and row order, not by text.
    const originalCard = userCards[0] as HTMLElement;
    const editedCard = userCards[1] as HTMLElement;
    // Default rule, the same one the backend applies: the newest edit is the
    // branch the session continues from.
    expect(within(editedCard).getByText('Active')).toBeDefined();
    await user.click(within(editedCard).getByRole('button', { name: 'More actions' }));
    expect(within(editedCard).queryByRole('menuitem', { name: 'Make active' })).toBeNull();
    await user.keyboard('{Escape}');

    await clickMessageMenu(user, originalCard, 'Make active');

    // The switch goes to the server with the branch root; the chips follow the
    // response, never an optimistic guess.
    expect(backend.setActiveAlternative).toHaveBeenCalledWith(
      'ws-1',
      'proj-1',
      'sess-1',
      'msg-0',
      'msg-0',
    );
    await waitFor(() => expect(within(originalCard).getByText('Active')).toBeDefined());
    await user.click(within(editedCard).getByRole('button', { name: 'More actions' }));
    expect(within(editedCard).getByRole('menuitem', { name: 'Make active' })).toBeDefined();
    await user.keyboard('{Escape}');
  });

  it('shows the persisted selection on load and surfaces a refused switch', async () => {
    const user = userEvent.setup();
    const backend = fakeBackend();
    backend.getConversation = vi.fn().mockResolvedValue({
      items: [
        {
          messageId: 'msg-0',
          role: 'user',
          text: 'original prompt',
          createdAt: '2026-10-09T00:00:00Z',
          sourceEventId: 'evt-0',
          completion: null,
          reference: null,
        },
        {
          messageId: 'msg-branch',
          role: 'user',
          text: 'edited prompt',
          createdAt: '2026-10-09T00:00:02Z',
          sourceEventId: 'evt-b',
          completion: null,
          reference: { refersToMessageId: 'msg-0', relation: 'edited-from' },
        },
      ],
      nextCursor: null,
      projectionPosition: '2',
      branchSelections: [{ rootMessageId: 'msg-0', activeMessageId: 'msg-0' }],
    });
    backend.setActiveAlternative = vi
      .fn()
      .mockRejectedValue(new Error('selection refused by the server'));
    render(<ConversationPanel backend={backend} provider={registryProvider()} />);

    // The persisted selection, not the default, drives the labels.
    const userCards = await screen.findAllByRole('article', { name: 'You' });
    const originalCard = userCards[0] as HTMLElement;
    const editedCard = userCards[1] as HTMLElement;
    expect(within(originalCard).getByText('Active')).toBeDefined();

    await clickMessageMenu(user, editedCard, 'Make active');

    // A refusal is stated and nothing flips: the chips still show the stored
    // selection.
    expect(await screen.findByText('selection refused by the server')).toBeDefined();
    expect(within(originalCard).getByText('Active')).toBeDefined();
    await user.click(within(editedCard).getByRole('button', { name: 'More actions' }));
    expect(within(editedCard).getByRole('menuitem', { name: 'Make active' })).toBeDefined();
    await user.keyboard('{Escape}');
  });
});
