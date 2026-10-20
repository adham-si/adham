import type {
  AppPreferences,
  CommandContext,
  CommandResult,
  CompletionStartDto,
  ListProviderAccountsResponse,
  ListProviderModelsResponse,
  MarkCompletionInterruptedPayload,
  MarkCompletionInterruptedResponse,
  ProviderAccountDto,
  ProviderHealthResponse,
  ProviderModelsList,
  StopCompletionResponse,
  StreamEventDto,
} from '@adham/contracts-generated';
import { Channel, invoke } from '@tauri-apps/api/core';
import {
  CompletionStartDtoSchema,
  GoogleAccountDisconnectedSchema,
  ListProviderAccountsResponseSchema,
  ListProviderModelsResponseSchema,
  MarkCompletionInterruptedResponseSchema,
  OllamaAccountDisconnectedSchema,
  ProviderAccountDtoSchema,
  ProviderHealthResponseSchema,
  ProviderModelsListSchema,
  StopCompletionResponseSchema,
  StreamEventDtoSchema,
} from './schemas';
import { AdhamApiClientBase } from './adham-client-base';

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
} from '@adham/contracts-generated';

export type { AdhamClient, ErrorEnvelope } from './adham-client-base';

export class AdhamApiClient extends AdhamApiClientBase {
  /** These methods cross module boundaries as values (`const start =
   *  backend.completeOnceStreaming`), which drops the receiver; binding here
   *  keeps `this.wrapCommand` defined for every caller. */
  constructor() {
    super();
    this.completeOnceStreaming = this.completeOnceStreaming.bind(this);
    this.retryCompletionStreaming = this.retryCompletionStreaming.bind(this);
    this.stopCompletion = this.stopCompletion.bind(this);
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
