import * as React from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { contentFromText, MessageCard, type MarkdownLabels } from '@adham/ui';
import {
  Composer,
  EmptyWelcome,
  useDrafts,
  type ComposeMode,
  type ModelOption,
  type QueuedInstruction,
} from '@/widgets/compose';
import {
  MessageAttachments,
  useAttachmentDrop,
  useAttachments,
  type PendingFile,
} from './attachments';
import { adhamClient } from '@/shared/api/adham-client';
import { formatTime } from '@/shared/i18n/format';
import {
  useConversation,
  type ConversationBackend,
  type UiMessage,
  type UiMessageReference,
} from './use-conversation';
import { adhamProviderBackend, useOllamaProvider, type ProviderBackend } from './provider-stream';
import { useModelPrefs } from '@/shared/models/model-prefs';
import { TurnStatus } from './turn-status';
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
  /** Localized strings for the message renderer (code copy, placeholders). */
  const markdownLabels = React.useMemo<Partial<MarkdownLabels>>(
    () => ({
      copyCode: t('compose.markdown.copyCode'),
      codeLabel: t('compose.markdown.code'),
      copyMessage: t('compose.markdown.copyMessage'),
      copied: t('compose.markdown.copied'),
      copyFailed: t('compose.markdown.copyFailed'),
      imageNotShown: t('compose.markdown.imageNotShown'),
      unsupportedContent: t('compose.markdown.unsupportedContent'),
      replyAction: t('compose.markdown.replyAction'),
      quoteLabel: t('compose.markdown.quoteLabel'),
      quoteUnavailable: t('compose.markdown.quoteUnavailable'),
      branchActiveLabel: t('compose.markdown.branchActive'),
      branchMakeActiveLabel: t('compose.markdown.branchMakeActive'),
      likeAction: t('compose.markdown.likeAnswer'),
      dislikeAction: t('compose.markdown.dislikeAnswer'),
      feedbackReason: t('compose.markdown.feedbackReason'),
    }),
    [t],
  );
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
  /** Sends that arrived while a turn was running, shown above the input. */
  const [queued, setQueued] = React.useState<QueuedInstruction[]>([]);
  // The ref mirrors `queued` as the drain's source of truth: drains run in
  // async continuations after a settled dispatch, where render state lags.
  const queuedRef = React.useRef<QueuedInstruction[]>([]);
  const queuedIdRef = React.useRef(0);
  const setQueuedBoth = React.useCallback((next: QueuedInstruction[]) => {
    queuedRef.current = next;
    setQueued(next);
  }, []);
  /** The message the next send references: a reply quote or an edited
   *  alternative; cleared on acknowledgment or session switch, never dropped
   *  silently. Switching Reply/Edit replaces the pending reference (one send
   *  carries at most one); only Edit touches the draft (prefill/restore). */
  const [pendingReference, setPendingReference] = React.useState<{
    id: string;
    relation: UiMessageReference['relation'];
    excerpt: string | null;
    /** Draft restored when an edit is cancelled; undefined = leave as-is. */
    priorDraft?: string;
  } | null>(null);
  const cancelPendingReference = React.useCallback(() => {
    if (pendingReference?.priorDraft !== undefined) setDraft(pendingReference.priorDraft);
    setPendingReference(null);
  }, [pendingReference, setDraft]);
  /** Quoted text for a reference: null when the target is not in the loaded
   *  history, which the card then states instead of inventing an excerpt. */
  const quotedExcerptOf = React.useCallback(
    (messageId: string): string | null =>
      conv.messages.find((m) => m.id === messageId)?.text ?? null,
    [conv.messages],
  );

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
  const streamReady =
    ollama.ready && selectedModelId !== '' && pickerModels.some((m) => m.id === selectedModelId);
  /// A loaded registry that proves nothing is usable reads as unavailable;
  /// an unresolved read stays neutral, never a claim about the machine.
  const modelUnavailable =
    ollama.accountsLoaded &&
    (ollama.account === null || (ollama.modelsLoaded && pickerModels.length === 0));

  const busy =
    conv.status === 'submitting' || conv.status === 'bootstrapping' || conv.streaming !== null;
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

  /// Runs one turn with the parameters current at dispatch; a queued
  /// instruction drains through exactly the same path as a direct send. A
  /// reference rides only the streaming path (the text-only path records no
  /// reference), so a referenced send without a resolved model is refused
  /// visibly rather than sent as an unreferenced message.
  const dispatchTurn = React.useCallback(
    async (
      sent: string,
      reference?: UiMessageReference,
      attachmentIds: string[] = [],
      pendingFiles: PendingFile[] = [],
    ) => {
      setSubmitError(null);
      const refusedReference = reference !== undefined && !streamReady;
      const outcome = refusedReference
        ? {
            ok: false as const,
            error: t(
              reference?.relation === 'edited-from'
                ? 'conversation.editNeedsModel'
                : 'conversation.replyNeedsModel',
            ),
            uncertain: false as const,
          }
        : streamReady
          ? await conv.streamOnce(
              sent,
              ollama.account!.accountId,
              selectedModelId,
              mode,
              // The documented `think` value; null = model default (omitted).
              think ?? undefined,
              reference,
              attachmentIds,
              pendingFiles,
            )
          : await conv.submit(sent);
      // A rejected dispatch (a refused reply, an undocumented think value) must
      // be visible, never a silent no-op. Text-only failures go through the
      // hook's error state, which the panel renders below.
      if (!outcome.ok && (streamReady || refusedReference)) setSubmitError(outcome.error);
      // Nothing was persisted (the hook drops its optimistic bubble), so the
      // instruction returns to the composer — never clobbering edits typed
      // meanwhile. The ref still reads `sent` when a refusal lands before the
      // just-cleared draft has re-rendered, so that case restores too.
      if (!outcome.ok && (!draftRef.current || draftRef.current === sent)) setDraft(sent);
      return outcome;
    },
    [conv, streamReady, ollama.account, selectedModelId, mode, think, setDraft, t],
  );

  /// Dispatches one turn, then drains the visible queue. The hook accepts one
  /// live dispatch at a time, so a queued instruction may only go once the
  /// previous dispatch has fully settled (terminal + authoritative reload);
  /// a refusal stops the drain, since its reason applies to what follows too.
  const dispatchAndDrain = React.useCallback(
    async (
      sent: string,
      reference?: UiMessageReference,
      attachmentIds: string[] = [],
      pendingFiles: PendingFile[] = [],
    ) => {
      let outcome = await dispatchTurn(sent, reference, attachmentIds, pendingFiles);
      // The reference is acknowledged only when its dispatch was accepted; a
      // refused send keeps the pending reference so it can be retried as one.
      if (outcome.ok && reference) {
        setPendingReference((prev) =>
          prev && prev.id === reference.refersToMessageId ? null : prev,
        );
      }
      while (outcome.ok && queuedRef.current.length > 0) {
        const next = queuedRef.current[0]!;
        setQueuedBoth(queuedRef.current.slice(1));
        outcome = await dispatchTurn(next.text, next.reference);
        // A refused queued reference returns to the composer with its target
        // intact, never silently downgraded to a plain message.
        if (!outcome.ok && next.reference) {
          setPendingReference({
            id: next.reference.refersToMessageId,
            relation: next.reference.relation,
            excerpt: next.referenceExcerpt ?? null,
          });
        }
      }
      return outcome;
    },
    [dispatchTurn, setQueuedBoth],
  );

  /// The newest attempt of the newest turn carries Retry (a failed or
  /// interrupted attempt) or Regenerate (a completed one): earlier attempts
  /// are superseded, and an older turn cannot be answered out of order. The
  /// backend enforces the same rule; this only keeps the offered action true.
  const turnAction = React.useMemo(() => {
    const messages = conv.messages;
    const last = messages[messages.length - 1];
    if (!last || (last.role !== 'assistant' && last.role !== 'agent')) return null;
    let userId: string | null = null;
    for (let i = messages.length - 2; i >= 0; i -= 1) {
      const m = messages[i]!;
      if (m.role !== 'assistant' && m.role !== 'agent') {
        userId = m.id;
        break;
      }
    }
    if (!userId) return null;
    const state = last.completion?.state;
    if (state !== 'failed' && state !== 'interrupted' && state !== 'completed') return null;
    return {
      attemptId: last.id,
      userId,
      verb: state === 'completed' ? ('regenerate' as const) : ('retry' as const),
    };
  }, [conv.messages]);

  /// One new attempt against the same user turn. Nothing is replaced and no
  /// user row is written; the refusal reason (no model, rejected dispatch) is
  /// stated, never swallowed.
  const handleTurnAction = React.useCallback(() => {
    if (!turnAction || busy) return;
    setSubmitError(null);
    if (!streamReady) {
      setSubmitError(t('conversation.retryNeedsModel', 'Select a model to retry this turn.'));
      return;
    }
    void conv
      .retryTurn(
        turnAction.userId,
        ollama.account!.accountId,
        selectedModelId,
        mode,
        think ?? undefined,
      )
      .then((outcome) => {
        if (!outcome.ok) setSubmitError(outcome.error);
      });
  }, [turnAction, busy, streamReady, t, conv, ollama.account, selectedModelId, mode, think]);

  // Queued instructions and the pending reference belong to the session they
  // were typed in: a session switch drops them rather than dispatching them
  // into another thread.
  React.useEffect(() => {
    setQueuedBoth([]);
    setPendingReference(null);
  }, [conv.sessionId, setQueuedBoth]);

  const handleSubmit = React.useCallback(async () => {
    const text = draftRef.current.trim();
    const readyIds = attachments.readyIds;
    const pendingFiles = attachments.pendingFiles;
    const hasFiles = attachments.items.length > 0;
    // An attachment-only send is valid; text-only needs text.
    if (!text && !hasFiles) return;
    // A selection that is unreadable, still being read, or has no model to
    // receive it refuses the send with its reason — chips are never dropped
    // silently and a send never leaves them behind without saying so.
    if (attachments.isReading) {
      setSubmitError(t('attachments.stillReading'));
      return;
    }
    if (attachments.hasErrors) {
      setSubmitError(t('attachments.failedSelection'));
      return;
    }
    if (hasFiles && !streamReady) {
      setSubmitError(t('attachments.needsModel'));
      return;
    }
    const reference: UiMessageReference | undefined = pendingReference
      ? { refersToMessageId: pendingReference.id, relation: pendingReference.relation }
      : undefined;
    // Sending while a turn runs queues the instruction visibly: it is never
    // injected into the active call and never a silent no-op. It dispatches
    // (with the parameters current then) once the turn settles. Files have no
    // queue slot, so a file send waits instead of queueing a chip-less text.
    if (busy) {
      if (hasFiles) {
        setSubmitError(t('attachments.busy'));
        return;
      }
      queuedIdRef.current += 1;
      setQueuedBoth([
        ...queuedRef.current,
        {
          id: `queued-${queuedIdRef.current}`,
          text,
          ...(reference ? { reference, referenceExcerpt: pendingReference?.excerpt ?? null } : {}),
        },
      ]);
      // The queued instruction carries the reference now; the chip is done.
      if (reference) setPendingReference(null);
      if (draftRef.current === text) commitPrompt(text);
      return;
    }
    // Clear now, not at stream end: submission is the acknowledgment (the
    // user bubble appears and the turn persists), and a follow-up typed while
    // the answer streams must not append to an already-sent instruction.
    if (draftRef.current === text) commitPrompt(text);
    const outcome = await dispatchAndDrain(text, reference, readyIds, pendingFiles);
    // The files were linked to the persisted turn; the composer selection is
    // done. A refusal keeps them so the same send can be retried.
    if (outcome.ok && hasFiles) attachments.clear();
  }, [
    attachments,
    busy,
    commitPrompt,
    dispatchAndDrain,
    setQueuedBoth,
    pendingReference,
    streamReady,
    t,
  ]);

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
        ref={timelineRef}
        onScroll={handleTimelineScroll}
        data-testid="conversation-timeline"
        className={`flex flex-col overflow-y-auto transition-all duration-500 ease-in-out ${
          isEmpty ? 'max-h-0 flex-0 opacity-0 pointer-events-none' : 'flex-1 opacity-100'
        }`}
      >
        <div className="flex w-full flex-1 flex-col gap-4 p-4">
          {conv.messages.map((m) => {
            const note = messageNote(m, t);
            const alternative = alternatives.get(m.id);
            const isAssistant = m.role === 'assistant' || m.role === 'agent';
            return (
              <React.Fragment key={m.id}>
                <MessageCard
                  role={isAssistant ? 'assistant' : 'user'}
                  content={contentFromText(m.text)}
                  labels={markdownLabels}
                  timestamp={formatTimestamp(m.createdAt)}
                  branch={
                    alternative
                      ? {
                          active: alternative.active,
                          onMakeActive: alternative.active
                            ? undefined
                            : () => {
                                void conv
                                  .makeAlternativeActive(alternative.rootId, m.id)
                                  .then((outcome) =>
                                    setActionNotice(outcome.ok ? null : outcome.error),
                                  );
                              },
                        }
                      : undefined
                  }
                  // Feedback is for a settled, persisted answer attempt: the
                  // provisional bubble has no durable id to key a verdict to,
                  // so it is never offered one.
                  feedback={m.provisional || !isAssistant ? undefined : feedbackByAnswer.get(m.id)}
                  onFeedback={
                    m.provisional || !isAssistant
                      ? undefined
                      : (verdict, reason) => {
                          void conv
                            .setAnswerFeedback(m.id, verdict, reason)
                            .then((outcome) => setActionNotice(outcome.ok ? null : outcome.error));
                        }
                  }
                  quotedExcerpt={
                    m.reference ? quotedExcerptOf(m.reference.refersToMessageId) : undefined
                  }
                  quotedRelation={m.reference?.relation}
                  // Only persisted rows can reference a message: the provisional
                  // bubble carries no durable id the backend could validate.
                  onReply={
                    m.provisional
                      ? undefined
                      : () =>
                          setPendingReference({ id: m.id, relation: 'replied', excerpt: m.text })
                  }
                  // Edit rewrites the prompt, which the backend accepts only
                  // for user rows: never offered where it would have to refuse.
                  onEdit={
                    m.provisional || m.role !== 'user'
                      ? undefined
                      : () => {
                          setPendingReference({
                            id: m.id,
                            relation: 'edited-from',
                            excerpt: m.text,
                            priorDraft: draftRef.current,
                          });
                          setDraft(m.text);
                        }
                  }
                />
                {/* The files this message was sent with, read from the stored
                    link rows. A chip exists because the turn carried it; the
                    preview reads back the exact extracted text. */}
                {!isAssistant && (m.attachments?.length ?? 0) > 0 && (
                  <MessageAttachments
                    attachments={m.attachments!}
                    readText={backend.readAttachmentText ? readAttachmentText : undefined}
                    className="px-1"
                  />
                )}
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
                {turnAction && m.id === turnAction.attemptId && (
                  <div className="flex gap-2 px-1">
                    <button
                      type="button"
                      className="text-xs text-foreground-secondary underline hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:opacity-50"
                      disabled={busy}
                      onClick={handleTurnAction}
                    >
                      {turnAction.verb === 'retry'
                        ? t('conversation.retryTurn', 'Retry')
                        : t('conversation.regenerateAnswer', 'Regenerate')}
                    </button>
                  </div>
                )}
              </React.Fragment>
            );
          })}
          {conv.streaming && conv.streaming.text !== '' && (
            <MessageCard
              key={conv.streaming.opId || 'streaming'}
              role="assistant"
              content={contentFromText(conv.streaming.text)}
              labels={markdownLabels}
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
              content={contentFromText(conv.recoverySnapshot.text)}
              labels={markdownLabels}
              timestamp={formatTimestamp(conv.recoverySnapshot.createdAt)}
            />
          )}
          {showJumpToLatest && (
            <button
              type="button"
              onClick={scrollToLatest}
              className="sticky bottom-0 self-end rounded-full border border-border-subtle bg-surface-subtle px-3 py-1 text-xs text-foreground-secondary shadow-sm hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
            >
              {t('conversation.jumpToLatest')}
            </button>
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
        {actionNotice && (
          <div
            role="status"
            className="p-2 text-xs text-warning-foreground bg-warning-surface rounded"
          >
            <p>{actionNotice}</p>
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
        {conv.omittedMessages > 0 && (
          <div
            role="status"
            className="p-2 text-xs text-warning-foreground bg-warning-surface rounded"
          >
            <p>
              {t(
                'conversation.contextTruncated',
                'Older messages were omitted so this request fits the model context (estimated).',
              )}{' '}
              {t('conversation.omittedMessagesLabel', 'Omitted messages')}: {conv.omittedMessages}
            </p>
          </div>
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
          queued={queued}
          onRemoveQueued={(id) => setQueuedBoth(queuedRef.current.filter((item) => item.id !== id))}
          replyTo={
            pendingReference
              ? { relation: pendingReference.relation, excerpt: pendingReference.excerpt }
              : null
          }
          onCancelReply={cancelPendingReference}
          status={composeStatus}
          enterToSend={enterToSend}
          mode={mode}
          onChangeMode={handleChangeMode}
          selectedModelId={selectedModelId}
          onSelectModel={handleSelectModel}
          models={pickerModels}
          modelUnavailable={modelUnavailable}
          think={think}
          onChangeThink={setThink}
          contextLimit={selectedDescriptor?.contextLimit ?? null}
          effectiveContextBudget={selectedDescriptor?.effectiveContextBudget ?? null}
          attachments={attachments.items.map((item) => ({
            key: item.key,
            fileName: item.fileName,
            byteSize: item.byteSize,
            charCount: item.charCount,
            status: item.status,
            truncated: item.meta?.truncated ?? false,
            errorCode: item.errorCode,
          }))}
          onAddFiles={attachments.addFiles}
          onRemoveAttachment={attachments.remove}
          isDragOverExternal={attachmentDrop.dragging}
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
