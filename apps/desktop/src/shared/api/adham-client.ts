import { Channel, invoke } from '@tauri-apps/api/core';
import type {
  AppPreferences,
  BootstrapState,
  CommandContext,
  ClearPendingOperationPayload,
  CommandEnvelope,
  CommandResult,
  CompletionStartDto,
  ConversationMessageDto,
  ListProviderAccountsResponse,
  ListProviderModelsResponse,
  ConversationPage,
  GetPreferencesResponse,
  MarkCompletionInterruptedPayload,
  MarkCompletionInterruptedResponse,
  PendingOperationDto,
  PendingOperationList,
  ProjectList,
  PlatformInfo,
  ProviderAccountDto,
  ProviderHealthResponse,
  ProviderModelDto,
  ProviderModelsList,
  ProjectSummary,
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
import {
  BootstrapStateSchema,
  ConversationPageSchema,
  GetPreferencesResponseSchema,
  PendingOperationDtoSchema,
  PendingOperationListSchema,
  ProjectListSchema,
  PlatformInfoSchema,
  ProjectSummarySchema,
  RebuildProjectionsResponseSchema,
  ResetPreferencesResponseSchema,
  SessionListSchema,
  SessionSummarySchema,
  StorageStatusSchema,
  SubmittedMessageSchema,
  UpdatePreferencesResponseSchema,
  WorkspaceListSchema,
  WorkspaceSummarySchema,
  CompletionStartDtoSchema,
  ListProviderAccountsResponseSchema,
  ListProviderModelsResponseSchema,
  MarkCompletionInterruptedResponseSchema,
  ProviderAccountDtoSchema,
  ProviderHealthResponseSchema,
  ProviderModelsListSchema,
  StopCompletionResponseSchema,
  StreamEventDtoSchema,
} from './schemas';

export type {
  AppPreferences,
  BootstrapState,
  CommandContext,
  CommandEnvelope,
  CommandResult,
  CompletionStartDto,
  ConversationMessageDto,
  ListProviderAccountsResponse,
  ListProviderModelsResponse,
  ConversationPage,
  GetPreferencesResponse,
  PlatformInfo,
  ProviderAccountDto,
  ProviderHealthResponse,
  ProviderModelDto,
  ProviderModelsList,
  ProjectSummary,
  RebuildProjectionsResponse,
  ResetPreferencesResponse,
  SessionList,
  ClearPendingOperationPayload,
  PendingOperationDto,
  PendingOperationList,
  RecordPendingOperationPayload,
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
    payload: { text: string },
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

  private sessionContext(
    workspaceId: string,
    projectId: string,
    sessionId: string,
  ): CommandContext {
    return { workspaceId, projectId, sessionId };
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
    const envelope = this.wrapCommand({ accountId }, context, options?.requestId);
    const result = await invoke<CommandResult<ListProviderModelsResponse>>('list_provider_models', {
      request: envelope,
    });
    return ListProviderModelsResponseSchema.parse(result.data);
  }

  async testProviderConnection(
    accountId: string,
    context?: CommandContext,
    options?: { requestId?: string; endpointUrl?: string },
  ): Promise<ProviderHealthResponse> {
    const envelope = this.wrapCommand(
      { accountId, endpointUrl: options?.endpointUrl ?? null },
      context,
      options?.requestId,
    );
    const result = await invoke<CommandResult<ProviderHealthResponse>>('test_provider_connection', {
      request: envelope,
    });
    return ProviderHealthResponseSchema.parse(result.data);
  }

  async discoverOllamaModels(
    accountId: string,
    context?: CommandContext,
    options?: { requestId?: string },
  ): Promise<ProviderModelsList> {
    const envelope = this.wrapCommand({ accountId }, context, options?.requestId);
    const result = await invoke<CommandResult<ProviderModelsList>>('discover_ollama_models', {
      request: envelope,
    });
    return ProviderModelsListSchema.parse(result.data);
  }

  async updateProviderAccount(
    payload: { accountId: string | null; alias: string | null; endpointUrl: string | null },
    context: { workspaceId?: string; projectId?: string | null; sessionId?: string | null },
    options?: { requestId?: string },
  ): Promise<ProviderAccountDto> {
    const envelope = this.wrapCommand(
      payload,
      {
        workspaceId: context.workspaceId ?? null,
        projectId: context.projectId ?? null,
        sessionId: context.sessionId ?? null,
      },
      options?.requestId,
    );
    const result = await invoke<CommandResult<ProviderAccountDto>>('update_provider_account', {
      request: envelope,
    });
    return ProviderAccountDtoSchema.parse(result.data);
  }

  async completeOnceStreaming(
    workspaceId: string,
    projectId: string,
    sessionId: string,
    payload: { accountId: string; modelId: string; text: string },
    onEvent: (event: StreamEventDto) => void,
    options?: { requestId?: string },
  ): Promise<CompletionStartDto> {
    const channel = new Channel<unknown>((raw) => {
      onEvent(StreamEventDtoSchema.parse(raw));
    });
    const envelope = this.wrapCommand(
      payload,
      this.sessionContext(workspaceId, projectId, sessionId),
      options?.requestId,
    );
    const result = await invoke<CommandResult<CompletionStartDto>>('complete_once_streaming', {
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
      this.sessionContext(workspaceId, projectId, sessionId),
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
      this.sessionContext(workspaceId, projectId, sessionId),
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
