import { vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConversationPanel } from './conversation-panel';
import type { ConversationFakeBackend } from './conversation-test-utils';

// Panel-suite fixtures: a fake backend seeded with one persisted history row
// (the hook suite's conversation-test-utils has different seeds), plus a
// provider registry double. Kept here so the topical panel test files share
// one harness instead of copying it.

export function fakeBackend(): ConversationFakeBackend {
  return {
    getBootstrapState: vi.fn().mockResolvedValue({
      isInitialized: true,
      activeWorkspaceId: 'ws-1',
      activeProjectId: 'proj-1',
    }),
    createWorkspace: vi.fn(),
    createProject: vi.fn(),
    getStorageStatus: vi.fn(),
    createSession: vi.fn().mockResolvedValue({
      sessionId: 'sess-1',
      projectId: 'proj-1',
      title: null,
      createdAt: '2026-10-09T00:00:00Z',
    }),
    submitMessage: vi.fn().mockResolvedValue({
      messageId: 'msg-1',
      sessionId: 'sess-1',
      text: 'hello backend',
      createdAt: '2026-10-09T00:00:01Z',
      streamSequence: '1',
      projectionPosition: '1',
    }),
    getConversation: vi.fn().mockResolvedValue({
      items: [
        {
          messageId: 'msg-0',
          role: 'user',
          text: 'earlier truth',
          createdAt: '2026-10-09T00:00:00Z',
          sourceEventId: 'evt-0',
        },
      ],
      nextCursor: null,
      projectionPosition: '1',
    }),
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
        createdAt: '2026-10-09T00:00:00Z',
      }),
    ),
    listPendingOperations: vi.fn().mockResolvedValue({
      operations: [],
      truncated: false,
    }),
    clearPendingOperation: vi.fn().mockResolvedValue(undefined),
    setActiveAlternative: vi.fn().mockResolvedValue([]),
    setAnswerFeedback: vi.fn().mockResolvedValue([]),
    markCompletionInterrupted: vi.fn().mockResolvedValue({ status: 'interrupted' }),
  };
}

export type PanelProvider = NonNullable<Parameters<typeof ConversationPanel>[0]['provider']>;

/** Provider registry double with one pinned local model, mirroring Delivery A. */
export function registryProvider(
  thinking = 'unknown',
  thinkingValues: string[] | null = null,
): PanelProvider {
  return {
    listAccounts: vi.fn(async () => ({
      accounts: [
        {
          accountId: 'acc-1',
          alias: 'Local Ollama',
          endpointUrl: 'http://127.0.0.1:11434',
          privacyClass: 'local_only',
        },
      ],
    })),
    listModels: vi.fn(async () => ({
      models: [
        {
          modelId: 'qwen2.5:latest',
          digest: 'sha256:abc',
          humanLabel: 'Qwen 2.5 (latest)',
          privacyClass: 'local_only',
          capabilities: {
            streaming: 'supported',
            structuredOutput: 'unknown',
            toolProposals: 'unknown',
            thinking,
            thinkingValues,
            thinkingDefault: null,
          },
        },
      ],
    })),
  } as unknown as PanelProvider;
}

export async function pickRegistryModel(user: ReturnType<typeof userEvent.setup>) {
  const trigger = await screen.findByRole('button', { name: 'Select a model' });
  await user.click(trigger);
  await user.click(await screen.findByRole('option', { name: /Qwen 2\.5 \(latest\)/i }));
}
