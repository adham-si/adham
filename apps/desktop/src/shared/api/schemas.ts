import { z } from 'zod';

export const ErrorEnvelopeSchema = z.object({
  protocolVersion: z.number().int(),
  code: z.string(),
  messageKey: z.string(),
  retryable: z.boolean(),
  correlationId: z.string(),
  fieldErrors: z.array(
    z.object({
      field: z.string(),
      code: z.string(),
      message: z.string(),
    }),
  ),
  retryAfterMs: z.number().int().optional(),
});

export const BootstrapStateSchema = z.object({
  isInitialized: z.boolean(),
  activeWorkspaceId: z.string().nullable(),
  activeProjectId: z.string().nullable(),
});

export const WorkspaceSummarySchema = z.object({
  workspaceId: z.string(),
  name: z.string(),
  kind: z.string(),
  preferredLanguage: z.string(),
  createdAt: z.string(),
});

export const ProjectSummarySchema = z.object({
  projectId: z.string(),
  workspaceId: z.string(),
  name: z.string(),
  storageKind: z.string(),
  createdAt: z.string(),
});

export const WorkspaceListSchema = z.object({
  workspaces: z.array(WorkspaceSummarySchema),
  truncated: z.boolean(),
});

export const ProjectListSchema = z.object({
  workspaceId: z.string(),
  projects: z.array(ProjectSummarySchema),
  truncated: z.boolean(),
});

export const SessionSummarySchema = z.object({
  sessionId: z.string(),
  projectId: z.string(),
  title: z.string().nullable(),
  createdAt: z.string(),
});

export const SubmittedMessageSchema = z.object({
  messageId: z.string(),
  sessionId: z.string(),
  text: z.string(),
  createdAt: z.string(),
  streamSequence: z.string(),
  projectionPosition: z.string(),
});

export const ConversationMessageDtoSchema = z.object({
  messageId: z.string(),
  role: z.string(),
  text: z.string(),
  createdAt: z.string(),
  sourceEventId: z.string(),
});

export const ConversationPageSchema = z.object({
  items: z.array(ConversationMessageDtoSchema),
  nextCursor: z.string().nullable(),
  projectionPosition: z.string(),
});

export const StorageStatusSchema = z.object({
  status: z.string(),
  journalMode: z.string(),
  schemaVersion: z.number().int(),
});
