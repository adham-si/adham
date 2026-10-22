import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConversationPanel } from './conversation-panel';
import { fakeBackend, registryProvider, pickRegistryModel } from './conversation-panel-test-utils';

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

function historyBackend() {
  const backend = fakeBackend();
  backend.getConversation = vi.fn().mockResolvedValue({
    items: [
      {
        messageId: 'msg-q',
        role: 'user',
        text: 'a question',
        createdAt: '2026-10-09T00:00:00Z',
        sourceEventId: 'evt-q',
        completion: null,
        reference: null,
      },
      {
        messageId: 'msg-a',
        role: 'assistant',
        text: 'an answer',
        createdAt: '2026-10-09T00:00:01Z',
        sourceEventId: 'evt-a',
        completion: { Completed: { truncated: false } },
        reference: null,
      },
    ],
    nextCursor: null,
    projectionPosition: '2',
    branchSelections: [],
    feedback: [],
    bookmarkedMessageIds: ['msg-a'],
  });
  return backend;
}

describe('ConversationPanel message bookmarks', () => {
  it('shows a pressed star on persisted messages and toggles it', async () => {
    const user = userEvent.setup();
    const backend = historyBackend();
    backend.setMessageBookmark = vi.fn().mockResolvedValue([]);
    render(<ConversationPanel backend={backend} provider={registryProvider()} />);

    const userCard = await screen.findByRole('article', { name: 'You' });
    const answerCard = screen.getByRole('article', { name: 'Assistant' });
    expect(within(userCard).getByRole('button', { name: 'Bookmark message' })).toBeDefined();
    const remove = within(answerCard).getByRole('button', { name: 'Remove bookmark' });
    expect(remove.getAttribute('aria-pressed')).toBe('true');

    await user.click(remove);
    expect(backend.setMessageBookmark).toHaveBeenCalledWith(
      'ws-1',
      'proj-1',
      'sess-1',
      'msg-a',
      false,
    );
    await waitFor(() =>
      expect(within(answerCard).getByRole('button', { name: 'Bookmark message' })).toBeDefined(),
    );
  });

  it('offers no star on a live streaming bubble', async () => {
    const user = userEvent.setup();
    const backend = fakeBackend();
    backend.completeOnceStreaming = vi.fn(async (_ws, _proj, _session, _payload, onEvent) => {
      onEvent({ opId: 'op-live', sequence: 1, event: { type: 'delta', text: 'live answer' } });
      return await new Promise<never>(() => {});
    });
    backend.stopCompletion = vi.fn(async () => ({ opId: 'op-live', status: 'cancelled' }));
    render(<ConversationPanel backend={backend} provider={registryProvider()} />);

    const box = (await screen.findByRole('textbox', {
      name: /composer input/i,
    })) as HTMLTextAreaElement;
    await pickRegistryModel(user);
    await user.type(box, 'hello');
    await user.keyboard('{Enter}');

    const live = (await screen.findByText('live answer')).closest('article') as HTMLElement;
    expect(within(live).queryByRole('button', { name: 'Bookmark message' })).toBeNull();
    expect(within(live).queryByRole('button', { name: 'Remove bookmark' })).toBeNull();
  });
});
