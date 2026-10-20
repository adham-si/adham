import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, renderHook, waitFor, act } from '@testing-library/react';
import type { PendingOperationDto } from '@adham/contracts-generated';
import { PendingRecoveryBanner } from './pending-recovery-banner';
import { PendingRecoveryReviewDialog } from './pending-recovery-review-dialog';
import { usePendingRecovery } from './use-pending-recovery';
import { listDurablePendingOperations } from './durable-pending-operations';
import { performSingleMessageSend } from '../single-message-send';
import { performLazyFirstSend } from '../lazy-session-creation';
import type { ConversationBackend } from '../conversation-scope';

describe('APP-WIRING-04: Durable pending recovery UI and hooks', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.restoreAllMocks();
  });

  const sampleSingleOp: PendingOperationDto = {
    operationId: 'op-1',
    kind: 'single_message',
    workspaceId: 'ws-1',
    projectId: 'proj-1',
    sessionId: 'sess-1',
    createRequestId: null,
    messageRequestId: 'msg-req-1',
    text: 'Unresolved prompt text',
    title: null,
    status: 'pending',
    createdAt: '2026-10-14T10:00:00Z',
  };

  const sampleFirstSendOp: PendingOperationDto = {
    operationId: 'op-2',
    kind: 'first_send',
    workspaceId: 'ws-1',
    projectId: 'proj-1',
    sessionId: null,
    createRequestId: 'create-req-1',
    messageRequestId: 'msg-req-2',
    text: 'First message text',
    title: 'New Investigation',
    status: 'pending',
    createdAt: '2026-10-14T10:05:00Z',
  };

  // A7 regression: provider dispatch handles recorded at socket time must
  // never enter the message-recovery flow. (Owner evidence 2026-10-17: a
  // stuck `provider-completion` op rendered as "Unresolved message —
  // Review & Resend".) The record itself is not touched — only the view.
  const providerOp: PendingOperationDto = {
    ...sampleSingleOp,
    operationId: '01a14a4e-912d-728d-9a5b-235e6098ccb0',
    kind: 'provider-completion',
    text: '',
    messageRequestId: 'provider-op-1',
  };

  it('excludes provider-completion ops from the message-recovery list and banner', async () => {
    const backend = {
      listPendingOperations: vi
        .fn()
        .mockResolvedValue({ operations: [providerOp, sampleSingleOp], truncated: false }),
      recordPendingOperation: vi.fn(),
      clearPendingOperation: vi.fn(async () => undefined),
      setActiveAlternative: vi.fn().mockResolvedValue([]),
      setAnswerFeedback: vi.fn().mockResolvedValue([]),
    } as unknown as ConversationBackend;

    // composited list layer
    const listed = await listDurablePendingOperations(backend);
    if (!listed.ok) throw new Error(`list failed: ${listed.error}`);
    expect(listed.list.operations.map((op) => op.kind)).toEqual(['single_message']);

    // hook + banner surface
    const { result } = renderHook(() => usePendingRecovery({ backend, onSessionOpened: vi.fn() }));
    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.error).toBeNull();
    expect(result.current.operations).toHaveLength(1);
    expect(result.current.operations[0]?.kind).toBe('single_message');

    const { container } = render(
      <PendingRecoveryBanner
        operations={result.current.operations}
        truncated={false}
        onReview={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
  });

  it('renders banner with target and discloses truncation when present', () => {
    const onReview = vi.fn();
    const onDismiss = vi.fn();

    const { rerender } = render(
      <PendingRecoveryBanner
        operations={[sampleSingleOp]}
        truncated={false}
        onReview={onReview}
        onDismiss={onDismiss}
      />,
    );

    expect(screen.getByRole('alert')).toBeDefined();
    expect(screen.getByText(/Review & Resend/i)).toBeDefined();
    expect(screen.getByText(/Dismiss/i)).toBeDefined();
    expect(screen.queryByText(/truncated/i)).toBeNull();

    rerender(
      <PendingRecoveryBanner
        operations={[sampleFirstSendOp]}
        truncated={true}
        onReview={onReview}
        onDismiss={onDismiss}
      />,
    );

    expect(screen.getByText(/Older unresolved operations are truncated/i)).toBeDefined();
  });

  it('review dialog shows original target and payload without silently resending', async () => {
    const onClose = vi.fn();
    const onResend = vi.fn();
    const onDismiss = vi.fn();

    render(
      <PendingRecoveryReviewDialog
        open={true}
        operation={sampleSingleOp}
        targetMissing={false}
        onClose={onClose}
        onResend={onResend}
        onDismiss={onDismiss}
      />,
    );

    expect(screen.getByText(/Unresolved Message Recovery/i)).toBeDefined();
    expect(screen.getByText('Unresolved prompt text')).toBeDefined();
    expect(screen.getByText(/ws-1 \/ proj-1 \/ sess-1/)).toBeDefined();
    // Verify resend has NOT been triggered silently
    expect(onResend).not.toHaveBeenCalled();

    // Clicking resend calls onResend
    await act(async () => {
      fireEvent.click(screen.getByText(/Resend to Original Target/i));
    });
    expect(onResend).toHaveBeenCalledWith(sampleSingleOp);
  });

  it('shows missing target warning and prevents resend while allowing text copy and dismiss', () => {
    const onClose = vi.fn();
    const onResend = vi.fn();
    const onDismiss = vi.fn();

    render(
      <PendingRecoveryReviewDialog
        open={true}
        operation={sampleSingleOp}
        targetMissing={true}
        onClose={onClose}
        onResend={onResend}
        onDismiss={onDismiss}
      />,
    );

    expect(
      screen.getByText(/Target workspace or project is inaccessible or missing/i),
    ).toBeDefined();
    expect(screen.queryByText(/Resend to Original Target/i)).toBeNull();
    expect(screen.getByText(/Copy Text/i)).toBeDefined();
    expect(screen.getByText(/Dismiss/i)).toBeDefined();
  });

  it('states a failed clipboard copy instead of swallowing it', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockRejectedValue(new Error('clipboard denied')) },
      configurable: true,
    });

    render(
      <PendingRecoveryReviewDialog
        open={true}
        operation={sampleSingleOp}
        onClose={vi.fn()}
        onResend={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByText(/Copy Text/i));

    expect(await screen.findByText(/Copy failed/i)).toBeDefined();
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
  });

  it('shows dismiss confirmation warning and executes dismissal upon confirmation', async () => {
    const onClose = vi.fn();
    const onResend = vi.fn();
    const onDismiss = vi.fn().mockResolvedValue(undefined);

    render(
      <PendingRecoveryReviewDialog
        open={true}
        operation={sampleSingleOp}
        targetMissing={false}
        onClose={onClose}
        onResend={onResend}
        onDismiss={onDismiss}
      />,
    );

    // Click dismiss button
    await act(async () => {
      fireEvent.click(screen.getByText(/Dismiss/i));
    });

    // Confirmation warning must be displayed
    expect(screen.getByText(/Dismiss unresolved message\?/i)).toBeDefined();
    expect(screen.getByText(/Dismissing will remove this recovery reminder/i)).toBeDefined();
    expect(onDismiss).not.toHaveBeenCalled();

    // Confirm dismissal
    await act(async () => {
      fireEvent.click(screen.getByText(/Dismiss Reminder/i));
    });
    await waitFor(() => {
      expect(onDismiss).toHaveBeenCalledWith(sampleSingleOp);
    });
  });

  it('record failure causes 0 dispatches in single-message-send', async () => {
    const submitMessage = vi.fn();
    const mockBackend: ConversationBackend = {
      getBootstrapState: vi.fn(),
      createSession: vi.fn(),
      submitMessage,
      getConversation: vi.fn(),
      recordPendingOperation: vi.fn().mockRejectedValue(new Error('SQLite write failure')),
      listPendingOperations: vi.fn().mockResolvedValue({ operations: [], truncated: false }),
      clearPendingOperation: vi.fn().mockResolvedValue(undefined),
      setActiveAlternative: vi.fn().mockResolvedValue([]),
      setAnswerFeedback: vi.fn().mockResolvedValue([]),
    };

    const outcome = await performSingleMessageSend({
      backend: mockBackend,
      workspaceId: 'ws-1',
      projectId: 'proj-1',
      sessionId: 'sess-1',
      text: 'Test prompt',
      isStale: () => false,
    });

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.uncertain).toBe(false);
    }
    // CRITICAL: 0 dispatches occurred
    expect(submitMessage).not.toHaveBeenCalled();
  });

  it('record failure causes 0 dispatches in lazy-session-creation', async () => {
    const createSession = vi.fn();
    const submitMessage = vi.fn();
    const mockBackend: ConversationBackend = {
      getBootstrapState: vi.fn(),
      createSession,
      submitMessage,
      getConversation: vi.fn(),
      recordPendingOperation: vi.fn().mockRejectedValue(new Error('SQLite write failure')),
      listPendingOperations: vi.fn().mockResolvedValue({ operations: [], truncated: false }),
      clearPendingOperation: vi.fn().mockResolvedValue(undefined),
      setActiveAlternative: vi.fn().mockResolvedValue([]),
      setAnswerFeedback: vi.fn().mockResolvedValue([]),
    };

    const outcome = await performLazyFirstSend({
      backend: mockBackend,
      workspaceId: 'ws-1',
      projectId: 'proj-1',
      text: 'First prompt',
      isStale: () => false,
    });

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.uncertain).toBe(false);
    }
    // CRITICAL: 0 dispatches occurred
    expect(createSession).not.toHaveBeenCalled();
    expect(submitMessage).not.toHaveBeenCalled();
  });

  it('usePendingRecovery treats list errors as error state instead of empty list', async () => {
    const mockBackend: ConversationBackend = {
      getBootstrapState: vi.fn(),
      createSession: vi.fn(),
      submitMessage: vi.fn(),
      getConversation: vi.fn(),
      recordPendingOperation: vi.fn(),
      listPendingOperations: vi.fn().mockRejectedValue(new Error('Database unavailable')),
      clearPendingOperation: vi.fn().mockResolvedValue(undefined),
      setActiveAlternative: vi.fn().mockResolvedValue([]),
      setAnswerFeedback: vi.fn().mockResolvedValue([]),
    };

    const { result } = renderHook(() => usePendingRecovery({ backend: mockBackend }));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBe('Failed to check for unresolved messages.');
    expect(result.current.operations).toEqual([]);
  });

  it('usePendingRecovery controller guard prevents duplicate clicks during in-flight resend', async () => {
    let resolveSubmit!: () => void;
    const submitPromise = new Promise<{ messageId: string; text: string; createdAt: string }>(
      (resolve) => {
        resolveSubmit = () =>
          resolve({
            messageId: 'msg-1',
            text: 'Unresolved prompt text',
            createdAt: new Date().toISOString(),
          });
      },
    );

    const mockBackend: ConversationBackend = {
      getBootstrapState: vi.fn(),
      createSession: vi.fn(),
      submitMessage: vi.fn().mockImplementation(() => submitPromise),
      getConversation: vi.fn().mockResolvedValue({ items: [] }),
      recordPendingOperation: vi.fn(),
      listPendingOperations: vi
        .fn()
        .mockResolvedValue({ operations: [sampleSingleOp], truncated: false }),
      clearPendingOperation: vi.fn().mockResolvedValue(undefined),
      setActiveAlternative: vi.fn().mockResolvedValue([]),
      setAnswerFeedback: vi.fn().mockResolvedValue([]),
    };

    const { result } = renderHook(() => usePendingRecovery({ backend: mockBackend }));
    await waitFor(() => expect(result.current.operations.length).toBe(1));

    let firstRes: Promise<unknown>;
    let secondRes: Promise<unknown>;

    await act(async () => {
      firstRes = result.current.resendOperation(sampleSingleOp);
      secondRes = result.current.resendOperation(sampleSingleOp);
    });

    const secondOutcome = await secondRes!;
    expect(secondOutcome).toEqual({ ok: false, error: 'Operation already in flight.' });

    await act(async () => {
      resolveSubmit();
      const firstOutcome = await firstRes!;
      expect(firstOutcome).toEqual({ ok: true });
    });
    expect(mockBackend.submitMessage).toHaveBeenCalledTimes(1);
  });
});
