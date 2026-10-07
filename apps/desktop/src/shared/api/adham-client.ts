import { invoke } from '@tauri-apps/api/core';
import type {
  BootstrapState,
  CommandContext,
  CommandEnvelope,
  CommandResult,
  ConversationMessageDto,
  ConversationPage,
  ProjectSummary,
  SessionSummary,
  StorageStatus,
  SubmittedMessage,
  WorkspaceSummary,
} from '@adham/contracts-generated';
import {
  BootstrapStateSchema,
  ConversationPageSchema,
  ProjectSummarySchema,
  SessionSummarySchema,
  StorageStatusSchema,
  SubmittedMessageSchema,
  WorkspaceSummarySchema,
} from './schemas';

export type {
  BootstrapState,
  CommandContext,
  CommandEnvelope,
  CommandResult,
  ConversationMessageDto,
  ConversationPage,
  ProjectSummary,
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
  createWorkspace(payload: {
    name: string;
    kind: string;
    preferredLanguage: string;
  }): Promise<WorkspaceSummary>;
  createProject(
    workspaceId: string,
    payload: { name: string; storageKind: string },
  ): Promise<ProjectSummary>;
  createSession(
    workspaceId: string,
    projectId: string,
    payload: { title: string | null },
  ): Promise<SessionSummary>;
  submitMessage(
    workspaceId: string,
    projectId: string,
    sessionId: string,
    payload: { text: string },
  ): Promise<SubmittedMessage>;
  getConversation(
    workspaceId: string,
    projectId: string,
    sessionId: string,
    cursor?: string,
    limit?: number,
  ): Promise<ConversationPage>;
  getStorageStatus(): Promise<StorageStatus>;
}

export class AdhamApiClient implements AdhamClient {
  private wrapCommand<T>(
    payload: T,
    context: CommandContext = {
      workspaceId: null,
      projectId: null,
      sessionId: null,
    },
  ): CommandEnvelope<T> {
    return {
      protocolVersion: 1,
      requestId: generateRequestId(),
      context,
      payload,
    };
  }

  async getBootstrapState(): Promise<BootstrapState> {
    const raw = await invoke('get_bootstrap_state');
    return BootstrapStateSchema.parse(raw);
  }

  async createWorkspace(payload: {
    name: string;
    kind: string;
    preferredLanguage: string;
  }): Promise<WorkspaceSummary> {
    const envelope = this.wrapCommand(payload);
    const result = await invoke<CommandResult<WorkspaceSummary>>('create_workspace', {
      request: envelope,
    });
    return WorkspaceSummarySchema.parse(result.data);
  }

  async createProject(
    workspaceId: string,
    payload: { name: string; storageKind: string },
  ): Promise<ProjectSummary> {
    const envelope = this.wrapCommand(payload, {
      workspaceId,
      projectId: null,
      sessionId: null,
    });
    const result = await invoke<CommandResult<ProjectSummary>>('create_project', {
      request: envelope,
    });
    return ProjectSummarySchema.parse(result.data);
  }

  async createSession(
    workspaceId: string,
    projectId: string,
    payload: { title: string | null },
  ): Promise<SessionSummary> {
    const envelope = this.wrapCommand(payload, {
      workspaceId,
      projectId,
      sessionId: null,
    });
    const result = await invoke<CommandResult<SessionSummary>>('create_session', {
      request: envelope,
    });
    return SessionSummarySchema.parse(result.data);
  }

  async submitMessage(
    workspaceId: string,
    projectId: string,
    sessionId: string,
    payload: { text: string },
  ): Promise<SubmittedMessage> {
    const envelope = this.wrapCommand(payload, {
      workspaceId,
      projectId,
      sessionId,
    });
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
}

export const adhamClient = new AdhamApiClient();
