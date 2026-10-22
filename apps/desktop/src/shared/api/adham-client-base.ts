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
  ConversationMessageDto,
  ConversationPage,
  GetPreferencesResponse,
  PendingOperationDto,
  PendingOperationList,
  PlatformInfo,
  ProjectList,
  ProjectSummary,
  ProviderModelDto,
  RebuildProjectionsResponse,
  RecordPendingOperationPayload,
  ResetPreferencesResponse,
  SelectProjectPayload,
  SessionList,
  SessionMetadata,
  SessionSummary,
  StorageStatus,
  SubmittedMessage,
  UpdatePreferencesResponse,
  WorkspaceList,
  WorkspaceSummary,
} from '@adham/contracts-generated';
import { invoke } from '@tauri-apps/api/core';
import {
  AnswerFeedbackListSchema,
  BookmarkedMessageIdsSchema,
  AttachmentDtoSchema,
  BootstrapStateSchema,
  BranchSelectionListSchema,
  ConversationPageSchema,
  GetPreferencesResponseSchema,
  PendingOperationDtoSchema,
  PendingOperationListSchema,
  PlatformInfoSchema,
  ProjectListSchema,
  ProjectSummarySchema,
  RebuildProjectionsResponseSchema,
  ResetPreferencesResponseSchema,
  SessionListSchema,
  SessionMetadataSchema,
  SessionSummarySchema,
  StorageStatusSchema,
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
  ConversationMessageDto,
  ConversationPage,
  GetPreferencesResponse,
  PendingOperationDto,
  PendingOperationList,
  PlatformInfo,
  ProjectSummary,
  ProviderModelDto,
  RebuildProjectionsResponse,
  RecordPendingOperationPayload,
  ResetPreferencesResponse,
  SessionList,
  SessionMetadata,
  SessionSummary,
  StorageStatus,
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
  listSessions(context: {
    workspaceId?: string;
    projectId: string;
    includeArchived?: boolean;
    activeSessionId?: string | null;
  }): Promise<SessionList>;
  renameSession(
    workspaceId: string,
    projectId: string,
    sessionId: string,
    title: string,
    options?: { requestId?: string },
  ): Promise<SessionMetadata>;
  setSessionPinned(
    workspaceId: string,
    projectId: string,
    sessionId: string,
    pinned: boolean,
    options?: { requestId?: string },
  ): Promise<SessionMetadata>;
  setSessionArchived(
    workspaceId: string,
    projectId: string,
    sessionId: string,
    archived: boolean,
    options?: { requestId?: string },
  ): Promise<SessionMetadata>;
  setSessionSummary(
    workspaceId: string,
    projectId: string,
    sessionId: string,
    summary: string | null,
    options?: { requestId?: string },
  ): Promise<SessionMetadata>;
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

export class AdhamApiClientBase implements AdhamClient {
  /** These methods cross module boundaries as values (`const start =
   *  backend.completeOnceStreaming`), which drops the receiver; binding here
   *  keeps `this.wrapCommand` defined for every caller. */
  constructor() {
    this.ingestAttachment = this.ingestAttachment.bind(this);
    this.ingestAttachmentPath = this.ingestAttachmentPath.bind(this);
  }

  protected wrapCommand<T>(
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

  async listSessions(context: {
    workspaceId?: string;
    projectId: string;
    includeArchived?: boolean;
    activeSessionId?: string | null;
  }): Promise<SessionList> {
    const result = await invoke<SessionList>('list_sessions', {
      context: {
        workspaceId: context.workspaceId ?? null,
        projectId: context.projectId,
        sessionId: null,
      },
      options: {
        includeArchived: context.includeArchived ?? false,
        activeSessionId: context.activeSessionId ?? null,
      },
    });
    return SessionListSchema.parse(result);
  }

  async renameSession(
    workspaceId: string,
    projectId: string,
    sessionId: string,
    title: string,
    options?: { requestId?: string },
  ): Promise<SessionMetadata> {
    const envelope = this.wrapCommand(
      { title },
      { workspaceId, projectId, sessionId },
      options?.requestId,
    );
    const result = await invoke<CommandResult<SessionMetadata>>('rename_session', {
      request: envelope,
    });
    return SessionMetadataSchema.parse(result.data);
  }

  async setSessionPinned(
    workspaceId: string,
    projectId: string,
    sessionId: string,
    pinned: boolean,
    options?: { requestId?: string },
  ): Promise<SessionMetadata> {
    const envelope = this.wrapCommand(
      { pinned },
      { workspaceId, projectId, sessionId },
      options?.requestId,
    );
    const result = await invoke<CommandResult<SessionMetadata>>('set_session_pinned', {
      request: envelope,
    });
    return SessionMetadataSchema.parse(result.data);
  }

  async setSessionArchived(
    workspaceId: string,
    projectId: string,
    sessionId: string,
    archived: boolean,
    options?: { requestId?: string },
  ): Promise<SessionMetadata> {
    const envelope = this.wrapCommand(
      { archived },
      { workspaceId, projectId, sessionId },
      options?.requestId,
    );
    const result = await invoke<CommandResult<SessionMetadata>>('set_session_archived', {
      request: envelope,
    });
    return SessionMetadataSchema.parse(result.data);
  }

  async setSessionSummary(
    workspaceId: string,
    projectId: string,
    sessionId: string,
    summary: string | null,
    options?: { requestId?: string },
  ): Promise<SessionMetadata> {
    const envelope = this.wrapCommand(
      { summary },
      { workspaceId, projectId, sessionId },
      options?.requestId,
    );
    const result = await invoke<CommandResult<SessionMetadata>>('set_session_summary', {
      request: envelope,
    });
    return SessionMetadataSchema.parse(result.data);
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

  async setMessageBookmark(
    workspaceId: string,
    projectId: string,
    sessionId: string,
    messageId: string,
    bookmarked: boolean,
  ): Promise<string[]> {
    const raw = await invoke('set_message_bookmark', {
      context: {
        workspaceId,
        projectId,
        sessionId,
      },
      payload: {
        messageId,
        bookmarked,
      },
    });
    return BookmarkedMessageIdsSchema.parse(raw);
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
}
