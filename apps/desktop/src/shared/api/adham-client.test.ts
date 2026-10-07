import { describe, expect, it } from 'vitest';
import {
  BootstrapStateSchema,
  ConversationPageSchema,
  ErrorEnvelopeSchema,
  SubmittedMessageSchema,
} from './schemas';
import { queryKeys } from './query-keys';

describe('P0-04 IPC Schemas & Query Keys', () => {
  it('validates canonical query keys structure', () => {
    expect(queryKeys.bootstrap).toEqual(['bootstrap']);
    expect(queryKeys.storageStatus).toEqual(['storage-status']);
    expect(queryKeys.workspace('ws-123')).toEqual(['workspace', 'ws-123']);
    expect(queryKeys.projects('ws-123')).toEqual(['projects', 'ws-123']);
    expect(queryKeys.conversation('ws-1', 'proj-1', 'sess-1')).toEqual([
      'conversation',
      'ws-1',
      'proj-1',
      'sess-1',
    ]);
  });

  it('validates BootstrapStateSchema with valid and null states', () => {
    const uninit = BootstrapStateSchema.parse({
      isInitialized: false,
      activeWorkspaceId: null,
      activeProjectId: null,
    });
    expect(uninit.isInitialized).toBe(false);

    const init = BootstrapStateSchema.parse({
      isInitialized: true,
      activeWorkspaceId: 'ws-1',
      activeProjectId: 'proj-1',
    });
    expect(init.isInitialized).toBe(true);
    expect(init.activeWorkspaceId).toBe('ws-1');
  });

  it('validates SubmittedMessageSchema', () => {
    const msg = SubmittedMessageSchema.parse({
      messageId: '01925b68-0000-7000-8000-000000000001',
      sessionId: '01925b68-0000-7000-8000-000000000002',
      text: 'Hello Adham',
      createdAt: '2026-10-07T00:00:00Z',
      streamSequence: '1',
      projectionPosition: '1',
    });
    expect(msg.text).toBe('Hello Adham');
  });

  it('validates ConversationPageSchema with messages', () => {
    const page = ConversationPageSchema.parse({
      items: [
        {
          messageId: '01925b68-0000-7000-8000-000000000001',
          role: 'user',
          text: 'Hello Adham',
          createdAt: '2026-10-07T00:00:00Z',
          sourceEventId: '01925b68-0000-7000-8000-000000000003',
        },
      ],
      nextCursor: null,
      projectionPosition: '1',
    });
    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.role).toBe('user');
  });

  it('validates ErrorEnvelopeSchema', () => {
    const err = ErrorEnvelopeSchema.parse({
      protocolVersion: 1,
      code: 'VALIDATION_FAILED',
      messageKey: 'error.validationFailed',
      retryable: false,
      correlationId: '01925b68-0000-7000-8000-000000000004',
      fieldErrors: [],
    });
    expect(err.code).toBe('VALIDATION_FAILED');
    expect(err.retryable).toBe(false);
  });

  it('rejects malformed payloads with ZodError', () => {
    expect(() =>
      BootstrapStateSchema.parse({
        isInitialized: 'not-a-bool',
      }),
    ).toThrow();
  });
});
