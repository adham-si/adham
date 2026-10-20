import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConversationPanel } from './conversation-panel';
import { fakeBackend, registryProvider } from './conversation-panel-test-utils';

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

describe('ConversationPanel answer feedback', () => {
  it('rates an answer, switches the verdict, and removes it on a second press', async () => {
    const user = userEvent.setup();
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
    });
    backend.setAnswerFeedback = vi
      .fn()
      .mockResolvedValueOnce([{ messageId: 'msg-a', verdict: 'like', reason: null }])
      .mockResolvedValueOnce([{ messageId: 'msg-a', verdict: 'like', reason: 'clear' }])
      .mockResolvedValueOnce([{ messageId: 'msg-a', verdict: 'dislike', reason: null }])
      .mockResolvedValueOnce([]);
    render(<ConversationPanel backend={backend} provider={registryProvider()} />);

    const card = await screen.findByRole('article', { name: 'Assistant' });
    const like = within(card).getByRole('button', { name: 'Like this answer' });
    const dislike = within(card).getByRole('button', { name: 'Dislike this answer' });
    // Nothing stored yet: nothing is pressed, and there is no reason field.
    expect(like.getAttribute('aria-pressed')).toBe('false');
    expect(within(card).queryByRole('textbox', { name: 'Add a note (optional)' })).toBeNull();

    await user.click(like);
    expect(backend.setAnswerFeedback).toHaveBeenCalledWith(
      'ws-1',
      'proj-1',
      'sess-1',
      'msg-a',
      'like',
      null,
    );
    // Only the stored verdict is ever pressed.
    await waitFor(() => expect(like.getAttribute('aria-pressed')).toBe('true'));
    expect(dislike.getAttribute('aria-pressed')).toBe('false');
    expect(within(card).getByRole('textbox', { name: 'Add a note (optional)' })).toBeDefined();

    // The note also saves from its explicit action, not only Enter.
    await user.type(within(card).getByRole('textbox', { name: 'Add a note (optional)' }), 'clear');
    await user.click(within(card).getByRole('button', { name: 'Save' }));
    expect(backend.setAnswerFeedback).toHaveBeenLastCalledWith(
      'ws-1',
      'proj-1',
      'sess-1',
      'msg-a',
      'like',
      'clear',
    );

    await user.click(dislike);
    await waitFor(() => expect(dislike.getAttribute('aria-pressed')).toBe('true'));
    expect(like.getAttribute('aria-pressed')).toBe('false');

    // A second press on the pressed verdict removes the feedback entirely.
    await user.click(dislike);
    expect(backend.setAnswerFeedback).toHaveBeenLastCalledWith(
      'ws-1',
      'proj-1',
      'sess-1',
      'msg-a',
      null,
      null,
    );
    await waitFor(() => expect(dislike.getAttribute('aria-pressed')).toBe('false'));
    expect(within(card).queryByRole('textbox', { name: 'Add a note (optional)' })).toBeNull();
  });

  it('keeps a stored verdict pressed on load and states a refused save', async () => {
    const user = userEvent.setup();
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
      feedback: [{ messageId: 'msg-a', verdict: 'dislike', reason: null }],
    });
    backend.setAnswerFeedback = vi
      .fn()
      .mockResolvedValueOnce([{ messageId: 'msg-a', verdict: 'dislike', reason: 'too generic' }])
      .mockRejectedValueOnce(new Error('feedback refused by the server'));
    render(<ConversationPanel backend={backend} provider={registryProvider()} />);

    // The verdict read back with the history drives the pressed state.
    const card = await screen.findByRole('article', { name: 'Assistant' });
    const like = within(card).getByRole('button', { name: 'Like this answer' });
    const dislike = within(card).getByRole('button', { name: 'Dislike this answer' });
    await waitFor(() => expect(dislike.getAttribute('aria-pressed')).toBe('true'));
    expect(like.getAttribute('aria-pressed')).toBe('false');

    // The optional reason saves on Enter, on top of the current verdict.
    const reason = within(card).getByRole('textbox', { name: 'Add a note (optional)' });
    await user.type(reason, 'too generic{Enter}');
    expect(backend.setAnswerFeedback).toHaveBeenCalledWith(
      'ws-1',
      'proj-1',
      'sess-1',
      'msg-a',
      'dislike',
      'too generic',
    );

    // A refused switch is stated and nothing flips. Focus + Enter proves the
    // buttons are keyboard reachable.
    like.focus();
    await user.keyboard('{Enter}');
    expect(await screen.findByText('feedback refused by the server')).toBeDefined();
    expect(backend.setAnswerFeedback).toHaveBeenLastCalledWith(
      'ws-1',
      'proj-1',
      'sess-1',
      'msg-a',
      'like',
      'too generic',
    );
    expect(dislike.getAttribute('aria-pressed')).toBe('true');
    expect(like.getAttribute('aria-pressed')).toBe('false');
  });
});
