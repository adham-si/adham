import { vi } from 'vitest';

export function fakeBackend() {
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

export type ConversationTestBackend = ReturnType<typeof fakeBackend>;

export function submitIds(backend: ConversationTestBackend) {
  return backend.submitMessage.mock.calls.map(
    (call) => (call[4] as { requestId?: string } | undefined)?.requestId,
  );
}
