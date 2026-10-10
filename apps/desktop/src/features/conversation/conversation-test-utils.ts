import { vi, type Mock } from 'vitest';

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
  getStorageStatus: Mock<(...args: any[]) => any>;
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
    getStorageStatus: vi.fn(),
  };
}

export type ConversationTestBackend = ConversationFakeBackend;

export function submitIds(backend: ConversationTestBackend) {
  return backend.submitMessage.mock.calls.map(
    (call) => (call[4] as { requestId?: string } | undefined)?.requestId,
  );
}
