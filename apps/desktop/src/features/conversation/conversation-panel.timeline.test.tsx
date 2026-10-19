import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConversationPanel } from './conversation-panel';
import { fakeBackend, registryProvider, pickRegistryModel } from './conversation-panel-test-utils';

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

describe('ConversationPanel timeline', () => {
  it('renders assistant history as Markdown instead of literal markers', async () => {
    const backend = fakeBackend();
    backend.getConversation = vi.fn().mockResolvedValue({
      items: [
        {
          messageId: 'msg-1',
          role: 'assistant',
          text: '## Heading\n\n**bold** answer',
          createdAt: '2026-10-09T00:00:02Z',
          sourceEventId: 'evt-1',
        },
      ],
      nextCursor: null,
      projectionPosition: '2',
    });

    render(<ConversationPanel backend={backend} />);

    await waitFor(() => expect(screen.getByRole('heading', { level: 2 })).toBeDefined());
    expect(screen.getByText('bold').tagName).toBe('STRONG');
    expect(screen.queryByText(/^\*\*bold\*\*/)).toBeNull();
  });

  it('renders streamed Markdown live, including an incomplete fence', async () => {
    const user = userEvent.setup();
    const backend = fakeBackend();
    backend.completeOnceStreaming = vi.fn(async (_ws, _p, _s, _payload, onEvent) => {
      onEvent({
        opId: 'op-9',
        sequence: 1,
        event: { type: 'delta', text: '## Running\n\n```ts\nconst x' },
      });
      return { opId: 'op-9', messageId: 'm-9', context: null };
    });
    backend.stopCompletion = vi.fn(async () => ({ opId: 'op-9', status: 'cancelled' }));

    render(<ConversationPanel backend={backend} provider={registryProvider()} />);
    const box = (await screen.findByRole('textbox', {
      name: /composer input/i,
    })) as HTMLTextAreaElement;
    await pickRegistryModel(user);
    await user.type(box, 'hi');
    await user.keyboard('{Enter}');

    await waitFor(() => expect(screen.getByRole('heading', { level: 2 })).toBeDefined());
    expect(screen.getByText('Running')).toBeDefined();
    expect(screen.getByText('const x')).toBeDefined();
    expect(screen.queryByText(/```/)).toBeNull();

    // The live bubble is provisional: there is nothing persisted to rate.
    const live = screen.getByText('Running').closest('article') as HTMLElement;
    expect(within(live).queryByRole('button', { name: 'Like this answer' })).toBeNull();
    expect(within(live).queryByRole('button', { name: 'Dislike this answer' })).toBeNull();
  });

  it('labels persisted failed, cancelled, and truncated turns from the stored completion only', async () => {
    const backend = fakeBackend();
    backend.getConversation.mockResolvedValue({
      items: [
        {
          messageId: 'm1',
          role: 'user',
          text: 'did it work?',
          createdAt: '2026-10-16T00:00:00Z',
          sourceEventId: 'e1',
        },
        {
          messageId: 'm2',
          role: 'assistant',
          text: '',
          createdAt: '2026-10-16T00:00:01Z',
          sourceEventId: 'e2',
          completion: 'Failed',
        },
        {
          messageId: 'm3',
          role: 'assistant',
          text: 'half',
          createdAt: '2026-10-16T00:00:02Z',
          sourceEventId: 'e3',
          completion: { Completed: { truncated: true } },
        },
        {
          messageId: 'm4',
          role: 'assistant',
          text: 'partial',
          createdAt: '2026-10-16T00:00:03Z',
          sourceEventId: 'e4',
          completion: 'Interrupted',
        },
      ],
      nextCursor: null,
      projectionPosition: '4',
    });
    render(<ConversationPanel backend={backend} />);

    await screen.findByText('No answer was produced.');
    expect(screen.getByText('Truncated by the length limit.')).toBeDefined();
    expect(screen.getByText('Cancelled')).toBeDefined();
  });
});
