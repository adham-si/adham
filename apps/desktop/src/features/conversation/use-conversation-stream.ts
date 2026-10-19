import * as React from 'react';
import type { CompletionStartDto, StreamEventDto } from '@adham/contracts-generated';
import i18n from '@/shared/i18n';
import { sendBlockedReason } from './conversation-identity';
import {
  type ConversationBackend,
  type ConversationContext,
  type SubmitOutcome,
  switchUnresolved,
} from './conversation-scope';
import { persistAndAnnounceActiveSession } from './durable-session-storage';
import { pendingFirstSendBlockedReason, prepareLazyFirstSend } from './lazy-session-creation';
import { clearDurablePendingOperation } from './pending-recovery/durable-pending-operations';
import type {
  ConversationStatus,
  StreamingSnapshot,
  UiMessage,
  UiMessageReference,
} from './use-conversation';

/** Everything the streaming dispatch surface (streamOnce / retryTurn / stop)
 * touches from the owning hook. Refs and setters are shared ownership — they
 * mutate or update state that loadHistory, bootstrap, and the composer also
 * read. */
export type StreamDeps = {
  backend: ConversationBackend;
  context: ConversationContext | null;
  loadHistory: (
    ctx: ConversationContext,
    generation: number,
    loadSeq: number,
    mutationSeq: number,
  ) => Promise<UiMessage[] | null>;
  isStale: (gen: number, load: number, mut: number, sessId?: string) => boolean;
  mountedRef: React.RefObject<boolean>;
  generationRef: React.RefObject<number>;
  loadSeqRef: React.RefObject<number>;
  mutationSeqRef: React.RefObject<number>;
  requestedRef: React.RefObject<ConversationContext | null>;
  scopeStaleRef: React.RefObject<boolean>;
  submitInFlightRef: React.RefObject<boolean>;
  installationIdRef: React.RefObject<string | null>;
  createdRef: React.RefObject<ConversationContext | null>;
  setContext: React.Dispatch<React.SetStateAction<ConversationContext | null>>;
  setMessages: React.Dispatch<React.SetStateAction<UiMessage[]>>;
  setError: React.Dispatch<React.SetStateAction<string | null>>;
  setStatus: React.Dispatch<React.SetStateAction<ConversationStatus>>;
  setStorageWarning: React.Dispatch<React.SetStateAction<string | null>>;
  setOmittedMessages: React.Dispatch<React.SetStateAction<number>>;
  setRecoverySnapshot: React.Dispatch<React.SetStateAction<UiMessage | null>>;
};

/** Delivery A streaming surface, split out of use-conversation for the
 * file-size policy: the single live snapshot plus the dispatches that drive
 * it (fresh send, retry, stop). The text-only write path stays in
 * use-conversation-dispatch. */
export function useConversationStream(deps: StreamDeps) {
  const {
    backend,
    context,
    loadHistory,
    isStale,
    mountedRef,
    generationRef,
    loadSeqRef,
    mutationSeqRef,
    requestedRef,
    scopeStaleRef,
    submitInFlightRef,
    installationIdRef,
    createdRef,
    setContext,
    setMessages,
    setError,
    setStatus,
    setStorageWarning,
    setOmittedMessages,
    setRecoverySnapshot,
  } = deps;

  const [streaming, setStreamingState] = React.useState<StreamingSnapshot | null>(null);
  const streamingRef = React.useRef<StreamingSnapshot | null>(null);
  const setStreaming = React.useCallback((next: StreamingSnapshot | null) => {
    streamingRef.current = next;
    setStreamingState(next);
  }, []);
  // Stop clicked before the op handle arrived: effectuated on first event.
  const stopRequestedRef = React.useRef(false);

  /**
   * One streaming dispatch onto the single live snapshot: the waiting state
   * exists before the socket does (Stop is reachable during connect and
   * thinking), deltas stream in order, the terminal is awaited, and the
   * authoritative history reload hands off with the recovery-snapshot
   * fallback. Shared by a fresh send and by a retry/regenerate attempt, so
   * both obey the same sequencing rules.
   */
  const runStreamDispatch = React.useCallback(
    async (opts: {
      ctx: ConversationContext;
      sessionId: string;
      generation: number;
      /** Starts the op and resolves with the durable start handle. May do
       *  post-write bookkeeping (first-send identity) before returning. */
      dispatch: (onEvent: (event: StreamEventDto) => void) => Promise<CompletionStartDto>;
      /** Runs when the dispatch threw before any terminal: the send path
       *  removes its optimistic bubble and dismisses its tracked identity. */
      onDispatchFailure: () => Promise<void> | void;
    }): Promise<SubmitOutcome> => {
      const { ctx, sessionId, generation } = opts;
      const stopCompletion = backend.stopCompletion;
      // Waiting begins at dispatch: the live snapshot exists before the
      // socket does, so Stop is reachable during connect and thinking.
      stopRequestedRef.current = false;
      const startedAt = Date.now();
      setStreaming({ opId: '', text: '', phase: 'waiting', startedAt });
      // The previous turn's truncation notice belongs to that dispatch only.
      setOmittedMessages(0);

      let opId: string | null = null;
      let terminalSeen = false;
      let resolveTerminal!: (completion: 'completed' | 'interrupted' | 'failed') => void;
      const terminalPromise = new Promise<'completed' | 'interrupted' | 'failed'>((resolve) => {
        resolveTerminal = resolve;
      });

      try {
        const start = await opts.dispatch((event: StreamEventDto) => {
          if (!mountedRef.current || generationRef.current !== generation) return;
          if (opId === null) {
            opId = event.opId;
            const state = streamingRef.current;
            if (state) setStreaming({ ...state, opId: event.opId });
            // A Stop clicked before the op handle arrived is effectuated
            // here: cancellation never waits for an answer delta.
            if (stopRequestedRef.current && stopCompletion) {
              void stopCompletion(ctx.workspaceId, ctx.projectId, sessionId, event.opId).catch(
                () => undefined,
              );
            }
          }
          if (event.opId !== opId) return;
          if (event.event.type === 'delta') {
            const previous =
              streamingRef.current?.opId === event.opId ? streamingRef.current.text : '';
            setStreaming({
              opId: event.opId,
              text: previous + event.event.text,
              phase: 'streaming',
              startedAt: streamingRef.current?.startedAt ?? startedAt,
            });
          } else if (event.event.type === 'thinking') {
            // Thinking is surfaced only on real reasoning activity; elapsed
            // time never fabricates this status.
            const state = streamingRef.current;
            if (state && state.phase === 'waiting') {
              setStreaming({ ...state, phase: 'thinking' });
            }
          } else if (event.event.type === 'completed' && !terminalSeen) {
            terminalSeen = true;
            // Only the documented values pass through; anything else is a
            // contract violation and resolves failed, never completed.
            const completion = event.event.completion;
            resolveTerminal(
              completion === 'completed' || completion === 'interrupted' ? completion : 'failed',
            );
          }
        });
        if (!mountedRef.current || generationRef.current !== generation) {
          return { ok: false, error: i18n.t('conversation.sessionChanged'), uncertain: false };
        }
        // First stream event may arrive before the start handle resolves.
        if (opId === null) opId = start.opId;
        const pending = streamingRef.current;
        if (pending && pending.opId === '') setStreaming({ ...pending, opId: start.opId });
        // Assembly summary of this dispatch: history dropped to fit the model
        // context is surfaced, never silent.
        if (mountedRef.current && generationRef.current === generation) {
          setOmittedMessages(start.context?.droppedMessages ?? 0);
        }
        await terminalPromise;
        // Handoff ordering is atomic in the render sense: the live bubble is
        // dropped BEFORE the authoritative rows land, and on a failed history
        // reload the streamed answer stays visible as a non-authoritative
        // recovery snapshot — the generation itself is never repeated.
        const answerText = streamingRef.current?.text ?? '';
        setStreaming(null);
        try {
          if (mountedRef.current && generationRef.current === generation) {
            loadSeqRef.current += 1;
            const reloadSeq = loadSeqRef.current;
            const items = await loadHistory(ctx, generation, reloadSeq, mutationSeqRef.current);
            if (
              items === null &&
              answerText !== '' &&
              mountedRef.current &&
              generationRef.current === generation &&
              !isStale(generation, reloadSeq, mutationSeqRef.current, sessionId)
            ) {
              setRecoverySnapshot({
                id: `recovery-${opId ?? 'terminal'}`,
                role: 'assistant',
                text: answerText,
                createdAt: new Date().toISOString(),
              });
            }
          }
        } finally {
          streamingRef.current = null;
        }
        return { ok: true };
      } catch (err) {
        setStreaming(null);
        await opts.onDispatchFailure();
        const code = err instanceof Error ? err.message : String(err);
        setError(code);
        setStatus('error');
        return { ok: false, error: code, uncertain: true };
      } finally {
        stopRequestedRef.current = false;
        submitInFlightRef.current = false;
      }
    },
    [
      backend,
      isStale,
      loadHistory,
      loadSeqRef,
      mountedRef,
      generationRef,
      mutationSeqRef,
      setError,
      setOmittedMessages,
      setRecoverySnapshot,
      setStatus,
      setStreaming,
      submitInFlightRef,
    ],
  );

  const streamOnce = React.useCallback(
    async (
      text: string,
      accountId: string,
      modelId: string,
      mode: 'ask' | 'plan' | 'code' | 'execute',
      /** Documented thinking parameter value; undefined = model default.
       *  Only values the model documents in /api/show are accepted (the
       *  backend refuses anything else before dispatch). */
      think?: boolean | string,
      /** Durable reply anchor recorded with the turn; omitted = no quote. */
      reference?: UiMessageReference,
    ): Promise<SubmitOutcome> => {
      const trimmed = text.trim();
      if (!trimmed)
        return { ok: false, error: i18n.t('conversation.emptyMessage'), uncertain: false };
      const completeOnceStreaming = backend.completeOnceStreaming;
      if (!completeOnceStreaming || !backend.stopCompletion) {
        return { ok: false, error: i18n.t('conversation.notReady'), uncertain: false };
      }
      let ctx = context;
      if (!ctx) {
        return { ok: false, error: i18n.t('conversation.notReady'), uncertain: false };
      }
      const blocked = sendBlockedReason(scopeStaleRef.current);
      if (blocked) return { ok: false, error: blocked, uncertain: false };
      // Same controller-boundary guard as submit: one live dispatch at a time.
      if (submitInFlightRef.current) {
        return { ok: false, error: i18n.t('conversation.alreadySaving'), uncertain: false };
      }
      const preSwitch = switchUnresolved(requestedRef.current, ctx.sessionId);
      if (preSwitch) return preSwitch;

      const generation = generationRef.current;
      // First turn of an unsaved conversation: streaming needs a session, so
      // create it first under the tracked first-send identity (the same durable
      // record the text-only path uses). The identity is resolved once the
      // dispatch is confirmed persisted; the provider operation written by the
      // backend is then the durable record of the turn itself.
      let firstSend: { messageRequestId: string; title: string } | null = null;
      let sessionId = ctx.sessionId;
      if (!sessionId) {
        // The creation step holds the single-dispatch gate too, so a second
        // Enter cannot mint a second identity for the same turn.
        submitInFlightRef.current = true;
        const blockedFirst = pendingFirstSendBlockedReason(ctx.workspaceId, ctx.projectId, trimmed);
        if (blockedFirst) {
          submitInFlightRef.current = false;
          return { ok: false, error: blockedFirst, uncertain: true };
        }
        const prepared = await prepareLazyFirstSend({
          backend,
          workspaceId: ctx.workspaceId,
          projectId: ctx.projectId,
          text: trimmed,
          installationId: ctx.installationId ?? installationIdRef.current,
          isStale: () => !mountedRef.current || generationRef.current !== generation,
        });
        if (!mountedRef.current || generationRef.current !== generation) {
          submitInFlightRef.current = false;
          return { ok: false, error: i18n.t('conversation.sessionChanged'), uncertain: false };
        }
        if (!prepared.ok) {
          submitInFlightRef.current = false;
          setError(prepared.error);
          setStatus('error');
          return prepared;
        }
        firstSend = { messageRequestId: prepared.messageRequestId, title: prepared.title };
        ctx = prepared.context;
        sessionId = prepared.sessionId;
        setContext(ctx);
        createdRef.current = ctx;
        requestedRef.current = ctx;
      }

      submitInFlightRef.current = true;
      setError(null);
      // Optimistic user bubble; the terminal reload replaces the whole list
      // with the authoritative persisted rows (including the streamed turn).
      mutationSeqRef.current += 1;
      setMessages((prev) => [
        ...prev,
        {
          id: 'streaming-user-bubble',
          role: 'user',
          text: trimmed,
          createdAt: new Date().toISOString(),
          reference: reference ?? null,
          provisional: true,
        },
      ]);

      return runStreamDispatch({
        ctx,
        sessionId,
        generation,
        dispatch: async (onEvent) => {
          const start = await completeOnceStreaming(
            ctx.workspaceId,
            ctx.projectId,
            sessionId,
            {
              accountId,
              modelId,
              text: trimmed,
              mode,
              ...(think === undefined ? {} : { think }),
              ...(reference === undefined ? {} : { reference }),
            },
            onEvent,
          );
          if (firstSend) {
            // The dispatch is confirmed persisted, so the tracked first-send
            // identity has done its job: resolve it now. A recovery surface must
            // never offer to resend a message that already landed; an unresolved
            // turn is the backend's provider operation, not this record.
            const cleared = await clearDurablePendingOperation(backend, {
              operationId: firstSend.messageRequestId,
              expectedMessageRequestId: firstSend.messageRequestId,
              reason: 'resolved',
            });
            if (!cleared.ok) {
              setStorageWarning(cleared.error ?? i18n.t('conversation.recovery.cleanupFailed'));
            }
            const instId = ctx.installationId ?? installationIdRef.current;
            if (!persistAndAnnounceActiveSession({ ...ctx, title: firstSend.title }, instId)) {
              setStorageWarning(i18n.t('conversation.storageUnavailable'));
            }
          }
          return start;
        },
        onDispatchFailure: async () => {
          // Dispatch failed before/at the socket: the user turn was never
          // persisted, so the optimistic bubble is removed.
          setMessages((prev) => prev.filter((m) => m.id !== 'streaming-user-bubble'));
          if (firstSend) {
            // The session now exists, so the first-send identity is superseded:
            // if the turn did persist, the backend's provider operation is its
            // durable record; if it did not, the text is back in the composer.
            // Leaving the record pending would offer a duplicate resend.
            await clearDurablePendingOperation(backend, {
              operationId: firstSend.messageRequestId,
              expectedMessageRequestId: firstSend.messageRequestId,
              reason: 'dismissed',
            });
          }
        },
      });
    },
    [
      backend,
      context,
      createdRef,
      generationRef,
      installationIdRef,
      mountedRef,
      mutationSeqRef,
      requestedRef,
      runStreamDispatch,
      scopeStaleRef,
      setContext,
      setError,
      setMessages,
      setStatus,
      setStorageWarning,
      submitInFlightRef,
    ],
  );

  /**
   * Retry a failed turn / regenerate an answer: ONE new attempt against the
   * same user turn. No user row is written and no previous attempt is
   * replaced — the original history stays, and the attempt is an explicit
   * dispatch with its own op handle (Stop applies to it like any run).
   */
  const retryTurn = React.useCallback(
    async (
      replyToMessageId: string,
      accountId: string,
      modelId: string,
      mode: 'ask' | 'plan' | 'code' | 'execute',
      /** Documented thinking parameter value; undefined = model default. */
      think?: boolean | string,
    ): Promise<SubmitOutcome> => {
      const retryCompletionStreaming = backend.retryCompletionStreaming;
      if (!retryCompletionStreaming || !backend.stopCompletion) {
        return { ok: false, error: i18n.t('conversation.notReady'), uncertain: false };
      }
      const ctx = context;
      const sessionId = ctx?.sessionId;
      if (!ctx || !sessionId) {
        return { ok: false, error: i18n.t('conversation.notReady'), uncertain: false };
      }
      const blocked = sendBlockedReason(scopeStaleRef.current);
      if (blocked) return { ok: false, error: blocked, uncertain: false };
      // Same controller-boundary guard as a send: one live dispatch at a time.
      if (submitInFlightRef.current) {
        return { ok: false, error: i18n.t('conversation.alreadySaving'), uncertain: false };
      }
      const preSwitch = switchUnresolved(requestedRef.current, sessionId);
      if (preSwitch) return preSwitch;

      const generation = generationRef.current;
      submitInFlightRef.current = true;
      setError(null);
      return runStreamDispatch({
        ctx,
        sessionId,
        generation,
        dispatch: (onEvent) =>
          retryCompletionStreaming(
            ctx.workspaceId,
            ctx.projectId,
            sessionId,
            {
              accountId,
              modelId,
              replyToMessageId,
              mode,
              ...(think === undefined ? {} : { think }),
            },
            onEvent,
          ),
        // There is no optimistic bubble and no tracked identity here: a
        // dispatch failure leaves history exactly as it was.
        onDispatchFailure: () => undefined,
      });
    },
    [
      backend,
      context,
      generationRef,
      requestedRef,
      runStreamDispatch,
      scopeStaleRef,
      setError,
      submitInFlightRef,
    ],
  );

  const stop = React.useCallback(async (): Promise<SubmitOutcome> => {
    const state = streamingRef.current;
    const ctx = context;
    if (!state || !backend.stopCompletion || !ctx?.sessionId) {
      return {
        ok: false,
        error: i18n.t('conversation.stopUnavailable'),
        uncertain: false,
      };
    }
    // The op handle may still be in flight (dispatch just started): queue
    // the intent; the stream callback effectuates it once Started lands.
    if (!state.opId) {
      stopRequestedRef.current = true;
      return { ok: true };
    }
    try {
      await backend.stopCompletion(ctx.workspaceId, ctx.projectId, ctx.sessionId, state.opId);
      // The Interrupted terminal drives the reload through the stream.
      return { ok: true };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        uncertain: false,
      };
    }
  }, [backend, context]);

  return { streamOnce, retryTurn, stop, streaming };
}
