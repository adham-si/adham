import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as React from 'react';
import { useProjectSessions } from './use-project-sessions';
import { useConversation } from './use-conversation';
import { fakeBackend } from './conversation-test-utils';

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

interface IntegrationHarnessProps {
  backend: ReturnType<typeof fakeBackend>;
  workspaceId: string;
  projectId: string;
}

function IntegrationHarness({ backend, workspaceId, projectId }: IntegrationHarnessProps) {
  const { sessions, activeSessionId, selectSession, newSession } = useProjectSessions({
    backend,
    workspaceId,
    projectId,
  });

  const conversation = useConversation({ backend });
  const [text, setText] = React.useState('');

  const isInitialMount = React.useRef(true);
  React.useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }
    conversation.refreshScope();
  }, [workspaceId, projectId, conversation.refreshScope]);

  return (
    <div data-testid="harness">
      <aside data-testid="sidebar">
        <button type="button" data-testid="new-session-button" onClick={() => void newSession()}>
          New Session
        </button>
        <span data-testid="active-session-label">{activeSessionId ?? 'none'}</span>
        <ul data-testid="session-list">
          {sessions.map((s) => (
            <li
              key={s.id}
              data-testid={`session-row-${s.id}`}
              data-selected={s.id === activeSessionId ? 'true' : 'false'}
              onClick={() => selectSession(s.id)}
            >
              <span data-testid={`session-title-${s.id}`}>{s.title}</span>
            </li>
          ))}
        </ul>
      </aside>

      <main data-testid="conversation">
        <div data-testid="conv-status">{conversation.status}</div>
        <div data-testid="conv-session-id">{conversation.sessionId ?? 'null'}</div>
        <ul data-testid="message-list">
          {conversation.messages.map((m) => (
            <li key={m.id} data-testid={`message-${m.id}`}>
              {m.text}
            </li>
          ))}
        </ul>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!text.trim()) return;
            const current = text;
            setText('');
            void conversation.submit(current);
          }}
        >
          <input
            data-testid="message-input"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <button type="submit" data-testid="send-button">
            Send
          </button>
        </form>
      </main>
    </div>
  );
}

describe('Conversation and sidebar integration journey', () => {
  it('empty project -> first send -> immediately updates sidebar with titled, selected session, and keeps second message in same session', async () => {
    const user = userEvent.setup();
    const backend = fakeBackend();

    // 1. Initial discovery returns 0 sessions (empty project)
    backend.listSessions.mockResolvedValue({
      sessions: [],
      truncated: false,
    });

    let createdSessionId = 'sess-int-1';
    let storedSessions: Array<{
      sessionId: string;
      projectId: string;
      title: string | null;
      createdAt: string;
    }> = [];

    backend.createSession.mockImplementation(async (_ws, proj, payload) => {
      const created = {
        sessionId: createdSessionId,
        projectId: proj,
        title: payload.title,
        createdAt: '2026-10-12T00:00:01Z',
      };
      storedSessions.push(created);
      // Update listSessions to return the newly persisted session
      backend.listSessions.mockResolvedValue({
        sessions: [...storedSessions],
        truncated: false,
      });
      return created;
    });

    backend.submitMessage.mockImplementation(async (_ws, _proj, sessId, payload) => ({
      messageId: `msg-${Date.now()}`,
      sessionId: sessId,
      text: payload.text,
      createdAt: '2026-10-12T00:00:02Z',
      streamSequence: '1',
      projectionPosition: '1',
    }));

    render(<IntegrationHarness backend={backend} workspaceId="ws-1" projectId="proj-1" />);

    // Initial check: empty history
    await waitFor(() => {
      expect(screen.getByTestId('conv-status').textContent).toBe('ready');
      expect(screen.getByTestId('conv-session-id').textContent).toBe('null');
    });
    expect(screen.getByTestId('active-session-label').textContent).toBe('none');
    expect(screen.queryByTestId(`session-row-${createdSessionId}`)).toBeNull();

    // 2. Submit first message
    const firstText = 'Deploy v2.1 to production';
    await user.type(screen.getByTestId('message-input'), firstText);
    await user.click(screen.getByTestId('send-button'));

    // Verify first send calls createSession with derived title
    await waitFor(() => {
      expect(backend.createSession).toHaveBeenCalledWith(
        'ws-1',
        'proj-1',
        { title: 'Deploy v2.1 to production' },
        expect.objectContaining({ requestId: expect.any(String) }),
      );
    });

    // 3. Immediately without switching or reloading:
    // Sidebar displays the session with the derived title and selected state
    await waitFor(() => {
      const sessionRow = screen.getByTestId(`session-row-${createdSessionId}`);
      expect(sessionRow).toBeDefined();
      expect(sessionRow.getAttribute('data-selected')).toBe('true');
      expect(screen.getByTestId(`session-title-${createdSessionId}`).textContent).toBe(
        'Deploy v2.1 to production',
      );
    });
    expect(screen.getByTestId('active-session-label').textContent).toBe(createdSessionId);
    expect(screen.getByTestId('conv-session-id').textContent).toBe(createdSessionId);

    // 4. Submit second message in the same conversation
    const secondText = 'Check deployment status';
    await user.type(screen.getByTestId('message-input'), secondText);
    await user.click(screen.getByTestId('send-button'));

    // Second message must stay in the same session without creating a second session
    await waitFor(() => {
      expect(backend.submitMessage).toHaveBeenCalledWith(
        'ws-1',
        'proj-1',
        createdSessionId,
        { text: secondText },
        expect.any(Object),
      );
    });
    // Exactly 1 createSession call was made throughout the entire journey
    expect(backend.createSession).toHaveBeenCalledTimes(1);

    // Sidebar still contains exactly 1 session, title has not been modified
    expect(screen.getByTestId(`session-title-${createdSessionId}`).textContent).toBe(
      'Deploy v2.1 to production',
    );
    expect(
      screen.getByTestId(`session-row-${createdSessionId}`).getAttribute('data-selected'),
    ).toBe('true');
  });

  it('fences scope switch during first send: does not refresh or select new project with old result', async () => {
    const backend = fakeBackend();

    backend.getBootstrapState.mockResolvedValue({
      isInitialized: true,
      activeWorkspaceId: 'ws-1',
      activeProjectId: 'proj-A',
    });
    backend.listSessions.mockResolvedValue({
      sessions: [],
      truncated: false,
    });

    let resolveCreateA!: (val: unknown) => void;
    backend.createSession.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveCreateA = resolve;
        }),
    );

    const { rerender } = render(
      <IntegrationHarness backend={backend} workspaceId="ws-1" projectId="proj-A" />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('conv-status').textContent).toBe('ready');
    });

    // Start first send in Project A (hangs in createSession)
    const input = screen.getByTestId('message-input');
    await userEvent.type(input, 'Message A');
    await userEvent.click(screen.getByTestId('send-button'));

    await waitFor(() => {
      expect(backend.createSession).toHaveBeenCalledWith(
        'ws-1',
        'proj-A',
        { title: 'Message A' },
        expect.any(Object),
      );
    });

    // Switch scope to Project B before Scope A creation resolves
    backend.getBootstrapState.mockResolvedValue({
      isInitialized: true,
      activeWorkspaceId: 'ws-1',
      activeProjectId: 'proj-B',
    });
    rerender(<IntegrationHarness backend={backend} workspaceId="ws-1" projectId="proj-B" />);

    // Resolve Scope A's late creation
    await act(async () => {
      resolveCreateA({
        sessionId: 'sess-A-late',
        projectId: 'proj-A',
        title: 'Message A',
        createdAt: '2026-10-12T00:00:01Z',
      });
    });

    // Sidebar in Project B remains clean without sess-A-late
    expect(screen.queryByTestId('session-row-sess-A-late')).toBeNull();
    expect(screen.getByTestId('active-session-label').textContent).toBe('none');
    // Message A was never submitted
    expect(backend.submitMessage).not.toHaveBeenCalled();
  });
});
