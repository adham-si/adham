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
  summary: z.string().nullable().default(null),
  summaryOrigin: z.string().nullable().default(null),
  summaryUnavailable: z.boolean().default(false),
  pinned: z.boolean().default(false),
  archived: z.boolean().default(false),
  lastActivityAt: z.string().default(''),
});

export const SessionListSchema = z.object({
  projectId: z.string(),
  sessions: z.array(SessionSummarySchema),
  truncated: z.boolean(),
  unreadableSummaries: z.number().int().nonnegative().default(0),
});

export const SessionMetadataSchema = z.object({
  sessionId: z.string(),
  projectId: z.string(),
  title: z.string().nullable(),
  summaryOrigin: z.string().nullable(),
  pinned: z.boolean(),
  archived: z.boolean(),
  createdAt: z.string(),
  lastActivityAt: z.string(),
});

export const ListSessionsOptionsSchema = z.object({
  includeArchived: z.boolean().optional(),
  activeSessionId: z.string().nullable().optional(),
});

export const SubmittedMessageSchema = z.object({
  messageId: z.string(),
  sessionId: z.string(),
  text: z.string(),
  createdAt: z.string(),
  streamSequence: z.string(),
  projectionPosition: z.string(),
});

export const MessageCompletionV1Schema = z.union([
  z.object({ Completed: z.object({ truncated: z.boolean() }) }),
  z.literal('Interrupted'),
  z.literal('Failed'),
]);

export const MessageReferenceDtoSchema = z.object({
  refersToMessageId: z.string(),
  relation: z.string(),
});

export const BranchSelectionSchema = z.object({
  rootMessageId: z.string(),
  activeMessageId: z.string(),
});

export const BranchSelectionListSchema = z.array(BranchSelectionSchema);

export const AnswerFeedbackSchema = z.object({
  messageId: z.string(),
  verdict: z.enum(['like', 'dislike']),
  reason: z.string().nullable(),
});

export const AnswerFeedbackListSchema = z.array(AnswerFeedbackSchema);

export const MessageAttachmentDtoSchema = z.object({
  attachmentId: z.string(),
  fileName: z.string(),
  mediaType: z.string(),
  byteSize: z.number().int(),
  contentHash: z.string(),
  hashAlgorithm: z.string(),
  extractedChars: z.number().int(),
  truncated: z.boolean(),
});

export const AttachmentDtoSchema = MessageAttachmentDtoSchema.extend({
  retention: z.string(),
  text: z.string(),
});

export const ConversationMessageDtoSchema = z.object({
  messageId: z.string(),
  role: z.string(),
  text: z.string(),
  createdAt: z.string(),
  sourceEventId: z.string(),
  completion: MessageCompletionV1Schema.nullable(),
  reference: MessageReferenceDtoSchema.nullable(),
  attachments: z.array(MessageAttachmentDtoSchema).default([]),
});

export const ConversationPageSchema = z.object({
  items: z.array(ConversationMessageDtoSchema),
  nextCursor: z.string().nullable(),
  projectionPosition: z.string(),
  branchSelections: z.array(BranchSelectionSchema),
  feedback: z.array(AnswerFeedbackSchema),
  bookmarkedMessageIds: z.array(z.string()).default([]),
});

export const BookmarkedMessageIdsSchema = z.array(z.string());

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

export const MarkCompletionInterruptedResponseSchema = z.object({
  status: z.string(),
});

// ===== Delivery A: provider commands + streaming completions =====

export const MessageUsageV1Schema = z.object({
  promptTokens: z.number().int().nonnegative().nullable(),
  completionTokens: z.number().int().nonnegative().nullable(),
  totalTokens: z.number().int().nonnegative().nullable(),
});

export const ProviderCapabilitiesDtoSchema = z.object({
  streaming: z.enum(['supported', 'unsupported', 'unknown']),
  structuredOutput: z.enum(['supported', 'unsupported', 'unknown']),
  toolProposals: z.enum(['supported', 'unsupported', 'unknown']),
  thinking: z.enum(['supported', 'unsupported', 'unknown']),
  imageInput: z.enum(['supported', 'unsupported', 'unknown']),
  // Documented `think` values from /api/show; null = no metadata.
  thinkingValues: z.array(z.string()).nullable(),
  thinkingDefault: z.string().nullable(),
});

export const ProviderModelEvidenceDtoSchema = z.object({
  source: z.string(),
  serverVersion: z.string().nullable(),
  observedAt: z.string().nullable(),
});

export const ProviderModelDtoSchema = z.object({
  modelId: z.string(),
  digest: z.string(),
  humanLabel: z.string(),
  privacyClass: z.string(),
  capabilities: ProviderCapabilitiesDtoSchema,
  contextLimit: z.number().int().positive().nullable(),
  configuredContext: z.number().int().positive().nullable(),
  effectiveContextBudget: z.number().int().positive().nullable(),
  evidence: ProviderModelEvidenceDtoSchema,
});

export const ProviderModelsListSchema = z.object({
  models: z.array(ProviderModelDtoSchema),
});

export const ProviderAccountDtoSchema = z.object({
  accountId: z.string(),
  alias: z.string(),
  endpointUrl: z.string(),
  privacyClass: z.string(),
  // additive Delivery G1: adapter family; branch on it, never on URL/model names
  kind: z.string(),
});

// Delivery G2: disconnect response (account removal confirmation only)
export const GoogleAccountDisconnectedSchema = z.object({
  accountId: z.string(),
});

export const OllamaAccountDisconnectedSchema = z.object({
  accountId: z.string(),
});

export const ProviderHealthResponseSchema = z.object({
  reachable: z.boolean(),
  modelTagCount: z.number().int().nonnegative(),
});

export const ContextAssemblyDtoSchema = z.object({
  estimatedInputTokens: z.number().int().nonnegative(),
  inputBudgetTokens: z.number().int().nonnegative().nullable(),
  droppedMessages: z.number().int().nonnegative(),
  attachmentsIncluded: z.number().int().nonnegative(),
  attachmentChars: z.number().int().nonnegative(),
});

export const CompletionStartDtoSchema = z.object({
  opId: z.string(),
  messageId: z.string(),
  context: ContextAssemblyDtoSchema.nullable(),
});

export const StopCompletionResponseSchema = z.object({
  opId: z.string(),
  status: z.string(),
});

export const StreamEventPayloadDtoSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('started') }),
  // Reasoning activity marker: payload-free by design (reasoning text never
  // crosses the IPC boundary).
  z.object({ type: z.literal('thinking') }),
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

export const ListProviderAccountsResponseSchema = z.object({
  accounts: z.array(ProviderAccountDtoSchema),
});
export const ListProviderModelsResponseSchema = z.object({
  models: z.array(ProviderModelDtoSchema),
});

export const ExportSessionResponseSchema = z.object({
  path: z.string(),
  bytes: z.number(),
});

export const DeleteSessionResponseSchema = z.object({
  sessionId: z.string(),
  deleted: z.boolean(),
});
