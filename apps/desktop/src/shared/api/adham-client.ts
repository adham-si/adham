import { invoke } from '@tauri-apps/api/core';
import type {
  BootstrapState,
  CommandContext,
  ClearPendingOperationPayload,
  CommandEnvelope,
  CommandResult,
  ConversationMessageDto,
  ConversationPage,
  PendingOperationDto,
  PendingOperationList,
  ProjectList,
  PlatformInfo,
  ProjectSummary,
  RecordPendingOperationPayload,
  SelectProjectPayload,
  SessionList,
  SessionSummary,
  StorageStatus,
  SubmittedMessage,
  WorkspaceList,
  WorkspaceSummary,
} from '@adham/contracts-generated';
import {
  BootstrapStateSchema,
  ConversationPageSchema,
  PendingOperationDtoSchema,
  PendingOperationListSchema,
  ProjectListSchema,
  PlatformInfoSchema,
  ProjectSummarySchema,
  SessionListSchema,
  SessionSummarySchema,
  StorageStatusSchema,
  SubmittedMessageSchema,
  WorkspaceListSchema,
  WorkspaceSummarySchema,
} from './schemas';

export type {
  BootstrapState,
  CommandContext,
  CommandEnvelope,
  CommandResult,
  ConversationMessageDto,
  ConversationPage,
  PlatformInfo,
  ProjectSummary,
  SessionList,
  ClearPendingOperationPayload,
  PendingOperationDto,
  PendingOperationList,
  RecordPendingOperationPayload,
  SessionSummary,
  StorageStatus,
  SubmittedMessage,
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

export const adhamClient = new AdhamApiClient();
