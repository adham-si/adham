import * as React from 'react';
import { useTranslation } from 'react-i18next';
import { useDrafts, type ComposeMode, type ModelOption } from '@/widgets/compose';
import { useAttachmentDrop, useAttachments } from './attachments';
import { adhamClient } from '@/shared/api/adham-client';
import { useConversation, type ConversationBackend } from './use-conversation';
import { adhamProviderBackend, useOllamaProvider, type ProviderBackend } from './provider-stream';
import { useModelPrefs } from '@/shared/models/model-prefs';
import {
  announceScopeChanged,
  SCOPE_CHANGED_EVENT,
  useProvisioning,
  type ProvisioningBackend,
} from '../provisioning';
import { useSelection, type SelectionBackend } from '../workspace-selection';
import { ConversationSetupSlot } from './conversation-setup-slot';
import { alternativeIndex } from './alternative-groups';
import { readComposeModePreference, writeComposeModePreference } from './compose-mode-preference';
import {
  migratePendingModelChoice,
  readComposeModelPreference,
  writeComposeModelPreference,
} from './compose-model-preference';
import { usePendingRecovery } from './pending-recovery';
import { useProviderRecovery } from './provider-recovery';
import { ConversationPanelView } from './conversation-panel-view';
import { useTurnDispatch } from './use-turn-dispatch';

const PENDING_DRAFT_BUCKET = 'pending';

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
  /** A refused branch switch or feedback save states itself; neither is an
   *  uncertain send, so it is not routed through the send-error notice. */
  const [actionNotice, setActionNotice] = React.useState<string | null>(null);
  // Feedback by answer row: the stored verdict is the only pressed state.
  const feedbackByAnswer = React.useMemo(
    () => new Map(conv.answerFeedback.map((f) => [f.messageId, f])),
    [conv.answerFeedback],
  );
  // Edited-branch provenance: which messages belong to a branch and which
  // member the session continues from (default: the newest edit, the same
  // rule the backend applies).
  const alternatives = React.useMemo(
    () => alternativeIndex(conv.messages, conv.branchSelections),
    [conv.messages, conv.branchSelections],
  );
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
  // Drafts and model picks live in a workspace+project bucket, so two
  // projects never share a new-session draft or an explicit selection.
  const scopeKey = conv.context ? `${conv.context.workspaceId}:${conv.context.projectId}` : null;
  const pendingBucket = scopeKey ? `${scopeKey}:${PENDING_DRAFT_BUCKET}` : PENDING_DRAFT_BUCKET;
  const sessionBucket = scopeKey
    ? `${scopeKey}:${conv.sessionId ?? PENDING_DRAFT_BUCKET}`
    : (conv.sessionId ?? PENDING_DRAFT_BUCKET);
  const { draft, setDraft, commitPrompt, recallPrevious, recallNext } = useDrafts({
    sessionId: sessionBucket,
    pendingBucket,
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
  // discovery order never becomes a silent default. The pick is remembered per
  // session bucket (the same one drafts use) so a rerender, a session switch
  // or reopening restores exactly the choice the user made for that session.
  const [selectedModelId, setSelectedModelId] = React.useState(
    () => readComposeModelPreference(sessionBucket) ?? '',
  );
  /** Documented `think` value for the next turn; null = model default. */
  const [think, setThink] = React.useState<boolean | string | null>(null);

  // A session switch hydrates that session's remembered model choice, carrying
  // a pre-session pick into the session a first send materialized (never
  // overwriting a choice the target session already made). The thinking choice
  // resets in the same step: it was validated against the previous model.
  const prevModelSessionRef = React.useRef(sessionBucket);
  React.useEffect(() => {
    if (prevModelSessionRef.current === sessionBucket) return;
    prevModelSessionRef.current = sessionBucket;
    if (pendingBucket !== PENDING_DRAFT_BUCKET) {
      migratePendingModelChoice(pendingBucket, PENDING_DRAFT_BUCKET);
    }
    migratePendingModelChoice(sessionBucket, pendingBucket);
    setSelectedModelId(readComposeModelPreference(sessionBucket) ?? '');
    setThink(null);
  }, [sessionBucket, pendingBucket]);
  const [stopNotice, setStopNotice] = React.useState(false);
  const [submitError, setSubmitError] = React.useState<string | null>(null);
  /// The timeline follows new output only while the reader is at the bottom.
  /// Scrolling up stops the follow and offers jump-to-latest; the offset is
  /// read from the element, never fabricated.
  const timelineRef = React.useRef<HTMLDivElement>(null);
  const nearBottomRef = React.useRef(true);
  const [showJumpToLatest, setShowJumpToLatest] = React.useState(false);
  const handleTimelineScroll = React.useCallback(() => {
    const el = timelineRef.current;
    if (!el) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight <= 64;
    nearBottomRef.current = near;
    setShowJumpToLatest(!near);
  }, []);
  const scrollToLatest = React.useCallback(() => {
    const el = timelineRef.current;
    if (!el) return;
    nearBottomRef.current = true;
    setShowJumpToLatest(false);
    el.scrollTop = el.scrollHeight;
  }, []);
  const lastMessageText = conv.messages[conv.messages.length - 1]?.text ?? '';
  const streamingText = conv.streaming?.text ?? '';
  React.useEffect(() => {
    if (!nearBottomRef.current) return;
    const el = timelineRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [conv.messages.length, lastMessageText, streamingText]); // "Enabled in chat" curation from the models settings page filters what the
  // composer offers (absence = enabled, so a fresh connection stays complete).
  const modelPrefs = useModelPrefs();

  // Registry-driven picker: when an Ollama account has pinned models, the
  // composer options come from the provider registry (Delivery A). The picker
  // stays visible either way; without registry models dispatch runs the
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
  const pickerModels: ModelOption[] = ollama.models
    .filter((m) => modelPrefs.isEnabled(ollama.account?.accountId ?? '', m.modelId))
    .map((m) => ({
      id: m.modelId,
      name: m.humanLabel,
      provider: 'Ollama',
      boundary: 'local' as const,
      // Thinking controls appear only for evidenced support; unknown or
      // unsupported must not present a control the model may not honor.
      supportsReasoning: m.capabilities.thinking === 'supported',
      // The control itself comes from the model's documented values.
      thinkingValues: m.capabilities.thinkingValues ?? undefined,
      thinkingDefault: m.capabilities.thinkingDefault,
    }));
  const selectedDescriptor = ollama.models.find((m) => m.modelId === selectedModelId) ?? null;
  /// The name assistant rows speak as: the model resolved for this session.
  /// Unknown until a model resolves — the card then keeps the role label
  /// instead of inventing an identity.
  const assistantName = selectedDescriptor?.humanLabel || undefined;
  const streamReady =
    ollama.ready && selectedModelId !== '' && pickerModels.some((m) => m.id === selectedModelId);
  /// A loaded registry that proves nothing is usable reads as unavailable;
  /// an unresolved read stays neutral, never a claim about the machine.
  const modelUnavailable =
    ollama.accountsLoaded &&
    (ollama.account === null || (ollama.modelsLoaded && pickerModels.length === 0));

  // Attachment selections: read and stored now when the session exists,
  // otherwise pending until the send that materializes the session. A refused
  // file keeps its chip with the reason; the send then refuses too.
  const attachmentScope = conv.context
    ? {
        workspaceId: conv.context.workspaceId,
        projectId: conv.context.projectId,
        sessionId: conv.sessionId,
      }
    : null;
  const attachments = useAttachments({ backend, scope: attachmentScope });
  const attachmentDrop = useAttachmentDrop({ onPaths: attachments.addPaths });
  /** Rehydrate the exact extracted text of an attachment on this session. */
  const readAttachmentText = React.useCallback(
    (attachmentId: string) => {
      const ctx = conv.context;
      if (!ctx || !conv.sessionId || !backend.readAttachmentText) {
        return Promise.reject(new Error('VALIDATION_FAILED: attachment.unreadable'));
      }
      return backend.readAttachmentText(
        ctx.workspaceId,
        ctx.projectId,
        conv.sessionId,
        attachmentId,
      );
    },
    [backend, conv.context, conv.sessionId],
  );
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

  const {
    busy,
    queued,
    pendingReference,
    setPendingReference,
    cancelPendingReference,
    turnAction,
    handleTurnAction,
    handleSubmit,
    removeQueued,
  } = useTurnDispatch({
    conv,
    attachments,
    streamReady,
    ollamaAccountId: ollama.account?.accountId,
    selectedModelId,
    mode,
    think,
    draftRef,
    setDraft,
    commitPrompt,
    setSubmitError,
  });

  /// A new model invalidates the thinking choice: a level documented for the
  /// previous model may be undocumented for the next one (the backend refuses
  /// undocumented values, so carrying it over would refuse an honest send).
  const handleSelectModel = React.useCallback(
    (modelId: string) => {
      setSelectedModelId(modelId);
      writeComposeModelPreference(sessionBucket, modelId);
      setThink(null);
    },
    [sessionBucket],
  );

  const handleStop = React.useCallback(() => {
    if (conv.streaming) {
      void conv.stop();
      return;
    }
    setStopNotice(true);
  }, [conv]);

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
    <ConversationPanelView
      conv={conv}
      attachments={attachments}
      recovery={recovery}
      providerRecovery={providerRecovery}
      timeline={{
        ref: timelineRef,
        onScroll: handleTimelineScroll,
        showJumpToLatest,
        scrollToLatest,
        isEmpty,
      }}
      messages={{
        alternatives,
        assistantName,
        turnAction,
        busy,
        feedbackByAnswer,
        readAttachmentText: backend.readAttachmentText ? readAttachmentText : undefined,
        onRegenerate: handleTurnAction,
        setActionNotice,
        setPendingReference,
        draftRef,
        setDraft,
      }}
      compose={{
        draft,
        onSubmit: () => void handleSubmit(),
        onStop: handleStop,
        queued,
        onRemoveQueued: removeQueued,
        pendingReference,
        onCancelReference: cancelPendingReference,
        status: composeStatus,
        enterToSend,
        mode,
        onChangeMode: handleChangeMode,
        selectedModelId,
        onSelectModel: handleSelectModel,
        models: pickerModels,
        modelUnavailable,
        think,
        onChangeThink: setThink,
        contextLimit: selectedDescriptor?.contextLimit ?? null,
        effectiveContextBudget: selectedDescriptor?.effectiveContextBudget ?? null,
        onAddFiles: attachments.addFiles,
        onRemoveAttachment: attachments.remove,
        isDragOverExternal: attachmentDrop.dragging,
        onRecallPrevious: () => {
          recallPrevious();
        },
        onRecallNext: () => {
          recallNext();
        },
      }}
      notices={{
        actionNotice,
        executionUnavailable,
        stopNotice,
        submitError,
      }}
    />
  );
}
