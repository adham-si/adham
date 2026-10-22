import { act, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ConversationPanel } from './conversation-panel';
import { fakeBackend } from './conversation-panel-test-utils';

describe('ConversationPanel message focus', () => {
  it('scrolls to and focuses the requested persisted message', async () => {
    render(<ConversationPanel backend={fakeBackend()} />);
    const text = await screen.findByText('earlier truth');
    const article = text.closest('article') as HTMLElement;
    const scrollIntoView = vi.fn();
    article.scrollIntoView = scrollIntoView;

    act(() => {
      window.dispatchEvent(
        new CustomEvent('adham:session-focus-message', {
          detail: {
            workspaceId: 'ws-1',
            projectId: 'proj-1',
            sessionId: 'sess-1',
            messageId: 'msg-0',
          },
        }),
      );
    });

    await waitFor(() => expect(scrollIntoView).toHaveBeenCalled());
    expect(document.activeElement).toBe(article);
  });

  it('leaves the session open when the requested message is absent', async () => {
    render(<ConversationPanel backend={fakeBackend()} />);
    await screen.findByText('earlier truth');
    expect(() => {
      window.dispatchEvent(
        new CustomEvent('adham:session-focus-message', {
          detail: {
            workspaceId: 'ws-1',
            projectId: 'proj-1',
            sessionId: 'sess-1',
            messageId: 'missing-message',
          },
        }),
      );
    }).not.toThrow();
    expect(screen.getByText('earlier truth')).toBeDefined();
  });
});
