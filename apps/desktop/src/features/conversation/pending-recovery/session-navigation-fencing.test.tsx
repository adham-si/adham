import * as React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { PendingOperationDto } from '@adham/contracts-generated';
import type { ConversationBackend } from '../conversation-scope';
import { ConversationPanel } from '../conversation-panel';
import type { SelectionBackend } from '../../workspace-selection';

const pendingOp: PendingOperationDto = {
  operationId: 'op-deferred-1',
  kind: 'single_message',
  workspaceId: 'ws-1',
  projectId: 'proj-1',
  sessionId: 'sess-target',
  messageRequestId: 'msg-req-deferred',
  createRequestId: null,
  text: 'Unresolved recovered prompt',
  title: null,
  status: 'pending',
  createdAt: '2026-10-14T00:00:00Z',
};

describe('Session-selection navigation fencing during recovery', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it('deferred resend response does not hijack selection when user selects another session', async () => {
    let resolveResendSubmit!: (val: unknown) => void;
    const resendSubmitPromise = new Promise((resolve) => {
      resolveResendSubmit = resolve;
    });

    let mockPendingOps = [pendingOp];

    const mockConvBackend: ConversationBackend = {
      getBootstrapState: vi.fn().mockResolvedValue({
        isInitialized: true,
        activeWorkspaceId: 'ws-1',
        activeProjectId: 'proj-1',
      }),
      createSession: vi.fn(),
      submitMessage: vi.fn().mockImplementation((ws, proj, sess, payload) => {
        if (payload.text === pendingOp.text) {
          return resendSubmitPromise;
        }
        return Promise.resolve({
          messageId: 'msg-subsequent',
          sessionId: sess,
          text: payload.text,
          createdAt: '2026-10-14T00:01:00Z',
        });
      }),
      getConversation: vi.fn().mockImplementation((ws, proj, sess) => {
        if (sess === 'sess-initial') {
          return Promise.resolve({
            items: [
              {
                messageId: 'msg-initial-1',
                role: 'user',
                text: 'Initial session message',
                createdAt: '2026-10-14T00:00:00Z',
              },
            ],
            nextCursor: null,
          });
        }
        if (sess === 'sess-newer') {
          return Promise.resolve({
            items: [
              {
                messageId: 'msg-newer-1',
                role: 'user',
                text: 'Newer selected session message',
                createdAt: '2026-10-14T00:00:00Z',
              },
            ],
            nextCursor: null,
          });
        }
        if (sess === 'sess-target') {
          return Promise.resolve({
            items: [
              {
                messageId: 'msg-recovered-1',
                role: 'user',
                text: pendingOp.text,
                createdAt: '2026-10-14T00:00:00Z',
              },
            ],
            nextCursor: null,
          });
        }
        return Promise.resolve({ items: [], nextCursor: null });
      }),
      listSessions: vi.fn().mockResolvedValue({
        sessions: [
          {
            sessionId: 'sess-initial',
            title: 'Session Initial',
            createdAt: '2026-10-14T00:00:00Z',
          },
          { sessionId: 'sess-newer', title: 'Session Newer', createdAt: '2026-10-14T00:00:00Z' },
        ],
        truncated: false,
      }),
      recordPendingOperation: vi.fn().mockImplementation((ws, proj, payload, opts) =>
        Promise.resolve({
          operationId: payload.operationId,
          kind: payload.kind,
          workspaceId: ws,
          projectId: proj,
          sessionId: opts?.sessionId ?? null,
          createRequestId: payload.createRequestId ?? null,
          messageRequestId: payload.messageRequestId,
          text: payload.text,
          title: payload.title ?? null,
          status: 'pending',
          createdAt: '2026-10-14T00:00:00Z',
        }),
      ),
      listPendingOperations: vi.fn().mockImplementation(() =>
        Promise.resolve({
          operations: [...mockPendingOps],
          truncated: false,
        }),
      ),
      clearPendingOperation: vi.fn().mockImplementation((payload) => {
        mockPendingOps = mockPendingOps.filter((op) => op.operationId !== payload.operationId);
        return Promise.resolve(undefined);
      }),
      setActiveAlternative: vi.fn().mockResolvedValue([]),
      setAnswerFeedback: vi.fn().mockResolvedValue([]),
    };

    const mockSelectionBackend: SelectionBackend = {
      getBootstrapState: vi.fn().mockResolvedValue({
        isInitialized: true,
        activeWorkspaceId: 'ws-1',
        activeProjectId: 'proj-1',
      }),
      listWorkspaces: vi.fn().mockResolvedValue({
        workspaces: [
          {
            workspaceId: 'ws-1',
            name: 'Workspace 1',
            kind: 'personal',
            createdAt: '2026-10-14T00:00:00Z',
          },
        ],
        truncated: false,
      }),
      listProjects: vi.fn().mockResolvedValue({
        projects: [
          {
            projectId: 'proj-1',
            name: 'Project 1',
            storageKind: 'isolated',
            createdAt: '2026-10-14T00:00:00Z',
          },
        ],
        truncated: false,
      }),
      selectProject: vi.fn(),
    };

    render(<ConversationPanel backend={mockConvBackend} selection={mockSelectionBackend} />);

    // 1. Initial session loads
    await waitFor(() => {
      expect(screen.getByText('Initial session message')).toBeDefined();
    });

    // 2. Recovery banner is visible
    expect(screen.getByText(/Unresolved message in ws-1 \/ proj-1 \/ sess-target/i)).toBeDefined();

    // 3. Open review and click resend (starts in-flight resend with deferred promise)
    const reviewBtn = screen.getByRole('button', { name: /Review & Resend/i });
    fireEvent.click(reviewBtn);

    await waitFor(() => {
      expect(screen.getByText(/Unresolved Message Recovery/i)).toBeDefined();
    });

    const resendBtn = screen.getByRole('button', { name: /Resend to Original Target/i });
    await act(async () => {
      fireEvent.click(resendBtn);
    });

    // Resend submit is now in-flight
    expect(mockConvBackend.submitMessage).toHaveBeenCalledWith(
      'ws-1',
      'proj-1',
      'sess-target',
      { text: pendingOp.text },
      { requestId: pendingOp.messageRequestId },
    );

    // 4. While resend is in flight, user selects another session ('sess-newer')
    await act(async () => {
      window.dispatchEvent(
        new CustomEvent('adham:session-select', {
          detail: { sessionId: 'sess-newer', projectId: 'proj-1' },
        }),
      );
    });

    // Verify newer session history is displayed
    await waitFor(() => {
      expect(screen.getByText('Newer selected session message')).toBeDefined();
    });

    // 5. Now resolve the deferred resend submit
    await act(async () => {
      resolveResendSubmit({
        messageId: 'msg-deferred-saved',
        sessionId: 'sess-target',
        text: pendingOp.text,
        createdAt: '2026-10-14T00:00:00Z',
      });
    });

    // 6. Verify the newer session remains selected and displayed
    await waitFor(() => {
      expect(screen.getByText('Newer selected session message')).toBeDefined();
    });
    // The target session text must NOT have replaced or hijacked the newer session timeline
    expect(screen.queryByText(pendingOp.text)).toBeNull();
  });
});
