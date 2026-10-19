import type {
  AnswerFeedbackDto,
  AppPreferences,
  AttachmentDto,
  BootstrapState,
  BranchSelectionDto,
  ClearPendingOperationPayload,
  CommandContext,
  CommandEnvelope,
  CommandResult,
  CompletionStartDto,
  ConversationMessageDto,
  ConversationPage,
  GetPreferencesResponse,
  GoogleAccountDisconnected,
  ListProviderAccountsResponse,
  ListProviderModelsResponse,
  MarkCompletionInterruptedPayload,
  MarkCompletionInterruptedResponse,
  PendingOperationDto,
  PendingOperationList,
  PlatformInfo,
  ProjectList,
  ProjectSummary,
  ProviderAccountDto,
  ProviderHealthResponse,
  ProviderModelDto,
  ProviderModelsList,
  RebuildProjectionsResponse,
  RecordPendingOperationPayload,
  ResetPreferencesResponse,
  SelectProjectPayload,
  SessionList,
  SessionSummary,
  StopCompletionResponse,
  StorageStatus,
  StreamEventDto,
  SubmittedMessage,
  UpdatePreferencesResponse,
  WorkspaceList,
  WorkspaceSummary,
} from '@adham/contracts-generated';
import { Channel, invoke } from '@tauri-apps/api/core';
import {
  AnswerFeedbackListSchema,
  AttachmentDtoSchema,
  BootstrapStateSchema,
  BranchSelectionListSchema,
  CompletionStartDtoSchema,
  ConversationPageSchema,
  GetPreferencesResponseSchema,
  GoogleAccountDisconnectedSchema,
  ListProviderAccountsResponseSchema,
  ListProviderModelsResponseSchema,
  MarkCompletionInterruptedResponseSchema,
  OllamaAccountDisconnectedSchema,
  PendingOperationDtoSchema,
  PendingOperationListSchema,
  PlatformInfoSchema,
  ProjectListSchema,
  ProjectSummarySchema,
  ProviderAccountDtoSchema,
  ProviderHealthResponseSchema,
  ProviderModelsListSchema,
  RebuildProjectionsResponseSchema,
  ResetPreferencesResponseSchema,
  SessionListSchema,
  SessionSummarySchema,
  StopCompletionResponseSchema,
  StorageStatusSchema,
  StreamEventDtoSchema,
  SubmittedMessageSchema,
  UpdatePreferencesResponseSchema,
  WorkspaceListSchema,
  WorkspaceSummarySchema,
} from './schemas';

export type {
  AppPreferences,
  BootstrapState,
  ClearPendingOperationPayload,
  CommandContext,
  CommandEnvelope,
  CommandResult,
  CompletionStartDto,
  ConversationMessageDto,
  ConversationPage,
  GetPreferencesResponse,
  GoogleAccountDisconnected,
  ListProviderAccountsResponse,
  ListProviderModelsResponse,
  PendingOperationDto,
  PendingOperationList,
  PlatformInfo,
  ProjectSummary,
  ProviderAccountDto,
  ProviderHealthResponse,
  ProviderModelDto,
  ProviderModelsList,
  RebuildProjectionsResponse,
  RecordPendingOperationPayload,
  ResetPreferencesResponse,
  SessionList,
  SessionSummary,
  StopCompletionResponse,
  StorageStatus,
  StreamEventDto,
  SubmittedMessage,
  UpdatePreferencesResponse,
  WorkspaceSummary,
};

export interface ErrorEnvelope {
  protocolVersion: number;
  code: string;
  messageKey: string;
  retryable: boolean;
  correlationId: string;
  fieldErrors: Array<{ field: string; code: string; message: string }>;
  retryAfterMs?: number;
}

function generateRequestId(): string {
  return crypto.randomUUID();
}

export interface AdhamClient {
  getBootstrapState(): Promise<BootstrapState>;
  createWorkspace(
    payload: {
      name: string;
      kind: string;
      preferredLanguage: string;
    },
    options?: { requestId?: string },
  ): Promise<WorkspaceSummary>;
  createProject(
    workspaceId: string,
    payload: { name: string; storageKind: string },
    options?: { requestId?: string },
  ): Promise<ProjectSummary>;
  listWorkspaces(): Promise<WorkspaceList>;
  listProjects(workspaceId: string): Promise<ProjectList>;
  selectProject(
    workspaceId: string,
    payload: SelectProjectPayload,
    options?: { requestId?: string },
  ): Promise<BootstrapState>;
  createSession(
    workspaceId: string,
    projectId: string,
    payload: { title: string | null },
    options?: { requestId?: string },
  ): Promise<SessionSummary>;
  listSessions(context: { workspaceId?: string; projectId: string }): Promise<SessionList>;
  submitMessage(
    workspaceId: string,
    projectId: string,
    sessionId: string,
    payload: { text: string },
    options?: { requestId?: string },
  ): Promise<SubmittedMessage>;
  getConversation(
    workspaceId: string,
    projectId: string,
    sessionId: string,
    cursor?: string,
    limit?: number,
  ): Promise<ConversationPage>;
  getStorageStatus(): Promise<StorageStatus>;
  getPlatformInfo(): Promise<PlatformInfo>;
  getAppPreferences(): Promise<GetPreferencesResponse>;
  updateAppPreferences(
    preferences: AppPreferences,
    baseRevision: number,
  ): Promise<UpdatePreferencesResponse>;
  resetAppPreferences(): Promise<ResetPreferencesResponse>;
  adminRebuildProjections(): Promise<RebuildProjectionsResponse>;
  recordPendingOperation(
    workspaceId: string,
    projectId: string,
    payload: RecordPendingOperationPayload,
    options?: { requestId?: string; sessionId?: string | null },
  ): Promise<PendingOperationDto>;
  listPendingOperations(): Promise<PendingOperationList>;
  clearPendingOperation(
    payload: ClearPendingOperationPayload,
    options?: { requestId?: string },
  ): Promise<void>;
}

export class AdhamApiClient implements AdhamClient {
  private wrapCommand<T>(
    payload: T,
    context: CommandContext = {
      workspaceId: null,
      projectId: null,
      sessionId: null,
    },
    requestId: string = generateRequestId(),
  ): CommandEnvelope<T> {
    return {
      protocolVersion: 1,
      requestId,
      context,
      payload,
    };
  }

  async getBootstrapState(): Promise<BootstrapState> {
    const raw = await invoke('get_bootstrap_state');
    return BootstrapStateSchema.parse(raw);
  }

  async createWorkspace(
    payload: {
      name: string;
      kind: string;
      preferredLanguage: string;
    },
    options?: { requestId?: string },
  ): Promise<WorkspaceSummary> {
    const envelope = this.wrapCommand(payload, undefined, options?.requestId);
    const result = await invoke<CommandResult<WorkspaceSummary>>('create_workspace', {
      request: envelope,
    });
    return WorkspaceSummarySchema.parse(result.data);
  }

  async createProject(
    workspaceId: string,
    payload: { name: string; storageKind: string },
    options?: { requestId?: string },
  ): Promise<ProjectSummary> {
    const envelope = this.wrapCommand(
      payload,
      {
        workspaceId,
        projectId: null,
        sessionId: null,
      },
      options?.requestId,
    );
    const result = await invoke<CommandResult<ProjectSummary>>('create_project', {
      request: envelope,
    });
    return ProjectSummarySchema.parse(result.data);
  }

  async listWorkspaces(): Promise<WorkspaceList> {
    const raw = await invoke('list_workspaces');
    return WorkspaceListSchema.parse(raw);
  }

  async listProjects(workspaceId: string): Promise<ProjectList> {
    const raw = await invoke('list_projects', {
      context: {
        workspaceId,
        projectId: null,
        sessionId: null,
      },
    });
    return ProjectListSchema.parse(raw);
  }

  async selectProject(
    workspaceId: string,
    payload: SelectProjectPayload,
    options?: { requestId?: string },
  ): Promise<BootstrapState> {
    const envelope = this.wrapCommand(
      payload,
      {
        workspaceId,
        projectId: null,
        sessionId: null,
      },
      options?.requestId,
    );
    const result = await invoke<CommandResult<BootstrapState>>('select_project', {
      request: envelope,
    });
    return BootstrapStateSchema.parse(result.data);
  }

  async createSession(
    workspaceId: string,
    projectId: string,
    payload: { title: string | null },
    options?: { requestId?: string },
  ): Promise<SessionSummary> {
    const envelope = this.wrapCommand(
      payload,
      {
        workspaceId,
        projectId,
        sessionId: null,
      },
      options?.requestId,
    );
    const result = await invoke<CommandResult<SessionSummary>>('create_session', {
      request: envelope,
    });
    return SessionSummarySchema.parse(result.data);
  }

  async listSessions(context: { workspaceId?: string; projectId: string }): Promise<SessionList> {
    const result = await invoke<SessionList>('list_sessions', {
      context: {
        workspaceId: context.workspaceId ?? null,
        projectId: context.projectId,
        sessionId: null,
      },
    });
    return SessionListSchema.parse(result);
  }

  async submitMessage(
    workspaceId: string,
    projectId: string,
    sessionId: string,
    payload: { text: string; attachmentIds?: string[] },
    options?: { requestId?: string },
  ): Promise<SubmittedMessage> {
    const envelope = this.wrapCommand(
      payload,
      {
        workspaceId,
        projectId,
        sessionId,
      },
      options?.requestId,
    );
    const result = await invoke<CommandResult<SubmittedMessage>>('submit_message', {
      request: envelope,
    });
    return SubmittedMessageSchema.parse(result.data);
  }

  /** Bounded extraction of a picked/pasted text or code file into the
   *  session's protected attachment index. */
  async ingestAttachment(
    workspaceId: string,
    projectId: string,
    sessionId: string,
    payload: { fileName: string; text: string },
  ): Promise<AttachmentDto> {
    const envelope = this.wrapCommand(payload, { workspaceId, projectId, sessionId });
    const result = await invoke<CommandResult<AttachmentDto>>('ingest_attachment', {
      request: envelope,
    });
    return AttachmentDtoSchema.parse(result.data);
  }

  /** Bounded Rust-side read for a dropped filesystem path (no dialog plugin). */
  async ingestAttachmentPath(
    workspaceId: string,
    projectId: string,
    sessionId: string,
    payload: { filePath: string },
  ): Promise<AttachmentDto> {
    const envelope = this.wrapCommand(payload, { workspaceId, projectId, sessionId });
    const result = await invoke<CommandResult<AttachmentDto>>('ingest_attachment_path', {
      request: envelope,
    });
    return AttachmentDtoSchema.parse(result.data);
  }

  /** Rehydrate the exact extracted text a sent attachment carried. */
  async readAttachmentText(
    workspaceId: string,
    projectId: string,
    sessionId: string,
    attachmentId: string,
  ): Promise<AttachmentDto> {
    const envelope = this.wrapCommand({ attachmentId }, { workspaceId, projectId, sessionId });
    const result = await invoke<CommandResult<AttachmentDto>>('read_attachment_text', {
      request: envelope,
    });
    return AttachmentDtoSchema.parse(result.data);
  }

  async getConversation(
    workspaceId: string,
    projectId: string,
    sessionId: string,
    cursor?: string,
    limit?: number,
  ): Promise<ConversationPage> {
    const raw = await invoke('get_conversation', {
      context: {
        workspaceId,
        projectId,
        sessionId,
      },
      cursor,
      limit,
    });
    return ConversationPageSchema.parse(raw);
  }

  /** Record which member of an edited branch the session continues from.
   *  Returns the session's selections after the write (the server validates
   *  every id against the session's rows and refuses otherwise). */
  async setActiveAlternative(
    workspaceId: string,
    projectId: string,
    sessionId: string,
    rootMessageId: string,
    activeMessageId: string,
  ): Promise<BranchSelectionDto[]> {
    const raw = await invoke('set_active_alternative', {
      context: {
        workspaceId,
        projectId,
        sessionId,
      },
      payload: {
        rootMessageId,
        activeMessageId,
      },
    });
    return BranchSelectionListSchema.parse(raw);
  }

  /** Record, switch, or remove (verdict null) the local verdict for one
   *  answer row. Returns the session's feedback after the write (the server
   *  validates the row against the session's persisted answers). */
  async setAnswerFeedback(
    workspaceId: string,
    projectId: string,
    sessionId: string,
    messageId: string,
    verdict: 'like' | 'dislike' | null,
    reason: string | null,
  ): Promise<AnswerFeedbackDto[]> {
    const raw = await invoke('set_answer_feedback', {
      context: {
        workspaceId,
        projectId,
        sessionId,
      },
      payload: {
        messageId,
        verdict,
        reason,
      },
    });
    return AnswerFeedbackListSchema.parse(raw);
  }

  async getStorageStatus(): Promise<StorageStatus> {
    const raw = await invoke('get_storage_status');
    return StorageStatusSchema.parse(raw);
  }

  async getPlatformInfo(): Promise<PlatformInfo> {
    const raw = await invoke('get_platform_info');
    return PlatformInfoSchema.parse(raw);
  }

  async getAppPreferences(): Promise<GetPreferencesResponse> {
    const raw = await invoke('get_app_preferences');
    return GetPreferencesResponseSchema.parse(raw);
  }

  async updateAppPreferences(
    preferences: AppPreferences,
    baseRevision: number,
  ): Promise<UpdatePreferencesResponse> {
    const raw = await invoke('update_app_preferences', {
      payload: { preferences, baseRevision },
    });
    return UpdatePreferencesResponseSchema.parse(raw);
  }

  async resetAppPreferences(): Promise<ResetPreferencesResponse> {
    const raw = await invoke('reset_app_preferences');
    return ResetPreferencesResponseSchema.parse(raw);
  }

  async adminRebuildProjections(): Promise<RebuildProjectionsResponse> {
    const raw = await invoke('admin_rebuild_projections');
    return RebuildProjectionsResponseSchema.parse(raw);
  }

  async recordPendingOperation(
    workspaceId: string,
    projectId: string,
    payload: RecordPendingOperationPayload,
    options?: { requestId?: string; sessionId?: string | null },
  ): Promise<PendingOperationDto> {
    const raw = (await invoke('record_pending_operation', {
      request: this.wrapCommand(
        payload,
        {
          workspaceId,
          projectId,
          sessionId: options?.sessionId ?? null,
        },
        options?.requestId,
      ),
    })) as { data: unknown };
    return PendingOperationDtoSchema.parse(raw.data);
  }

  async listPendingOperations(): Promise<PendingOperationList> {
    const raw = await invoke('list_pending_operations');
    return PendingOperationListSchema.parse(raw);
  }

  async clearPendingOperation(
    payload: ClearPendingOperationPayload,
    options?: { requestId?: string },
  ): Promise<void> {
    await invoke('clear_pending_operation', {
      request: this.wrapCommand(payload, undefined, options?.requestId),
    });
  }

  // ===== Delivery A: provider commands =====

  /** Shared transport for JSON provider commands: wrap → invoke → zod parse;
   * context omitted means the app-level null scope (settings surface). */
  private async sendCommand<T>(
    command: string,
    payload: unknown,
    schema: { parse: (raw: unknown) => T },
    context?: CommandContext,
    requestId?: string,
  ): Promise<T> {
    const envelope = this.wrapCommand(payload, context, requestId);
    const result = await invoke<CommandResult<T>>(command, { request: envelope });
    return schema.parse(result.data);
  }

  async listProviderAccounts(): Promise<ListProviderAccountsResponse> {
    const raw = (await invoke('list_provider_accounts')) as unknown;
    return ListProviderAccountsResponseSchema.parse((raw as { data: unknown }).data);
  }

  async listProviderModels(
    accountId: string,
    context?: CommandContext,
    options?: { requestId?: string },
  ): Promise<ListProviderModelsResponse> {
    return this.sendCommand(
      'list_provider_models',
      { accountId },
      ListProviderModelsResponseSchema,
      context,
      options?.requestId,
    );
  }

  async testProviderConnection(
    accountId: string,
    context?: CommandContext,
    options?: { requestId?: string; endpointUrl?: string },
  ): Promise<ProviderHealthResponse> {
    return this.sendCommand(
      'test_provider_connection',
      { accountId, endpointUrl: options?.endpointUrl ?? null },
      ProviderHealthResponseSchema,
      context,
      options?.requestId,
    );
  }

  async discoverOllamaModels(
    accountId: string,
    context?: CommandContext,
    options?: { requestId?: string },
  ): Promise<ProviderModelsList> {
    return this.sendCommand(
      'discover_ollama_models',
      { accountId },
      ProviderModelsListSchema,
      context,
      options?.requestId,
    );
  }

  async updateProviderAccount(
    payload: { accountId: string | null; alias: string | null; endpointUrl: string | null },
    context: { workspaceId?: string; projectId?: string | null; sessionId?: string | null },
    options?: { requestId?: string },
  ): Promise<ProviderAccountDto> {
    return this.sendCommand(
      'update_provider_account',
      payload,
      ProviderAccountDtoSchema,
      {
        workspaceId: context.workspaceId ?? null,
        projectId: context.projectId ?? null,
        sessionId: context.sessionId ?? null,
      },
      options?.requestId,
    );
  }

  /** G2: write-only Google configuration — the API key is sealed backend-side
   * and echoed back to nobody (the response carries no key material). */
  async configureGoogleAccount(
    payload: {
      accountId: string | null;
      alias: string | null;
      apiKey: string;
      acknowledgeCloudTransfer: boolean;
    },
    options?: { requestId?: string },
  ): Promise<ProviderAccountDto> {
    return this.sendCommand(
      'configure_google_account',
      payload,
      ProviderAccountDtoSchema,
      undefined,
      options?.requestId,
    );
  }

  /** G2: disconnect removes the Google account; models and the sealed key
   * cascade away on the backend. */
  async disconnectGoogleAccount(accountId: string, options?: { requestId?: string }) {
    return this.sendCommand(
      'disconnect_google_account',
      { accountId },
      GoogleAccountDisconnectedSchema,
      undefined,
      options?.requestId,
    );
  }

  async disconnectOllamaAccount(accountId: string, options?: { requestId?: string }) {
    return this.sendCommand(
      'disconnect_ollama_account',
      { accountId },
      OllamaAccountDisconnectedSchema,
      undefined,
      options?.requestId,
    );
  }

  async completeOnceStreaming(
    workspaceId: string,
    projectId: string,
    sessionId: string,
    payload: {
      accountId: string;
      modelId: string;
      text: string;
      mode: 'ask' | 'plan' | 'code' | 'execute';
      /** Documented thinking parameter value; omitted = model default. */
      think?: boolean | string;
      /** Durable reply/edit anchor recorded with this submission; the backend
       *  validates it against persisted history before any write. */
      reference?: { refersToMessageId: string; relation: 'replied' | 'edited-from' };
      /** Ingested attachment ids attached to this user turn. */
      attachmentIds?: string[];
    },
    onEvent: (event: StreamEventDto) => void,
    options?: { requestId?: string },
  ): Promise<CompletionStartDto> {
    const channel = new Channel<unknown>((raw) => {
      onEvent(StreamEventDtoSchema.parse(raw));
    });
    const envelope = this.wrapCommand(
      payload,
      { workspaceId, projectId, sessionId },
      options?.requestId,
    );
    const result = await invoke<CommandResult<CompletionStartDto>>('complete_once_streaming', {
      request: envelope,
      onEvent: channel,
    });
    return CompletionStartDtoSchema.parse(result.data);
  }

  /**
   * Retry/regenerate: a NEW assistant attempt for an existing user turn. The
   * backend keeps the user row and every previous attempt; `replyToMessageId`
   * only names the turn being answered again.
   */
  async retryCompletionStreaming(
    workspaceId: string,
    projectId: string,
    sessionId: string,
    payload: {
      accountId: string;
      modelId: string;
      replyToMessageId: string;
      mode: 'ask' | 'plan' | 'code' | 'execute';
      /** Documented thinking parameter value; omitted = model default. */
      think?: boolean | string;
    },
    onEvent: (event: StreamEventDto) => void,
    options?: { requestId?: string },
  ): Promise<CompletionStartDto> {
    const channel = new Channel<unknown>((raw) => {
      onEvent(StreamEventDtoSchema.parse(raw));
    });
    const envelope = this.wrapCommand(
      payload,
      { workspaceId, projectId, sessionId },
      options?.requestId,
    );
    const result = await invoke<CommandResult<CompletionStartDto>>('retry_completion_streaming', {
      request: envelope,
      onEvent: channel,
    });
    return CompletionStartDtoSchema.parse(result.data);
  }

  async stopCompletion(
    workspaceId: string,
    projectId: string,
    sessionId: string,
    opId: string,
    options?: { requestId?: string },
  ): Promise<StopCompletionResponse> {
    const envelope = this.wrapCommand(
      { opId },
      { workspaceId, projectId, sessionId },
      options?.requestId,
    );
    const result = await invoke<CommandResult<StopCompletionResponse>>('stop_completion', {
      request: envelope,
    });
    return StopCompletionResponseSchema.parse(result.data);
  }

  async markCompletionInterrupted(
    workspaceId: string,
    projectId: string,
    sessionId: string,
    payload: MarkCompletionInterruptedPayload,
    options?: { requestId?: string },
  ): Promise<MarkCompletionInterruptedResponse> {
    const envelope = this.wrapCommand(
      payload,
      { workspaceId, projectId, sessionId },
      options?.requestId,
    );
    const result = await invoke<CommandResult<MarkCompletionInterruptedResponse>>(
      'mark_completion_interrupted',
      { request: envelope },
    );
    return MarkCompletionInterruptedResponseSchema.parse(result.data);
  }
}

export const adhamClient = new AdhamApiClient();

/// Compiled installation defaults. Mirror of the backend
/// `AppPreferences::defaults`; used before the first backend read resolves
/// and as the fallback when the backend is unreachable.
export const DEFAULT_PREFERENCES: AppPreferences = {
  appearance: 'system',
  language: 'en',
  fontFamily: 'default',
  fontSize: 'md',
  highContrast: 'system',
  reducedMotion: 'system',
  enterToSend: true,
};
