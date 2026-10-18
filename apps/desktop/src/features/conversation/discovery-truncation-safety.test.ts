import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { ConversationBackend } from './conversation-scope';
import { performLazyFirstSend } from './lazy-session-creation';
import { performSingleMessageSend } from './single-message-send';
import type { PendingOperationDto } from '@adham/contracts-generated';

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
});

function createMockBackend(overrides?: Partial<ConversationBackend>): ConversationBackend {
  return {
    getBootstrapState: vi.fn(),
    createSession: vi.fn().mockResolvedValue({
      sessionId: 'sess-new',
      projectId: 'proj-1',
      title: null,
      createdAt: '2026-10-14T00:00:00Z',
    }),
    submitMessage: vi.fn().mockResolvedValue({
      messageId: 'msg-new',
      sessionId: 'sess-new',
      text: 'hello',
      createdAt: '2026-10-14T00:00:00Z',
    }),
    getConversation: vi.fn(),
    listSessions: vi.fn().mockResolvedValue({ sessions: [], truncated: false }),
    recordPendingOperation: vi.fn().mockResolvedValue({} as PendingOperationDto),
    listPendingOperations: vi.fn().mockResolvedValue({ operations: [], truncated: false }),
    clearPendingOperation: vi.fn().mockResolvedValue(undefined),
    setActiveAlternative: vi.fn().mockResolvedValue([]),
    setAnswerFeedback: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
}

describe('Discovery truncation safety and frozen creation ID enforcement', () => {
  it('single-message send fails closed when discovery is truncated without matching active operation', async () => {
    const backend = createMockBackend({
      listPendingOperations: vi.fn().mockResolvedValue({
        operations: [],
        truncated: true,
      }),
    });

    const result = await performSingleMessageSend({
      backend,
      workspaceId: 'ws-1',
      projectId: 'proj-1',
      sessionId: 'sess-1',
      text: 'Prompt while discovery is truncated',
      isStale: () => false,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.uncertain).toBe(true);
      expect(result.error).toMatch(/reload/i);
    }
    expect(backend.recordPendingOperation).not.toHaveBeenCalled();
    expect(backend.submitMessage).not.toHaveBeenCalled();
  });

  it('lazy first-send fails closed when discovery is truncated without matching active operation', async () => {
    const backend = createMockBackend({
      listPendingOperations: vi.fn().mockResolvedValue({
        operations: [],
        truncated: true,
      }),
    });

    const result = await performLazyFirstSend({
      backend,
      workspaceId: 'ws-1',
      projectId: 'proj-1',
      text: 'First send prompt while discovery is truncated',
      isStale: () => false,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.uncertain).toBe(true);
      expect(result.error).toMatch(/reload/i);
    }
    expect(backend.recordPendingOperation).not.toHaveBeenCalled();
    expect(backend.createSession).not.toHaveBeenCalled();
    expect(backend.submitMessage).not.toHaveBeenCalled();
  });

  it('lazy first-send rejects missing frozen createRequestId instead of generating replacement', async () => {
    const pendingWithoutCreateId: PendingOperationDto = {
      operationId: 'op-missing-create-id',
      kind: 'first_send',
      workspaceId: 'ws-1',
      projectId: 'proj-1',
      sessionId: null,
      messageRequestId: 'msg-req-existing',
      createRequestId: null, // missing frozen creation ID!
      text: 'Matching prompt text',
      title: 'Title',
      status: 'pending',
      createdAt: '2026-10-14T00:00:00Z',
    };

    const backend = createMockBackend({
      listPendingOperations: vi.fn().mockResolvedValue({
        operations: [pendingWithoutCreateId],
        truncated: false,
      }),
    });

    const result = await performLazyFirstSend({
      backend,
      workspaceId: 'ws-1',
      projectId: 'proj-1',
      text: 'Matching prompt text',
      isStale: () => false,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.uncertain).toBe(true);
      expect(result.error).toMatch(/reload/i);
    }
    // Must NOT proceed to create a session with a fabricated replacement ID
    expect(backend.createSession).not.toHaveBeenCalled();
    expect(backend.submitMessage).not.toHaveBeenCalled();
  });

  it('lazy first-send retains frozen createRequestId when present', async () => {
    const frozenCreateReqId = 'frozen-create-req-123';
    const frozenMsgReqId = 'frozen-msg-req-456';
    const pendingWithCreateId: PendingOperationDto = {
      operationId: 'op-valid',
      kind: 'first_send',
      workspaceId: 'ws-1',
      projectId: 'proj-1',
      sessionId: null,
      messageRequestId: frozenMsgReqId,
      createRequestId: frozenCreateReqId,
      text: 'Valid prompt text',
      title: 'Valid Title',
      status: 'pending',
      createdAt: '2026-10-14T00:00:00Z',
    };

    const backend = createMockBackend({
      listPendingOperations: vi.fn().mockResolvedValue({
        operations: [pendingWithCreateId],
        truncated: false,
      }),
    });

    const result = await performLazyFirstSend({
      backend,
      workspaceId: 'ws-1',
      projectId: 'proj-1',
      text: 'Valid prompt text',
      isStale: () => false,
    });

    expect(result.ok).toBe(true);
    expect(backend.createSession).toHaveBeenCalledWith(
      'ws-1',
      'proj-1',
      expect.objectContaining({ title: 'Valid Title' }),
      { requestId: frozenCreateReqId },
    );
    expect(backend.submitMessage).toHaveBeenCalledWith(
      'ws-1',
      'proj-1',
      'sess-new',
      { text: 'Valid prompt text' },
      { requestId: frozenMsgReqId },
    );
  });
});
