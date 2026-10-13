import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import type { PendingOperationDto } from '@adham/contracts-generated';
import type { ConversationBackend } from '../conversation-scope';
import { performSingleMessageSend } from '../single-message-send';
import { usePendingRecovery } from './use-pending-recovery';
import { PendingRecoveryReviewDialog } from './pending-recovery-review-dialog';
import { PendingRecoveryBanner } from './pending-recovery-banner';
import { writePendingSend } from '../conversation-identity';
import i18n from '@/shared/i18n';

const sampleOp: PendingOperationDto = {
  operationId: 'op-123',
  kind: 'single_message',
  workspaceId: 'ws-1',
  projectId: 'proj-1',
  sessionId: 'sess-1',
  createRequestId: null,
  messageRequestId: 'msg-req-123',
  text: 'Unresolved prompt text',
  title: null,
  status: 'pending',
  createdAt: '2026-10-14T00:00:00Z',
};

describe('Pending Recovery Fencing and Regressions', () => {
  it('restart ordinary composer cannot bypass unresolved operation for target', async () => {
    sessionStorage.clear();
    const submitMessage = vi.fn().mockResolvedValue({
      messageId: 'msg-1',
      sessionId: 'sess-1',
      text: 'Original text',
      createdAt: '2026-10-14T00:00:00Z',
    });

    const mockBackend: ConversationBackend = {
      getBootstrapState: vi.fn(),
      createSession: vi.fn(),
      submitMessage,
      getConversation: vi.fn(),
      recordPendingOperation: vi.fn(),
      listPendingOperations: vi.fn().mockResolvedValue({
        operations: [{ ...sampleOp, text: 'Original text' }],
        truncated: false,
      }),
      clearPendingOperation: vi.fn().mockResolvedValue(undefined),
    };

    // 1. User tries to send different text in the session that has an unresolved operation
    const blockedOutcome = await performSingleMessageSend({
      backend: mockBackend,
      workspaceId: 'ws-1',
      projectId: 'proj-1',
      sessionId: 'sess-1',
      text: 'Different text entered after restart',
      isStale: () => false,
    });

    expect(blockedOutcome.ok).toBe(false);
    if (!blockedOutcome.ok) {
      expect(blockedOutcome.uncertain).toBe(true);
    }
    // Must NOT bypass unresolved operation
    expect(submitMessage).not.toHaveBeenCalled();

    // 2. User retries the original text: reuses original frozen identity
    const retryOutcome = await performSingleMessageSend({
      backend: mockBackend,
      workspaceId: 'ws-1',
      projectId: 'proj-1',
      sessionId: 'sess-1',
      text: 'Original text',
      isStale: () => false,
    });

    expect(retryOutcome.ok).toBe(true);
    expect(submitMessage).toHaveBeenCalledWith(
      'ws-1',
      'proj-1',
      'sess-1',
      { text: 'Original text' },
      { requestId: 'msg-req-123' },
    );
  });

  it('recording committed response lost retry retains the same identity', async () => {
    sessionStorage.clear();
    const submitMessage = vi.fn().mockResolvedValue({
      messageId: 'msg-1',
      sessionId: 'sess-1',
      text: 'Hello test',
      createdAt: '2026-10-14T00:00:00Z',
    });

    // SQLite already committed the operation with ID 'op-committed'
    const committedOp: PendingOperationDto = {
      operationId: 'op-committed',
      kind: 'single_message',
      workspaceId: 'ws-1',
      projectId: 'proj-1',
      sessionId: 'sess-1',
      createRequestId: null,
      messageRequestId: 'msg-req-committed',
      text: 'Hello test',
      title: null,
      status: 'pending',
      createdAt: '2026-10-14T00:00:00Z',
    };

    const mockBackend: ConversationBackend = {
      getBootstrapState: vi.fn(),
      createSession: vi.fn(),
      submitMessage,
      getConversation: vi.fn(),
      recordPendingOperation: vi.fn(),
      listPendingOperations: vi.fn().mockResolvedValue({
        operations: [committedOp],
        truncated: false,
      }),
      clearPendingOperation: vi.fn().mockResolvedValue(undefined),
    };

    const outcome = await performSingleMessageSend({
      backend: mockBackend,
      workspaceId: 'ws-1',
      projectId: 'proj-1',
      sessionId: 'sess-1',
      text: 'Hello test',
      isStale: () => false,
    });

    expect(outcome.ok).toBe(true);
    // Verified: discovers existing SQLite operation and uses frozen msg-req-committed
    expect(submitMessage).toHaveBeenCalledWith(
      'ws-1',
      'proj-1',
      'sess-1',
      { text: 'Hello test' },
      { requestId: 'msg-req-committed' },
    );
  });

  it('legacy recovery durable recording precedes dispatch', async () => {
    sessionStorage.clear();
    // Legacy identity in sessionStorage
    writePendingSend({
      requestId: 'legacy-req-456',
      text: 'Legacy unsaved message',
      workspaceId: 'ws-1',
      projectId: 'proj-1',
      sessionId: 'sess-1',
    });

    const callOrder: string[] = [];
    const recordPendingOperation = vi.fn().mockImplementation(async () => {
      callOrder.push('recordPending');
      return { ...sampleOp, messageRequestId: 'legacy-req-456' };
    });
    const submitMessage = vi.fn().mockImplementation(async () => {
      callOrder.push('submitMessage');
      return {
        messageId: 'msg-legacy',
        sessionId: 'sess-1',
        text: 'Legacy unsaved message',
        createdAt: '2026-10-14T00:00:00Z',
      };
    });

    const mockBackend: ConversationBackend = {
      getBootstrapState: vi.fn(),
      createSession: vi.fn(),
      submitMessage,
      getConversation: vi.fn(),
      recordPendingOperation,
      listPendingOperations: vi.fn().mockResolvedValue({ operations: [], truncated: false }),
      clearPendingOperation: vi.fn().mockResolvedValue(undefined),
    };

    const outcome = await performSingleMessageSend({
      backend: mockBackend,
      workspaceId: 'ws-1',
      projectId: 'proj-1',
      sessionId: 'sess-1',
      text: 'Legacy unsaved message',
      isStale: () => false,
    });

    expect(outcome.ok).toBe(true);
    // CRITICAL: recordPending must precede dispatch!
    expect(callOrder).toEqual(['recordPending', 'submitMessage']);
    expect(recordPendingOperation).toHaveBeenCalledWith(
      'ws-1',
      'proj-1',
      expect.objectContaining({
        messageRequestId: 'legacy-req-456',
        text: 'Legacy unsaved message',
      }),
      { sessionId: 'sess-1' },
    );
  });

  it('cleanup failure saved message warning survives refresh', async () => {
    const mockBackend: ConversationBackend = {
      getBootstrapState: vi.fn(),
      createSession: vi.fn(),
      submitMessage: vi.fn().mockResolvedValue({
        messageId: 'msg-1',
        text: sampleOp.text,
        createdAt: '2026-10-14T00:00:00Z',
      }),
      getConversation: vi.fn().mockResolvedValue({ items: [] }),
      recordPendingOperation: vi.fn(),
      listPendingOperations: vi.fn().mockResolvedValue({
        operations: [sampleOp],
        truncated: false,
      }),
      // Cleanup fails!
      clearPendingOperation: vi.fn().mockRejectedValue(new Error('SQLite lock conflict on clear')),
    };

    const { result } = renderHook(() => usePendingRecovery({ backend: mockBackend }));
    await waitFor(() => expect(result.current.operations.length).toBe(1));

    await act(async () => {
      await result.current.resendOperation(sampleOp);
    });

    // Actionable cleanup warning is set
    expect(result.current.cleanupWarning).toBe(i18n.t('conversation.recovery.cleanupFailed'));

    // Now trigger refresh()
    await act(async () => {
      await result.current.refresh();
    });

    // Warning SURVIVES refresh!
    expect(result.current.cleanupWarning).toBe(i18n.t('conversation.recovery.cleanupFailed'));
  });

  it('failed resend and dismissal keeps dialog open with error', async () => {
    const onResend = vi
      .fn()
      .mockResolvedValue({ ok: false, error: 'Target unreachable during resend' });
    const onDismiss = vi
      .fn()
      .mockResolvedValue({ ok: false, error: 'Database locked during dismissal' });
    const onClose = vi.fn();

    render(
      <PendingRecoveryReviewDialog
        open={true}
        operation={sampleOp}
        onClose={onClose}
        onResend={onResend}
        onDismiss={onDismiss}
      />,
    );

    // 1. Resend failure keeps dialog open and displays error
    const resendBtn = screen.getByRole('button', { name: /Resend to Original Target/i });
    await act(async () => {
      fireEvent.click(resendBtn);
    });

    expect(onResend).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toContain('Target unreachable during resend');

    // 2. Open dismiss confirmation
    const dismissBtn = screen.getByRole('button', { name: /Dismiss/i });
    await act(async () => {
      fireEvent.click(dismissBtn);
    });

    expect(screen.getByText(/Dismiss unresolved message\?/i)).toBeDefined();

    // 3. Confirm dismissal failure keeps dialog open and displays error
    const confirmDismissBtn = screen.getByRole('button', { name: /Dismiss Reminder/i });
    await act(async () => {
      fireEvent.click(confirmDismissBtn);
    });

    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toContain('Database locked during dismissal');
  });

  it('banner dismissal confirmation required with zero deletions on cancel', async () => {
    let dismissRequestOp: PendingOperationDto | null = null;
    const onReview = vi.fn();
    const onDismissRequest = vi.fn((op: PendingOperationDto) => {
      dismissRequestOp = op;
    });

    // Render banner
    const { rerender } = render(
      <PendingRecoveryBanner
        operations={[sampleOp]}
        truncated={false}
        onReview={onReview}
        onDismiss={onDismissRequest}
      />,
    );

    // Click Dismiss on banner
    const bannerDismissBtn = screen.getByRole('button', { name: /Dismiss/i });
    fireEvent.click(bannerDismissBtn);

    expect(onDismissRequest).toHaveBeenCalledWith(sampleOp);
    expect(dismissRequestOp).toBe(sampleOp);

    // Render ReviewDialog in confirmation mode (as initiated by banner dismiss)
    const onClose = vi.fn();
    const onDismissBackend = vi.fn().mockResolvedValue({ ok: true });

    rerender(
      <PendingRecoveryReviewDialog
        open={true}
        operation={dismissRequestOp}
        initialDismissConfirm={true}
        onClose={onClose}
        onResend={vi.fn()}
        onDismiss={onDismissBackend}
      />,
    );

    // Confirmation dialog is shown
    expect(screen.getByText(/Dismiss unresolved message\?/i)).toBeDefined();

    // Click Cancel
    const cancelBtn = screen.getByRole('button', { name: /Cancel/i });
    fireEvent.click(cancelBtn);

    // Must close with ZERO deletions!
    expect(onClose).toHaveBeenCalled();
    expect(onDismissBackend).not.toHaveBeenCalled();
  });
});
