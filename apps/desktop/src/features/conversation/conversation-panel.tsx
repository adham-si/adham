import * as React from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { MessageCard } from '@adham/ui';
import {
  Composer,
  EmptyWelcome,
  useDrafts,
  type ComposeAttachment,
  type ComposeMode,
  type ModelOption,
} from '@/widgets/compose';
import { adhamClient } from '@/shared/api/adham-client';
import { formatTime } from '@/shared/i18n/format';
import { useConversation, type ConversationBackend, type UiMessage } from './use-conversation';
import { adhamProviderBackend, useOllamaProvider, type ProviderBackend } from './provider-stream';
import { TurnStatus } from './turn-status';
import {
  announceScopeChanged,
  SCOPE_CHANGED_EVENT,
  useProvisioning,
  type ProvisioningBackend,
} from '../provisioning';
import { useSelection, type SelectionBackend } from '../workspace-selection';
import { ConversationSetupSlot } from './conversation-setup-slot';
import { submissionNotice } from './submission-notice';
import { readComposeModePreference, writeComposeModePreference } from './compose-mode-preference';
import {
  PendingRecoveryBanner,
  PendingRecoveryReviewDialog,
  usePendingRecovery,
} from './pending-recovery';
import { ProviderRecoveryBanner, useProviderRecovery } from './provider-recovery';

const PENDING_DRAFT_BUCKET = 'pending';

function formatTimestamp(createdAt: string): string {
  const parsed = new Date(createdAt);
  if (Number.isNaN(parsed.getTime())) return createdAt;
  return formatTime(parsed);
}

/**
 * Honest lifecycle note for a persisted assistant turn. Derived from the
 * stored completion only — never from text length or timing.
 */
function messageNote(m: UiMessage, t: TFunction): { text: string; tone: 'muted' | 'error' } | null {
  const completion = m.completion;
  if (!completion) return null;
  if (completion.state === 'interrupted') {
    return { text: t('conversation.turnInterrupted', 'Cancelled'), tone: 'muted' };
  }
  if (completion.state === 'failed') {
    return m.text === ''
      ? { text: t('conversation.turnNoAnswer', 'No answer was produced.'), tone: 'error' }
      : { text: t('conversation.turnFailed', 'Generation failed.'), tone: 'error' };
  }
  return completion.truncated
    ? { text: t('conversation.turnTruncated', 'Truncated by the length limit.'), tone: 'muted' }
    : null;
}

export interface ConversationPanelProps {
  backend?: ConversationBackend;
  /** Injectable provisioning backend for tests; defaults to the real client. */
  provisioning?: ProvisioningBackend;
  /** Injectable selection backend for tests; defaults to the real client. */
  selection?: SelectionBackend;
  /** Injectable provider-listing backend for tests; defaults to the IPC client. */
  provider?: ProviderBackend;
  /** Backend preference (Settings → Send message on Enter). Defaults to true. */
  enterToSend?: boolean | undefined;
}

/**
 * Production conversation surface. Renders backend-persisted messages only:
 * no simulated execution, no fabricated verification, no timer-driven agent
 * text. Execution, approval, and stop have no backend command and are
 * rendered unavailable instead of faked.
 */
export function ConversationPanel({
  backend = adhamClient,
  provisioning,
  selection,
  provider = adhamProviderBackend,
  enterToSend = true,
}: ConversationPanelProps) {
  const { t } = useTranslation();
  const conv = useConversation({ backend });
  const prov = useProvisioning({ backend: provisioning });
  const needsProvisioning = conv.status === 'needs-workspace' || conv.status === 'needs-project';
  const sel = useSelection({ backend: selection, enabled: needsProvisioning });

  const handleSessionOpened = React.useCallback(
    async (workspaceId: string, projectId: string, sessionId: string) => {
      const isCrossProject =
        conv.context &&
        (conv.context.workspaceId !== workspaceId || conv.context.projectId !== projectId);

      if (isCrossProject) {
        const selectOutcome = await sel.select(workspaceId, projectId);
        if (!selectOutcome.ok) return;
      }
      await conv.openSession(sessionId, { workspaceId, projectId });
    },
    [conv, sel],
  );

  const recovery = usePendingRecovery({
    backend,
    onSessionOpened: (workspaceId, projectId, sessionId) => {
      void handleSessionOpened(workspaceId, projectId, sessionId);
    },
  });
  const providerRecovery = useProviderRecovery({ backend });
  /// Committed creation or selection awaiting authoritative bootstrap.
  /// Holds the confirmed step disabled so a second action cannot fork a
  /// duplicate while the read is in flight. Cleared only when bootstrap
  /// advances; a read failure keeps it and shows a read-only retry (never
  /// a fresh creation or reselection).
  const [provisionTransition, setProvisionTransition] = React.useState<{
    step: 'workspace' | 'project';
    origin: 'created' | 'selected';
  } | null>(null);
  const { draft, setDraft, commitPrompt, recallPrevious, recallNext } = useDrafts({
    sessionId: conv.sessionId ?? PENDING_DRAFT_BUCKET,
  });
  const draftRef = React.useRef(draft);
  draftRef.current = draft;

  // Last-used mode is restored across launches; the previous default ('plan')
  // only applies on first run or after a stale/unreadable value.
  const [mode, setMode] = React.useState<ComposeMode>(() => readComposeModePreference() ?? 'plan');
  const handleChangeMode = React.useCallback((next: ComposeMode) => {
    setMode(next);
    writeComposeModePreference(next);
  }, []);
  // Model choice is explicit: '' until the user picks from the registry, and
  // discovery order never becomes a silent default.
  const [selectedModelId, setSelectedModelId] = React.useState('');
  const [reasoningEffort, setReasoningEffort] = React.useState<'low' | 'medium' | 'high'>('medium');
  const [attachments, setAttachments] = React.useState<ComposeAttachment[]>([]);
  const [stopNotice, setStopNotice] = React.useState(false);
  const [submitError, setSubmitError] = React.useState<string | null>(null);

  // Registry-driven picker: when an Ollama account has pinned models, the
  // composer options come from the provider registry (Delivery A). Without
  // registry models the picker is hidden and dispatch falls back to the
  // text-only path.
  const ollama = useOllamaProvider({
    backend: provider,
    context:
      conv.status === 'ready' && conv.context
        ? {
            workspaceId: conv.context.workspaceId,
            projectId: conv.context.projectId,
            sessionId: conv.context.sessionId,
          }
        : null,
    enabled: conv.status === 'ready',
  });
  const pickerModels: ModelOption[] = ollama.models.map((m) => ({
    id: m.modelId,
    name: m.humanLabel,
    provider: 'Ollama',
    boundary: 'local' as const,
    // Effort controls appear only for evidenced thinking support; unknown or
    // unsupported must not present a control the model may not honor.
    supportsReasoning: m.capabilities.thinking === 'supported',
  }));
  const selectedDescriptor = ollama.models.find((m) => m.modelId === selectedModelId) ?? null;
  const streamReady =
    ollama.ready && selectedModelId !== '' && pickerModels.some((m) => m.id === selectedModelId);

  const busy =
    conv.status === 'submitting' || conv.status === 'bootstrapping' || conv.streaming !== null;
  const refreshScope = conv.refreshScope;
  /// Workspace chosen for its first project (an existing workspace without
  /// projects). Project creation binds to it; the workspace itself is never
  /// recreated. Cleared once authoritative scope is ready.
  const [chosenWorkspaceId, setChosenWorkspaceId] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (conv.status === 'ready') setChosenWorkspaceId(null);
  }, [conv.status]);

  // A confirmed scope change (creation or selection, from any surface)
  // advances through the authoritative bootstrap. The announced step is
  // held until bootstrap moves past it; a read failure keeps the hold for
  // a read-only retry that never recreates or reselects.
  React.useEffect(() => {
    const onScopeChanged = (event: Event) => {
      const detail = (event as CustomEvent<{ step?: unknown; origin?: unknown }>).detail;
      setProvisionTransition({
        step: detail?.step === 'workspace' ? ('workspace' as const) : ('project' as const),
        origin: detail?.origin === 'created' ? ('created' as const) : ('selected' as const),
      });
      refreshScope();
    };
    window.addEventListener(SCOPE_CHANGED_EVENT, onScopeChanged);
    return () => window.removeEventListener(SCOPE_CHANGED_EVENT, onScopeChanged);
  }, [refreshScope]);

  const handleProvision = React.useCallback(
    async (name: string) => {
      if (prov.working || provisionTransition) return;
      if (conv.status === 'needs-workspace' && chosenWorkspaceId === null) {
        const outcome = await prov.createWorkspace(name);
        // The announcement carries the confirmed step and triggers the
        // single authoritative refresh; failures stay local.
        if (outcome.ok)
          announceScopeChanged('workspace', 'created', {
            workspaceId: outcome.id,
            projectId: null,
          });
      } else {
        // Project step, or a workspace chosen for its first project: bind
        // creation to the chosen workspace, never recreate it.
        const wsId = chosenWorkspaceId ?? conv.activeWorkspaceId;
        if (!wsId) return;
        const outcome = await prov.createProject(name, wsId);
        if (outcome.ok)
          announceScopeChanged('project', 'created', {
            workspaceId: wsId,
            projectId: outcome.id,
          });
      }
    },
    [chosenWorkspaceId, conv, prov, provisionTransition],
  );

  const handleSelect = React.useCallback(
    async (workspaceId: string, projectId: string) => {
      if (sel.working || provisionTransition) return;
      // Success announces; the subscription above holds the transition and
      // refreshes authoritative scope. Failures stay local: no event, no
      // fallback into another scope.
      await sel.select(workspaceId, projectId);
    },
    [sel, provisionTransition],
  );

  // Release the hold only when authoritative bootstrap advances past the
  // confirmed step. A read failure (error) keeps the hold for a read-only
  // retry; it never re-enables the old creation action.
  React.useEffect(() => {
    if (provisionTransition?.step === 'workspace' && conv.status !== 'needs-workspace') {
      if (conv.status === 'needs-project' || conv.status === 'ready') {
        setProvisionTransition(null);
      }
    } else if (provisionTransition?.step === 'project' && conv.status === 'ready') {
      setProvisionTransition(null);
    }
  }, [conv.status, provisionTransition]);

  const formWorking = prov.working || sel.working || provisionTransition !== null;

  const handleSubmit = React.useCallback(async () => {
    const text = draftRef.current.trim();
    if (!text || busy) return;
    setSubmitError(null);
    const sent = text;
    // Streaming dispatch when a registry model is wired; otherwise the
    // honest text-only fallback persists just the message.
    const outcome = streamReady
      ? await conv.streamOnce(sent, ollama.account!.accountId, selectedModelId, mode)
      : await conv.submit(sent);
    // A rejected streaming dispatch (e.g. a send racing the in-flight turn)
    // must be visible, never a silent no-op. Text-only refusals and failures
    // go through the hook's error state, which the panel renders below.
    if (streamReady && !outcome.ok) setSubmitError(outcome.error);
    // Retain the draft on failure; never erase edits typed meanwhile.
    if (outcome.ok && draftRef.current === sent) {
      commitPrompt(sent);
    }
  }, [busy, commitPrompt, conv, streamReady, ollama.account, selectedModelId]);

  const handleStop = React.useCallback(() => {
    if (conv.streaming) {
      void conv.stop();
      return;
    }
    setStopNotice(true);
  }, [conv]);

  const notice = streamReady
    ? submissionNotice({
        attachmentCount: attachments.length,
        hasCustomSettings: reasoningEffort !== 'medium',
        modelApplied: true,
      })
    : submissionNotice({
        attachmentCount: attachments.length,
        hasCustomSettings: reasoningEffort !== 'medium',
      });
  const composeStatus = conv.streaming
    ? ('streaming' as const)
    : conv.status === 'submitting'
      ? ('sending' as const)
      : ('idle' as const);
  const executionUnavailable = mode === 'execute';
  const isEmpty = conv.messages.length === 0 && conv.streaming === null;

  // Partial provisioning replaces the composer: there is no session yet, so
  // nothing may be submitted. The form drives one deliberate creation step.
  // After a committed creation the step stays held (disabled) until the
  // authoritative bootstrap advances; a read failure offers a read-only
  // retry that preserves the issued identity.
  if (provisionTransition && conv.status === 'error') {
    return (
      <div className="relative flex h-full w-full flex-col items-center justify-center bg-transparent">
        <div className="mx-auto flex w-full max-w-md flex-col gap-3 p-4">
          <p role="alert" className="text-sm">
            {conv.error ?? t('provision.refreshFailed', 'Change saved. Reload failed.')}
          </p>
          <button type="button" onClick={() => conv.refreshScope()} className="text-sm underline">
            {t('provision.retryLoad', 'Retry loading')}
          </button>
        </div>
      </div>
    );
  }
  if (needsProvisioning || (provisionTransition && conv.status === 'bootstrapping')) {
    return (
      <ConversationSetupSlot
        status={conv.status as 'needs-workspace' | 'needs-project' | 'bootstrapping'}
        activeWorkspaceId={conv.activeWorkspaceId}
        provisionTransition={provisionTransition}
        sel={sel}
        prov={prov}
        formWorking={formWorking}
        chosenWorkspaceId={chosenWorkspaceId}
        setChosenWorkspaceId={setChosenWorkspaceId}
        onProvision={(name) => void handleProvision(name)}
        onSelect={(wsId, projId) => void handleSelect(wsId, projId)}
      />
    );
  }

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden bg-transparent">
      {/* Pending recovery banners: unsent messages and unfinished provider
          operations have separate lifecycles and separate actions. */}
      <div className="space-y-2 px-4 pt-2">
        <PendingRecoveryBanner
          operations={recovery.operations}
          truncated={recovery.truncated}
          onReview={recovery.openReview}
          onDismiss={(op) => recovery.openDismiss(op)}
        />
        <ProviderRecoveryBanner
          operations={providerRecovery.operations}
          error={providerRecovery.error}
          busyOperationId={providerRecovery.busyOperationId}
          onRetry={() => void providerRecovery.refresh()}
          onMarkInterrupted={providerRecovery.markInterrupted}
        />
      </div>

      {/* Conversation Timeline (smoothly expands when messages exist) */}
      <div
        className={`flex flex-col overflow-y-auto transition-all duration-500 ease-in-out ${
          isEmpty ? 'max-h-0 flex-0 opacity-0 pointer-events-none' : 'flex-1 opacity-100'
        }`}
      >
        <div className="flex w-full flex-1 flex-col gap-4 p-4">
          {conv.messages.map((m) => {
            const note = messageNote(m, t);
            return (
              <React.Fragment key={m.id}>
                <MessageCard
                  role={m.role === 'assistant' || m.role === 'agent' ? 'assistant' : 'user'}
                  text={m.text}
                  timestamp={formatTimestamp(m.createdAt)}
                />
                {note && (
                  <p
                    role="status"
                    className={`px-1 text-xs ${
                      note.tone === 'error' ? 'text-destructive' : 'text-foreground-muted'
                    }`}
                  >
                    {note.text}
                  </p>
                )}
              </React.Fragment>
            );
          })}
          {conv.streaming && conv.streaming.text !== '' && (
            <MessageCard
              key={conv.streaming.opId || 'streaming'}
              role="assistant"
              text={conv.streaming.text}
              timestamp={formatTime(new Date())}
            />
          )}
          {conv.streaming && conv.streaming.phase !== 'streaming' && (
            <TurnStatus phase={conv.streaming.phase} startedAt={conv.streaming.startedAt} />
          )}
          {/* Non-authoritative recovery: only when the post-terminal history
              reload failed; replaced atomically by authoritative rows. */}
          {conv.recoverySnapshot && (
            <MessageCard
              key={conv.recoverySnapshot.id}
              role="assistant"
              text={conv.recoverySnapshot.text}
              timestamp={formatTimestamp(conv.recoverySnapshot.createdAt)}
            />
          )}
        </div>
      </div>

      {/* Centered Logo (pushes to center when empty, smoothly collapses when session starts) */}
      <div
        className={`flex flex-col items-center justify-end transition-all duration-500 ease-in-out ${
          isEmpty
            ? 'flex-1 pb-6 opacity-100 scale-100'
            : 'max-h-0 flex-0 pb-0 opacity-0 scale-95 pointer-events-none overflow-hidden'
        }`}
      >
        <EmptyWelcome />
      </div>

      {/* Status and availability notices */}
      <div aria-live="polite">
        {conv.status === 'bootstrapping' && (
          <p>{t('conversation.starting', 'Starting conversation…')}</p>
        )}
        {conv.status === 'submitting' && <p>{t('conversation.saving', 'Saving message…')}</p>}
        {conv.storageWarning && (
          <div
            role="status"
            className="p-2 text-xs text-warning-foreground bg-warning-surface rounded"
          >
            <p>{conv.storageWarning}</p>
          </div>
        )}
        {conv.error && (
          <div role="alert">
            <p>{conv.error}</p>
            <p>
              {t(
                'conversation.uncertainHint',
                'If this message may not have saved, reload history before resending.',
              )}
            </p>
            <button type="button" onClick={() => void conv.reload()}>
              {t('conversation.reloadHistory', 'Reload history')}
            </button>
          </div>
        )}
        {executionUnavailable && (
          <p>
            {t(
              'conversation.executionUnavailable',
              'Execution is unavailable in this build. Messages are saved as text only.',
            )}
          </p>
        )}
        {stopNotice && (
          <p>
            {t(
              'conversation.stopUnavailable',
              'Stop is unavailable: there is no running operation to cancel.',
            )}
          </p>
        )}
        {submitError && (
          <div role="alert">
            <p>{submitError}</p>
          </div>
        )}
        {recovery.error && (
          <div role="alert" className="p-2 text-xs text-destructive bg-destructive/10 rounded">
            <p>{recovery.error}</p>
          </div>
        )}
        {recovery.cleanupWarning && (
          <div
            role="status"
            className="p-2 text-xs text-warning-foreground bg-warning-surface rounded"
          >
            <p>{recovery.cleanupWarning}</p>
          </div>
        )}
        <p>{notice}</p>
      </div>

      {/* Composer: smoothly glides from center to bottom */}
      <div
        className={`w-full transition-all duration-500 ease-in-out ${
          isEmpty
            ? 'flex-1 max-w-3xl mx-auto px-4 pb-16 flex flex-col justify-start'
            : 'flex-0 w-full'
        }`}
      >
        <Composer
          isCentered={isEmpty}
          inputText={draft}
          onChangeInput={setDraft}
          onSubmit={() => void handleSubmit()}
          onStop={handleStop}
          status={composeStatus}
          enterToSend={enterToSend}
          mode={mode}
          onChangeMode={handleChangeMode}
          selectedModelId={selectedModelId}
          onSelectModel={setSelectedModelId}
          models={pickerModels}
          reasoningEffort={reasoningEffort}
          onChangeReasoningEffort={setReasoningEffort}
          contextLimit={selectedDescriptor?.contextLimit ?? null}
          effectiveContextBudget={selectedDescriptor?.effectiveContextBudget ?? null}
          attachments={attachments}
          onAddAttachments={(next) => setAttachments((prev) => [...prev, ...next])}
          onRemoveAttachment={(id) => setAttachments((prev) => prev.filter((a) => a.id !== id))}
          approvalRequest={null}
          onRecallPrevious={() => {
            recallPrevious();
          }}
          onRecallNext={() => {
            recallNext();
          }}
        />
      </div>

      <PendingRecoveryReviewDialog
        open={recovery.reviewDialogOpen}
        operation={recovery.activeReviewOp}
        validatingTarget={recovery.validatingTarget}
        targetMissing={recovery.targetMissing}
        initialDismissConfirm={recovery.initialDismissConfirm}
        onClose={recovery.closeReview}
        onResend={(op) => recovery.resendOperation(op)}
        onDismiss={(op) => recovery.dismissOperation(op)}
      />
    </div>
  );
}
