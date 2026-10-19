import { vi, type Mock } from 'vitest';
import type { ConversationBackend } from './use-conversation';

// Streaming dispatch signatures straight from the real backend contract, so
// test double assignments typecheck exactly like production wiring.
export type CompletionStreamFn = NonNullable<ConversationBackend['completeOnceStreaming']>;
export type RetryCompletionFn = NonNullable<ConversationBackend['retryCompletionStreaming']>;
export type StopCompletionFn = NonNullable<ConversationBackend['stopCompletion']>;
export type MarkCompletionInterruptedFn = NonNullable<
  ConversationBackend['markCompletionInterrupted']
>;
/** The stream-event callback parameter of the completion dispatch. */
export type StreamEventParam = Parameters<CompletionStreamFn>[4];
// Explicit, publicly-nameable mock signatures: bare vi.fn() infers vitest's
// private Procedure type, which declaration emit (TS2883) cannot name.
// Argument tuples stay precise (call indexing and hook assignability);
// returns stay `any`, exactly as permissive as the previous inference,
// so deferred-resolve helpers typed `(value: unknown) => void` keep working.
export interface ConversationFakeBackend {
  getBootstrapState: Mock<() => any>;
  createWorkspace: Mock<(...args: any[]) => any>;
  createProject: Mock<(...args: any[]) => any>;
  createSession: Mock<
    (
      workspaceId: string,
      projectId: string,
      payload: { title: string | null },
      options?: { requestId?: string },
    ) => any
  >;
  submitMessage: Mock<
    (
      workspaceId: string,
      projectId: string,
      sessionId: string,
      payload: { text: string },
      options?: { requestId?: string },
    ) => any
  >;
  getConversation: Mock<(workspaceId: string, projectId: string, sessionId: string) => any>;
  setActiveAlternative: Mock<
    (
      workspaceId: string,
      projectId: string,
      sessionId: string,
      rootMessageId: string,
      activeMessageId: string,
    ) => any
  >;
  setAnswerFeedback: Mock<
    (
      workspaceId: string,
      projectId: string,
      sessionId: string,
      messageId: string,
      verdict: 'like' | 'dislike' | null,
      reason: string | null,
    ) => any
  >;
  listSessions: Mock<(...args: any[]) => any>;
  getStorageStatus: Mock<(...args: any[]) => any>;
  recordPendingOperation: Mock<(...args: any[]) => any>;
  listPendingOperations: Mock<() => any>;
  clearPendingOperation: Mock<(...args: any[]) => any>;
  // Optional: absent means the capability gate stays closed, matching the
  // contract represented by `ConversationBackend` itself.
  completeOnceStreaming?: Mock<CompletionStreamFn>;
  retryCompletionStreaming?: Mock<RetryCompletionFn>;
  stopCompletion?: Mock<StopCompletionFn>;
  markCompletionInterrupted?: Mock<MarkCompletionInterruptedFn>;
  ingestAttachment?: Mock<
    (
      workspaceId: string,
      projectId: string,
      sessionId: string,
      payload: { fileName: string; text: string },
    ) => any
  >;
  ingestAttachmentPath?: Mock<(...args: any[]) => any>;
  readAttachmentText?: Mock<(...args: any[]) => any>;
}

export function fakeBackend(): ConversationFakeBackend {
  return {
    getBootstrapState: vi.fn().mockResolvedValue({
      isInitialized: true,
      activeWorkspaceId: 'ws-1',
      activeProjectId: 'proj-1',
    }),
    createWorkspace: vi.fn(),
    createProject: vi.fn(),
    createSession: vi.fn().mockResolvedValue({
      sessionId: 'sess-1',
      projectId: 'proj-1',
      title: null,
      createdAt: '2026-10-09T00:00:00Z',
    }),
    submitMessage: vi.fn().mockResolvedValue({
      messageId: 'msg-1',
      sessionId: 'sess-1',
      text: 'hello',
      createdAt: '2026-10-09T00:00:01Z',
      streamSequence: '1',
      projectionPosition: '1',
    }),
    getConversation: vi.fn().mockResolvedValue({
      items: [],
      nextCursor: null,
      projectionPosition: '0',
    }),
    setActiveAlternative: vi.fn().mockResolvedValue([]),
    setAnswerFeedback: vi.fn().mockResolvedValue([]),
    listSessions: vi.fn().mockResolvedValue({
      sessions: [
        {
          sessionId: 'sess-1',
          title: null,
          createdAt: '2026-10-09T00:00:00Z',
        },
      ],
      truncated: false,
    }),
    getStorageStatus: vi.fn(),
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
        createdAt: new Date().toISOString(),
      }),
    ),
    listPendingOperations: vi.fn().mockResolvedValue({
      operations: [],
      truncated: false,
    }),
    clearPendingOperation: vi.fn().mockResolvedValue(undefined),
    ingestAttachment: vi.fn().mockImplementation((_ws, _proj, _session, payload) =>
      Promise.resolve({
        attachmentId: 'att-1',
        fileName: payload.fileName,
        mediaType: 'text/markdown',
        byteSize: payload.text.length,
        contentHash: 'hash-1',
        hashAlgorithm: 'blake3',
        extractedChars: payload.text.length,
        truncated: false,
        retention: 'session',
        text: payload.text,
      }),
    ),
    readAttachmentText: vi.fn(),
  };
}

export type ConversationTestBackend = ConversationFakeBackend;

export function submitIds(backend: ConversationTestBackend) {
  return backend.submitMessage.mock.calls.map(
    (call) => (call[4] as { requestId?: string } | undefined)?.requestId,
  );
}
