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
  installationId: z.string().nullable().default(null),
});

export const PlatformInfoSchema = z.object({
  os: z.string(),
  arch: z.string(),
  hasNativeTitlebarControls: z.boolean(),
  appVersion: z.string(),
  buildProfile: z.string(),
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

export const SessionListSchema = z.object({
  projectId: z.string(),
  sessions: z.array(SessionSummarySchema),
  truncated: z.boolean(),
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
  dataDir: z.string(),
});

export const AppPreferencesSchema = z.object({
  appearance: z.enum(['system', 'light', 'dark']),
  language: z.enum(['en', 'ar', 'zh-CN', 'ru']),
  fontFamily: z.enum(['default', 'system', 'serif', 'mono']),
  fontSize: z.enum(['sm', 'md', 'lg']),
  highContrast: z.enum(['system', 'enabled', 'disabled']),
  reducedMotion: z.enum(['system', 'reduce', 'no-preference']),
  enterToSend: z.boolean(),
});

export const GetPreferencesResponseSchema = z.object({
  preferences: AppPreferencesSchema,
  revision: z.number().int(),
});

export const UpdatePreferencesResponseSchema = GetPreferencesResponseSchema;

export const ResetPreferencesResponseSchema = GetPreferencesResponseSchema;

export type ValidatedAppPreferences = z.infer<typeof AppPreferencesSchema>;

export const RebuildProjectionsResponseSchema = z.object({
  replayedCount: z.number().int(),
});

export const PendingOperationDtoSchema = z.object({
  operationId: z.string(),
  kind: z.string(),
  workspaceId: z.string(),
  projectId: z.string(),
  sessionId: z.string().nullable(),
  createRequestId: z.string().nullable(),
  messageRequestId: z.string(),
  text: z.string(),
  title: z.string().nullable(),
  status: z.string(),
  createdAt: z.string(),
});

export const PendingOperationListSchema = z.object({
  operations: z.array(PendingOperationDtoSchema),
  truncated: z.boolean(),
});

// ===== Delivery A: provider commands + streaming completions =====

export const MessageUsageV1Schema = z.object({
  promptTokens: z.number().int().nonnegative().nullable(),
  completionTokens: z.number().int().nonnegative().nullable(),
  totalTokens: z.number().int().nonnegative().nullable(),
});

export const MessageCompletionV1Schema = z.union([
  z.object({ Completed: z.object({ truncated: z.boolean() }) }),
  z.literal('Interrupted'),
  z.literal('Failed'),
]);

export const ProviderCapabilitiesDtoSchema = z.object({
  streaming: z.enum(['supported', 'unsupported', 'unknown']),
  structuredOutput: z.enum(['supported', 'unsupported', 'unknown']),
  toolProposals: z.enum(['supported', 'unsupported', 'unknown']),
  thinking: z.enum(['supported', 'unsupported', 'unknown']),
});

export const ProviderModelDtoSchema = z.object({
  modelId: z.string(),
  digest: z.string(),
  humanLabel: z.string(),
  privacyClass: z.string(),
  capabilities: ProviderCapabilitiesDtoSchema,
});

export const ProviderModelsListSchema = z.object({
  models: z.array(ProviderModelDtoSchema),
});

export const ProviderAccountDtoSchema = z.object({
  accountId: z.string(),
  alias: z.string(),
  endpointUrl: z.string(),
  privacyClass: z.string(),
});

export const ProviderHealthResponseSchema = z.object({
  reachable: z.boolean(),
  modelTagCount: z.number().int().nonnegative(),
});

export const CompletionStartDtoSchema = z.object({
  opId: z.string(),
  messageId: z.string(),
});

export const StopCompletionResponseSchema = z.object({
  opId: z.string(),
  status: z.string(),
});

export const StreamEventPayloadDtoSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('started') }),
  z.object({ type: z.literal('delta'), text: z.string() }),
  z.object({
    type: z.literal('completed'),
    completion: z.enum(['completed', 'interrupted', 'failed']),
    truncated: z.boolean(),
    usage: MessageUsageV1Schema.nullable(),
  }),
]);

export const StreamEventDtoSchema = z.object({
  opId: z.string(),
  sequence: z.number().int().nonnegative(),
  event: StreamEventPayloadDtoSchema,
});

export type ValidatedStreamEvent = z.infer<typeof StreamEventDtoSchema>;
