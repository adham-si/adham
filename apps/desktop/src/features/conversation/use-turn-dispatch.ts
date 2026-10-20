import * as React from 'react';
import { useTranslation } from 'react-i18next';
import type { MessageAttachmentDto } from '@adham/contracts-generated';
import type { ComposeMode, QueuedInstruction } from '@/widgets/compose';
import type { PendingFile, useAttachments } from './attachments';
import type { UiMessageReference, useConversation } from './use-conversation';

export interface PendingReference {
  id: string;
  relation: UiMessageReference['relation'];
  excerpt: string | null;
  /** Draft restored when an edit is cancelled; undefined = leave as-is. */
  priorDraft?: string;
}

export type TurnAction = {
  attemptId: string;
  userId: string;
  verb: 'regenerate' | 'retry';
};

interface UseTurnDispatchParams {
  conv: ReturnType<typeof useConversation>;
  attachments: ReturnType<typeof useAttachments>;
  streamReady: boolean;
  ollamaAccountId: string | undefined;
  selectedModelId: string;
  mode: ComposeMode;
  think: boolean | string | null;
  draftRef: React.RefObject<string>;
  setDraft: (text: string) => void;
  commitPrompt: (text: string) => void;
  setSubmitError: (error: string | null) => void;
}

/**
 * The composer's send path: one turn at a time, a visible queue for
 * instructions typed while it runs, and a pending reply/edit reference that
 * survives a refused send. Extracted from the panel so the orchestration and
 * the render tree stay within the repository's file-size limit.
 */
export function useTurnDispatch({
  conv,
  attachments,
  streamReady,
  ollamaAccountId,
  selectedModelId,
  mode,
  think,
  draftRef,
  setDraft,
  commitPrompt,
  setSubmitError,
}: UseTurnDispatchParams) {
  const { t } = useTranslation();
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
  const [pendingReference, setPendingReference] = React.useState<PendingReference | null>(null);
  const cancelPendingReference = React.useCallback(() => {
    if (pendingReference?.priorDraft !== undefined) setDraft(pendingReference.priorDraft);
    setPendingReference(null);
  }, [pendingReference, setDraft]);

  const busy =
    conv.status === 'submitting' || conv.status === 'bootstrapping' || conv.streaming !== null;

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
      attachmentMetas: MessageAttachmentDto[] = [],
      onAccepted?: () => void,
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
              ollamaAccountId!,
              selectedModelId,
              mode,
              // The documented `think` value; null = model default (omitted).
              think ?? undefined,
              reference,
              attachmentIds,
              pendingFiles,
              attachmentMetas,
              onAccepted,
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
    [
      conv,
      streamReady,
      ollamaAccountId,
      selectedModelId,
      mode,
      think,
      setDraft,
      setSubmitError,
      draftRef,
      t,
    ],
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
      attachmentMetas: MessageAttachmentDto[] = [],
      onAccepted?: () => void,
    ) => {
      let outcome = await dispatchTurn(
        sent,
        reference,
        attachmentIds,
        pendingFiles,
        attachmentMetas,
        onAccepted,
      );
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
  const turnAction = React.useMemo<TurnAction | null>(() => {
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
      .retryTurn(turnAction.userId, ollamaAccountId!, selectedModelId, mode, think ?? undefined)
      .then((outcome) => {
        if (!outcome.ok) setSubmitError(outcome.error);
      });
  }, [
    turnAction,
    busy,
    streamReady,
    t,
    conv,
    ollamaAccountId,
    selectedModelId,
    mode,
    think,
    setSubmitError,
  ]);

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
    // The exact selections this send carries: only these leave the composer
    // once the turn is accepted (a file added meanwhile stays for next turn).
    const sentKeys = attachments.items.map((item) => item.key);
    const readyMetas = attachments.items.flatMap((item) =>
      item.status === 'ready' && item.meta ? [item.meta] : [],
    );
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
    // The composer clears when the backend accepts the turn — not when the
    // answer settles. Waiting for the stream made a sent file look unsent for
    // the whole generation. A refusal never reaches onAccepted, so its files
    // stay for the retry.
    await dispatchAndDrain(text, reference, readyIds, pendingFiles, readyMetas, () =>
      attachments.clear(sentKeys),
    );
  }, [
    attachments,
    busy,
    commitPrompt,
    dispatchAndDrain,
    setQueuedBoth,
    pendingReference,
    streamReady,
    t,
    draftRef,
    setSubmitError,
  ]);

  const removeQueued = React.useCallback(
    (id: string) => {
      setQueuedBoth(queuedRef.current.filter((item) => item.id !== id));
    },
    [setQueuedBoth],
  );

  return {
    busy,
    queued,
    pendingReference,
    setPendingReference,
    cancelPendingReference,
    turnAction,
    handleTurnAction,
    handleSubmit,
    removeQueued,
  };
}
