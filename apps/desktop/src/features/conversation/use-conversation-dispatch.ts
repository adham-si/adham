import * as React from 'react';
import i18n from '@/shared/i18n';
import { sendBlockedReason } from './conversation-identity';
import {
  type ConversationBackend,
  type ConversationContext,
  type SubmitOutcome,
  switchUnresolved,
} from './conversation-scope';
import { persistAndAnnounceActiveSession } from './durable-session-storage';
import {
  pendingFirstSendBlockedReason,
  performLazyFirstSend,
  readPendingFirstSend,
} from './lazy-session-creation';
import { performSingleMessageSend } from './single-message-send';
import type { ConversationStatus, StreamingSnapshot, UiMessage } from './use-conversation';

/** Everything the dispatch surface (submit / streamOnce / stop) touches from
 * the owning hook. Refs and setters are shared ownership — they mutate or
 * update state that loadHistory, bootstrap, and the composer also read. */
export type DispatchDeps = {
  backend: ConversationBackend;
  context: ConversationContext | null;
  bootstrap: () => Promise<ConversationContext | null>;
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
  setPendingSend: React.Dispatch<
    React.SetStateAction<import('./conversation-identity').PendingSend | null>
  >;
  setRecoverySnapshot: React.Dispatch<React.SetStateAction<UiMessage | null>>;
};

/** Delivery A dispatch surface, split out of use-conversation for the
 * file-size policy. Body moved verbatim; owns only the live-streaming
 * snapshot state — all other state stays in the owning hook. */
export function useConversationDispatch(deps: DispatchDeps) {
  const {
    backend,
    context,
    bootstrap,
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
    setPendingSend,
    setRecoverySnapshot,
  } = deps;

  const submit = React.useCallback(
    async (text: string): Promise<SubmitOutcome> => {
      const trimmed = text.trim();
      if (!trimmed)
        return { ok: false, error: i18n.t('conversation.emptyMessage'), uncertain: false };
      const blocked = sendBlockedReason(scopeStaleRef.current);
      if (blocked) return { ok: false, error: blocked, uncertain: false };
      // Controller-boundary guard: overlapping submits are rejected before
      // any dispatch, not merely hidden by a later busy render. The guard
      // is acquired BEFORE the bootstrap await below, so two submits that
      // both arrive before the context exists cannot both proceed.
      if (submitInFlightRef.current) {
        return { ok: false, error: i18n.t('conversation.alreadySaving'), uncertain: false };
      }
      const preSwitch = switchUnresolved(requestedRef.current, context?.sessionId);
      if (preSwitch) return preSwitch;
      submitInFlightRef.current = true;
      try {
        let ctx = context;
        if (!ctx) {
          setStatus('bootstrapping');
          ctx = await bootstrap();
          if (!ctx) return { ok: false, error: i18n.t('conversation.notReady'), uncertain: false };
          const postSwitch = switchUnresolved(requestedRef.current, ctx.sessionId);
          if (postSwitch) return postSwitch;
        }

        const pendingFirstBlocked = pendingFirstSendBlockedReason(
          ctx.workspaceId,
          ctx.projectId,
          trimmed,
        );
        if (pendingFirstBlocked) {
          return { ok: false, error: pendingFirstBlocked, uncertain: true };
        }

        const pendingFirst = readPendingFirstSend();
        const isPendingFirstRetryWithNullSession =
          pendingFirst !== null &&
          pendingFirst.workspaceId === ctx.workspaceId &&
          pendingFirst.projectId === ctx.projectId &&
          pendingFirst.sessionId === null &&
          pendingFirst.text === trimmed;

        if (ctx.sessionId === null || isPendingFirstRetryWithNullSession) {
          const generation = generationRef.current;
          setStatus('submitting');
          setError(null);
          const outcome = await performLazyFirstSend({
            backend,
            workspaceId: ctx.workspaceId,
            projectId: ctx.projectId,
            text: trimmed,
            installationId: ctx.installationId ?? installationIdRef.current,
            isStale: () => !mountedRef.current || generationRef.current !== generation,
          });
          if (!mountedRef.current || generationRef.current !== generation) {
            return { ok: false, error: i18n.t('conversation.sessionChanged'), uncertain: false };
          }
          if (outcome.ok) {
            setContext(outcome.context);
            createdRef.current = outcome.context;
            requestedRef.current = outcome.context;
            mutationSeqRef.current += 1;
            setMessages((prev) =>
              ctx.sessionId === outcome.context.sessionId
                ? prev.some((m) => m.id === outcome.message.id)
                  ? prev
                  : [...prev, outcome.message]
                : [outcome.message],
            );
            const instId = outcome.context.installationId ?? installationIdRef.current;
            if (
              !persistAndAnnounceActiveSession({ ...outcome.context, title: outcome.title }, instId)
            ) {
              setStorageWarning(i18n.t('conversation.storageUnavailable'));
            } else if (outcome.cleanupWarning) {
              setStorageWarning(outcome.cleanupWarning);
            }
            setStatus('ready');
            return { ok: true };
          } else {
            if (outcome.createdContext) {
              setContext(outcome.createdContext);
              createdRef.current = outcome.createdContext;
              requestedRef.current = outcome.createdContext;
            }
            setError(outcome.error);
            setStatus('error');
            return { ok: false, error: outcome.error, uncertain: outcome.uncertain };
          }
        }
        const generation = generationRef.current;
        setStatus('submitting');
        setError(null);
        const singleOutcome = await performSingleMessageSend({
          backend,
          workspaceId: ctx.workspaceId,
          projectId: ctx.projectId,
          sessionId: ctx.sessionId,
          text: trimmed,
          isStale: () => !mountedRef.current || generationRef.current !== generation,
          onIdentityRecorded: (rec) => {
            if (mountedRef.current && generationRef.current === generation) setPendingSend(rec);
          },
          onIdentityCleared: () => {
            if (mountedRef.current && generationRef.current === generation) setPendingSend(null);
          },
        });
        if (!mountedRef.current || generationRef.current !== generation) {
          return { ok: false, error: i18n.t('conversation.sessionChanged'), uncertain: false };
        }

        if (singleOutcome.ok) {
          mutationSeqRef.current += 1;
          setMessages((prev) =>
            prev.some((m) => m.id === singleOutcome.message.id)
              ? prev
              : [...prev, singleOutcome.message],
          );
          if (singleOutcome.cleanupWarning) {
            setStorageWarning(singleOutcome.cleanupWarning);
          }
          setStatus('ready');
          return { ok: true };
        } else {
          setError(singleOutcome.displayError ?? singleOutcome.error);
          setStatus('error');
          return {
            ok: false,
            error: singleOutcome.error,
            uncertain: singleOutcome.uncertain,
          };
        }
      } finally {
        submitInFlightRef.current = false;
      }
    },
    [backend, bootstrap, context],
  );

  // ===== Delivery A: streaming completion (complete_once_streaming) =====
  const [streaming, setStreamingState] = React.useState<StreamingSnapshot | null>(null);
  const streamingRef = React.useRef<StreamingSnapshot | null>(null);
  const setStreaming = React.useCallback((next: StreamingSnapshot | null) => {
    streamingRef.current = next;
    setStreamingState(next);
  }, []);

  const streamOnce = React.useCallback(
    async (text: string, accountId: string, modelId: string): Promise<SubmitOutcome> => {
      const trimmed = text.trim();
      if (!trimmed)
        return { ok: false, error: i18n.t('conversation.emptyMessage'), uncertain: false };
      if (!backend.completeOnceStreaming || !backend.stopCompletion) {
        return { ok: false, error: i18n.t('conversation.notReady'), uncertain: false };
      }
      const ctx = context;
      if (!ctx || !ctx.sessionId) {
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

      submitInFlightRef.current = true;
      const generation = generationRef.current;
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
        },
      ]);

      let opId: string | null = null;
      let terminalSeen = false;
      let resolveTerminal!: (completion: 'completed' | 'interrupted' | 'failed') => void;
      const terminalPromise = new Promise<'completed' | 'interrupted' | 'failed'>((resolve) => {
        resolveTerminal = resolve;
      });

      try {
        const start = await backend.completeOnceStreaming(
          ctx.workspaceId,
          ctx.projectId,
          ctx.sessionId,
          { accountId, modelId, text: trimmed },
          (event) => {
            if (!mountedRef.current || generationRef.current !== generation) return;
            if (opId === null) opId = event.opId;
            if (event.opId !== opId) return;
            if (event.event.type === 'delta') {
              const previous =
                streamingRef.current?.opId === event.opId ? streamingRef.current.text : '';
              setStreaming({ opId: event.opId, text: previous + event.event.text });
            } else if (event.event.type === 'completed' && !terminalSeen) {
              terminalSeen = true;
              // Generated DTO types the completion as string; only the
              // documented values pass through, unknowns resolve completed.
              const completion = event.event.completion;
              resolveTerminal(
                completion === 'interrupted' || completion === 'failed' ? completion : 'completed',
              );
            }
          },
        );
        if (!mountedRef.current || generationRef.current !== generation) {
          return { ok: false, error: i18n.t('conversation.sessionChanged'), uncertain: false };
        }
        // First stream event may arrive before the start handle resolves.
        if (opId === null) opId = start.opId;
        if (streamingRef.current?.opId !== opId) setStreaming({ opId, text: '' });
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
              !isStale(generation, reloadSeq, mutationSeqRef.current, ctx.sessionId)
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
        // Dispatch failed before/at the socket: the user turn was never
        // persisted, so the optimistic bubble is removed.
        setMessages((prev) => prev.filter((m) => m.id !== 'streaming-user-bubble'));
        const code = err instanceof Error ? err.message : String(err);
        setError(code);
        setStatus('error');
        return { ok: false, error: code, uncertain: true };
      } finally {
        submitInFlightRef.current = false;
      }
    },
    [backend, context, loadHistory, isStale, setStreaming],
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
  return { submit, streamOnce, stop, streaming };
}
