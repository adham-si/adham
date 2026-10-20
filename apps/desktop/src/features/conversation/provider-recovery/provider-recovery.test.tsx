import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, renderHook, waitFor, act } from '@testing-library/react';
import type { PendingOperationDto } from '@adham/contracts-generated';
import type { ConversationBackend } from '../conversation-scope';
import { ProviderRecoveryBanner } from './provider-recovery-banner';
import { useProviderRecovery } from './use-provider-recovery';

describe('Provider pending-operation recovery', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.restoreAllMocks();
  });

  // A crash-left provider dispatch handle: the op row exists, no terminal.
  const providerOp: PendingOperationDto = {
    operationId: '01a14a4e-912d-728d-9a5b-235e6098ccb0',
    kind: 'provider-completion',
    workspaceId: 'ws-1',
    projectId: 'proj-1',
    sessionId: 'sess-1',
    createRequestId: null,
    messageRequestId: '01a14a4e-9400-728d-9a5b-235e6098ccb1',
    text: '',
    title: null,
    status: 'pending',
    createdAt: '2026-10-17T10:00:00Z',
  };

  const messageOp: PendingOperationDto = {
    ...providerOp,
    operationId: 'op-message-1',
    kind: 'single_message',
    text: 'unsent draft',
  };

  const resolvedProviderOp: PendingOperationDto = {
    ...providerOp,
    operationId: 'op-resolved-1',
    status: 'resolved',
  };

  function backendWith(operations: PendingOperationDto[]): {
    backend: ConversationBackend;
    mark: ReturnType<typeof vi.fn>;
    list: ReturnType<typeof vi.fn>;
  } {
    const mark = vi.fn().mockResolvedValue({ status: 'interrupted' });
    const list = vi.fn().mockResolvedValue({ operations, truncated: false });
    const backend = {
      listPendingOperations: list,
      markCompletionInterrupted: mark,
    } as unknown as ConversationBackend;
    return { backend, mark, list };
  }

  it('lists only pending provider-completion operations and closes them with the recorded scope', async () => {
    const { backend, mark, list } = backendWith([providerOp, messageOp, resolvedProviderOp]);
    const { result } = renderHook(() => useProviderRecovery({ backend }));

    await waitFor(() => expect(result.current.operations).toHaveLength(1));
    expect(result.current.operations[0]?.operationId).toBe(providerOp.operationId);

    const captured: { result?: { ok: boolean; error?: string } } = {};
    await act(async () => {
      captured.result = await result.current.markInterrupted(providerOp);
    });

    expect(captured.result).toEqual({ ok: true });
    expect(mark).toHaveBeenCalledWith('ws-1', 'proj-1', 'sess-1', {
      operationId: providerOp.operationId,
      expectedMessageRequestId: providerOp.messageRequestId,
    });
    // Refreshed after the terminal so the banner cannot keep showing a closed op.
    await waitFor(() => expect(list.mock.calls.length).toBeGreaterThanOrEqual(2));
  });

  it('surfaces a failed close without claiming success', async () => {
    const { backend, mark } = backendWith([providerOp]);
    mark.mockRejectedValueOnce(new Error('CONFLICT: completion operation is still running'));
    const { result } = renderHook(() => useProviderRecovery({ backend }));
    await waitFor(() => expect(result.current.operations).toHaveLength(1));

    const captured: { result?: { ok: boolean; error?: string } } = {};
    await act(async () => {
      captured.result = await result.current.markInterrupted(providerOp);
    });

    expect(captured.result?.ok).toBe(false);
    expect(captured.result?.error).toContain('still running');
  });

  it('surfaces a failed list read and retries on demand', async () => {
    const list = vi.fn().mockRejectedValueOnce(new Error('ipc down'));
    const backend = { listPendingOperations: list } as unknown as ConversationBackend;
    const { result } = renderHook(() => useProviderRecovery({ backend }));

    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.operations).toHaveLength(0);

    list.mockResolvedValueOnce({ operations: [providerOp], truncated: false });
    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.error).toBeNull();
    expect(result.current.operations).toHaveLength(1);
  });

  it('renders nothing without stale operations or errors', () => {
    const { container } = render(
      <ProviderRecoveryBanner
        operations={[]}
        error={null}
        busyOperationId={null}
        onRetry={vi.fn()}
        onMarkInterrupted={vi.fn()}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('requires the explicit review confirm before closing the operation', async () => {
    const onMarkInterrupted = vi.fn().mockResolvedValue({ ok: true });
    render(
      <ProviderRecoveryBanner
        operations={[providerOp]}
        error={null}
        busyOperationId={null}
        onRetry={vi.fn()}
        onMarkInterrupted={onMarkInterrupted}
      />,
    );

    expect(screen.getByText(/Unfinished generation/i)).toBeDefined();
    expect(onMarkInterrupted).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /Review/i }));
    expect(screen.getByText(/Mark this generation interrupted\?/i)).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: /Mark interrupted/i }));
    await waitFor(() => expect(onMarkInterrupted).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(screen.queryByText(/Mark this generation interrupted\?/i)).toBeNull(),
    );
  });

  it('keeps the dialog open with the failure reason when the close is rejected', async () => {
    const onMarkInterrupted = vi.fn().mockResolvedValue({
      ok: false,
      error: 'CONFLICT: completion operation is still running',
    });
    render(
      <ProviderRecoveryBanner
        operations={[providerOp]}
        error={null}
        busyOperationId={null}
        onRetry={vi.fn()}
        onMarkInterrupted={onMarkInterrupted}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Review/i }));
    fireEvent.click(screen.getByRole('button', { name: /Mark interrupted/i }));

    await waitFor(() =>
      expect(screen.getByText(/CONFLICT: completion operation is still running/i)).toBeDefined(),
    );
    expect(screen.getByText(/Mark this generation interrupted\?/i)).toBeDefined();
  });

  it('offers retry when the list read failed', () => {
    const onRetry = vi.fn();
    render(
      <ProviderRecoveryBanner
        operations={[]}
        error="Failed to check for unfinished generations."
        busyOperationId={null}
        onRetry={onRetry}
        onMarkInterrupted={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Retry/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
