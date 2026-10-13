import * as React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { PendingOperationDto } from '@adham/contracts-generated';
import type { ConversationBackend } from '../conversation-scope';
import { usePendingRecovery } from './use-pending-recovery';
import { ConversationPanel } from '../conversation-panel';
import type { SelectionBackend } from '../../workspace-selection/use-selection';

const crossOp: PendingOperationDto = {
  operationId: 'cross-op-1',
  kind: 'single_message',
  workspaceId: 'ws-target',
  projectId: 'proj-target',
  sessionId: 'sess-target-1',
  messageRequestId: 'msg-req-cross',
  createRequestId: null,
  text: 'Cross-project recovered prompt',
  title: null,
  status: 'pending',
  createdAt: '2026-10-14T00:00:00Z',
};

describe('Cross-project recovery and navigation fencing journeys', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it('late review validation and recovery results are fenced out by navigation', async () => {
    let resolveValidation!: (val: unknown) => void;
    const validationPromise = new Promise((resolve) => {
      resolveValidation = resolve;
    });

    let resolveSubmit!: (val: unknown) => void;
    const submitPromise = new Promise((resolve) => {
      resolveSubmit = resolve;
    });

    const mockBackend: ConversationBackend = {
      getBootstrapState: vi.fn(),
      createSession: vi.fn(),
      submitMessage: vi.fn().mockImplementation(() => submitPromise),
      getConversation: vi.fn().mockImplementation(() => validationPromise),
      recordPendingOperation: vi.fn(),
      listPendingOperations: vi.fn().mockResolvedValue({
        operations: [crossOp],
        truncated: false,
      }),
      clearPendingOperation: vi.fn().mockResolvedValue(undefined),
    };

    const onSessionOpened = vi.fn();
    const { result } = renderHook(() =>
      usePendingRecovery({ backend: mockBackend, onSessionOpened }),
    );

    // 1. Open review for crossOp
    await act(async () => {
      result.current.openReview(crossOp);
    });
    expect(result.current.validatingTarget).toBe(true);

    // 2. Navigation occurs (actual controller event: announceScopeChanged)
    await act(async () => {
      window.dispatchEvent(
        new CustomEvent('adham:scope-changed', {
          detail: {
            step: 'project',
            origin: 'selected',
            workspaceId: 'ws-new',
            projectId: 'proj-new',
          },
        }),
      );
    });
    expect(result.current.reviewDialogOpen).toBe(false);

    // 3. Late validation resolves: must NOT reopen or set state on closed review
    await act(async () => {
      resolveValidation(new Error('SESSION_NOT_FOUND: stream does not exist'));
    });

    expect(result.current.reviewDialogOpen).toBe(false);
    expect(result.current.validatingTarget).toBe(false);
    expect(result.current.targetMissing).toBe(false);

    // 4. Test in-flight resend when navigation occurs
    await act(async () => {
      result.current.openReview(crossOp);
    });
    let resendPromise: Promise<unknown>;
    await act(async () => {
      resendPromise = result.current.resendOperation(crossOp);
    });

    // Navigation occurs while resend submit is in-flight
    await act(async () => {
      window.dispatchEvent(
        new CustomEvent('adham:scope-changed', {
          detail: {
            step: 'project',
            origin: 'selected',
            workspaceId: 'ws-nav',
            projectId: 'proj-nav',
          },
        }),
      );
    });

    // In-flight submit completes
    await act(async () => {
      resolveSubmit({
        messageId: 'msg-late',
        text: crossOp.text,
        createdAt: '2026-10-14T00:00:00Z',
      });
      await resendPromise;
    });

    // onSessionOpened must NOT have been called because navigation fenced it out!
    expect(onSessionOpened).not.toHaveBeenCalled();
  });

  it('cross-project recovery through ConversationPanel confirms selection and opens exact session', async () => {
    let mockPendingOps = [crossOp];
    const mockConvBackend: ConversationBackend = {
      getBootstrapState: vi.fn().mockResolvedValue({
        isInitialized: true,
        activeWorkspaceId: 'ws-current',
        activeProjectId: 'proj-current',
      }),
      createSession: vi.fn(),
      submitMessage: vi.fn().mockImplementation((ws, proj, sess, payload) =>
        Promise.resolve({
          messageId: 'msg-' + (payload.requestId ?? 'subsequent'),
          sessionId: sess,
          text: payload.text,
          createdAt: '2026-10-14T00:00:00Z',
        }),
      ),
      getConversation: vi.fn().mockImplementation((ws, proj, sess) => {
        if (ws === 'ws-target' && proj === 'proj-target' && sess === 'sess-target-1') {
          return Promise.resolve({
            items: [
              {
                messageId: 'msg-resent-1',
                role: 'user',
                text: crossOp.text,
                createdAt: '2026-10-14T00:00:00Z',
              },
            ],
            nextCursor: null,
          });
        }
        if (ws === 'ws-current' && proj === 'proj-current' && sess === 'sess-current-2') {
          return Promise.resolve({
            items: [
              {
                messageId: 'msg-curr-2',
                role: 'user',
                text: 'Switched session message',
                createdAt: '2026-10-14T00:00:00Z',
              },
            ],
            nextCursor: null,
          });
        }
        return Promise.resolve({
          items: [],
          nextCursor: null,
        });
      }),
      listSessions: vi.fn().mockResolvedValue({
        sessions: [
          {
            sessionId: 'sess-current-1',
            title: 'Current Session 1',
            createdAt: '2026-10-14T00:00:00Z',
          },
          {
            sessionId: 'sess-current-2',
            title: 'Current Session 2',
            createdAt: '2026-10-14T00:00:00Z',
          },
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
    };

    const mockSelectionBackend: SelectionBackend = {
      getBootstrapState: vi.fn().mockResolvedValue({
        isInitialized: true,
        activeWorkspaceId: 'ws-current',
        activeProjectId: 'proj-current',
      }),
      listWorkspaces: vi.fn().mockResolvedValue({
        workspaces: [
          {
            workspaceId: 'ws-current',
            name: 'WS Current',
            kind: 'personal',
            createdAt: '2026-10-14T00:00:00Z',
          },
          {
            workspaceId: 'ws-target',
            name: 'WS Target',
            kind: 'personal',
            createdAt: '2026-10-14T00:00:00Z',
          },
        ],
        truncated: false,
      }),
      listProjects: vi.fn().mockResolvedValue({
        projects: [
          {
            projectId: 'proj-target',
            name: 'Proj Target',
            storageKind: 'isolated',
            createdAt: '2026-10-14T00:00:00Z',
          },
        ],
        truncated: false,
      }),
      selectProject: vi.fn().mockResolvedValue({
        isInitialized: true,
        activeWorkspaceId: 'ws-target',
        activeProjectId: 'proj-target',
      }),
    };

    render(<ConversationPanel backend={mockConvBackend} selection={mockSelectionBackend} />);

    // 1. Banner appears with cross-project target indication
    await waitFor(() => {
      expect(screen.getByText(/Unresolved message in ws-target \/ proj-target/i)).toBeDefined();
    });

    // 2. Perform a session switch while recovery is pending
    await act(async () => {
      window.dispatchEvent(
        new CustomEvent('adham:session-select', {
          detail: { sessionId: 'sess-current-2', projectId: 'proj-current' },
        }),
      );
    });

    await waitFor(() => {
      expect(screen.getByText('Switched session message')).toBeDefined();
    });

    // Verify recovery banner remains visible and actionable across session switch
    expect(screen.getByText(/Unresolved message in ws-target \/ proj-target/i)).toBeDefined();

    // 3. Click "Review & Resend"
    const reviewBtn = screen.getByRole('button', { name: /Review & Resend/i });
    fireEvent.click(reviewBtn);

    // 4. Review dialog opens with checkingTarget completed and preview visible
    await waitFor(() => {
      expect(screen.getByText(/Unresolved Message Recovery/i)).toBeDefined();
      expect(screen.getByText(crossOp.text)).toBeDefined();
    });

    // 5. Click "Resend to Original Target"
    const resendBtn = screen.getByRole('button', { name: /Resend to Original Target/i });
    await act(async () => {
      fireEvent.click(resendBtn);
    });

    // 6. Verify backend submitMessage was called with original request id
    await waitFor(() => {
      expect(mockConvBackend.submitMessage).toHaveBeenCalledWith(
        'ws-target',
        'proj-target',
        'sess-target-1',
        { text: crossOp.text },
        { requestId: crossOp.messageRequestId },
      );
    });

    // 7. Verify clearPendingOperation was called with reason: 'resolved'
    expect(mockConvBackend.clearPendingOperation).toHaveBeenCalledWith(
      expect.objectContaining({
        operationId: crossOp.operationId,
        expectedMessageRequestId: crossOp.messageRequestId,
        reason: 'resolved',
      }),
      undefined,
    );

    // 8. Verify selectProject was called to confirm scope switch on the backend
    expect(mockSelectionBackend.selectProject).toHaveBeenCalledWith(
      'ws-target',
      { projectId: 'proj-target' },
      expect.any(Object),
    );

    // 9. Verify the recovered session history is loaded in the timeline without racing old context
    await waitFor(() => {
      expect(mockConvBackend.getConversation).toHaveBeenCalledWith(
        'ws-target',
        'proj-target',
        'sess-target-1',
      );
    });

    // 10. Verify actual post-recovery timeline in the DOM
    await waitFor(() => {
      expect(screen.getByText('Cross-project recovered prompt')).toBeDefined();
    });

    // 11. Verify subsequent-send targets recovered workspace/project/session
    const user = userEvent.setup();
    const composerBox = (await screen.findByRole('textbox', {
      name: /composer input/i,
    })) as HTMLTextAreaElement;

    await user.type(composerBox, 'Subsequent prompt in target session');
    await user.keyboard('{Enter}');

    await waitFor(() => {
      expect(mockConvBackend.submitMessage).toHaveBeenCalledWith(
        'ws-target',
        'proj-target',
        'sess-target-1',
        { text: 'Subsequent prompt in target session' },
        expect.objectContaining({ requestId: expect.any(String) }),
      );
    });
  });
});
