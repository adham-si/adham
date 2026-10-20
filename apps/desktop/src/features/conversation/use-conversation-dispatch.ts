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
import type { ConversationStatus, UiMessage } from './use-conversation';

/** Everything the write-path dispatch (submit) touches from the owning hook.
 * Refs and setters are shared ownership — they mutate or update state that
 * loadHistory, bootstrap, and the composer also read. */
export type DispatchDeps = {
  backend: ConversationBackend;
  context: ConversationContext | null;
  bootstrap: () => Promise<ConversationContext | null>;
  mountedRef: React.RefObject<boolean>;
  generationRef: React.RefObject<number>;
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
};

/** The text-only write path, split out of use-conversation for the
 * file-size policy. Body moved verbatim; the streaming surface lives in
 * use-conversation-stream. */
export function useConversationDispatch(deps: DispatchDeps) {
  const {
    backend,
    context,
    bootstrap,
    mountedRef,
    generationRef,
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
  } = deps;

  const submit = React.useCallback(
    async (text: string): Promise<SubmitOutcome> => {
      const trimmed = text.trim();
      if (!trimmed)
        return { ok: false, error: i18n.t('conversation.emptyMessage'), uncertain: false };
      // Pre-dispatch refusals surface through the same error state as
      // failures: a blocked send must never look like a dead button.
      const refuse = (message: string, uncertain = false): SubmitOutcome => {
        setError(message);
        return { ok: false, error: message, uncertain };
      };
      const blocked = sendBlockedReason(scopeStaleRef.current);
      if (blocked) return refuse(blocked);
      // Controller-boundary guard: overlapping submits are rejected before
      // any dispatch, not merely hidden by a later busy render. The guard
      // is acquired BEFORE the bootstrap await below, so two submits that
      // both arrive before the context exists cannot both proceed.
      if (submitInFlightRef.current) {
        return refuse(i18n.t('conversation.alreadySaving'));
      }
      const preSwitch = switchUnresolved(requestedRef.current, context?.sessionId);
      if (preSwitch) return refuse(preSwitch.error, preSwitch.uncertain);
      submitInFlightRef.current = true;
      try {
        let ctx = context;
        if (!ctx) {
          setStatus('bootstrapping');
          ctx = await bootstrap();
          if (!ctx) return refuse(i18n.t('conversation.notReady'));
          const postSwitch = switchUnresolved(requestedRef.current, ctx.sessionId);
          if (postSwitch) return refuse(postSwitch.error, postSwitch.uncertain);
        }

        const pendingFirstBlocked = pendingFirstSendBlockedReason(
          ctx.workspaceId,
          ctx.projectId,
          trimmed,
        );
        if (pendingFirstBlocked) {
          return refuse(pendingFirstBlocked, true);
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
    [
      backend,
      bootstrap,
      context,
      createdRef,
      generationRef,
      installationIdRef,
      mountedRef,
      mutationSeqRef,
      requestedRef,
      scopeStaleRef,
      setContext,
      setError,
      setMessages,
      setPendingSend,
      setStatus,
      setStorageWarning,
      submitInFlightRef,
    ],
  );

  return { submit };
}
