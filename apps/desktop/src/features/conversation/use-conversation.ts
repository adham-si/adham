import * as React from 'react';
import i18n from '@/shared/i18n';
import {
  SESSION_CACHE_KEY,
  readPendingSend,
  sameScope,
  sendBlockedReason,
  type PendingSend,
  removeStorage,
} from './conversation-identity';
import {
  performLazyFirstSend,
  readPendingFirstSend,
  pendingFirstSendBlockedReason,
} from './lazy-session-creation';
import { performSingleMessageSend } from './single-message-send';
import {
  type ConversationBackend,
  type ConversationContext,
  resolveAuthoritativeSession,
  switchUnresolved,
  toUiMessage,
  conversationCapabilities,
  type SubmitOutcome,
} from './conversation-scope';
import {
  isDurableSessionStorageAvailable,
  persistAndAnnounceActiveSession,
} from './durable-session-storage';

export { conversationCapabilities } from './conversation-scope';
export type {
  BootstrapSnapshot,
  ConversationBackend,
  ConversationContext,
  ConversationSnapshot,
  SessionSnapshot,
  SubmittedSnapshot,
  SubmitOutcome,
} from './conversation-scope';
export type { PendingSend } from './conversation-identity';

export type UiMessage = { id: string; role: string; text: string; createdAt: string };

export type ConversationStatus =
  | 'bootstrapping'
  | 'needs-workspace'
  | 'needs-project'
  | 'ready'
  | 'submitting'
  | 'error';

export function useConversation({ backend }: { backend: ConversationBackend }) {
  const [status, setStatus] = React.useState<ConversationStatus>('bootstrapping');
  const [messages, setMessages] = React.useState<UiMessage[]>([]);
  const [context, setContext] = React.useState<ConversationContext | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [storageWarning, setStorageWarning] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!isDurableSessionStorageAvailable()) {
      setStorageWarning(i18n.t('conversation.storageUnavailable'));
    }
  }, []);
  // Authoritative selection from the latest bootstrap snapshot. Surfaced so
  // provisioning can bind project creation to the backend-issued workspace
  // without re-fetching or trusting cached IDs.
  const [activeWorkspaceId, setActiveWorkspaceId] = React.useState<string | null>(null);
  // Hydrated from sessionStorage so a remount never loses the frozen
  // logical command of an unresolved write.
  const [pendingSend, setPendingSend] = React.useState<PendingSend | null>(() => readPendingSend());

  const mountedRef = React.useRef(true);
  const bootPromiseRef = React.useRef<Promise<ConversationContext | null> | null>(null);
  const generationRef = React.useRef(0);
  const createdRef = React.useRef<ConversationContext | null>(null);
  const installationIdRef = React.useRef<string | null>(null);
  // Read ordering: every history load captures the load sequence and the
  // mutation sequence at issue time, and applies only if neither moved.
  // A confirmed submit (mutation) invalidates older in-flight histories;
  // a newer load invalidates older ones however they complete.
  const loadSeqRef = React.useRef(0);
  const mutationSeqRef = React.useRef(0);
  // Requested session target: set the moment a switch is requested and
  // only superseded by a newer request. Retries and reloads target the
  // requested session, never silently the previous one.
  const requestedRef = React.useRef<ConversationContext | null>(null);
  // Stale-scope latch: set by refreshScope, cleared only when a fresh
  // bootstrap resolves to ready. While latched, sends are refused.
  const scopeStaleRef = React.useRef(false);
  // Controller-boundary submit guard: overlapping submits are rejected
  // before any dispatch, not merely hidden by a later busy render. Held
  // across the bootstrap await so two early submits cannot both proceed.
  const submitInFlightRef = React.useRef(false);

  React.useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const isStale = React.useCallback(
    (gen: number, load: number, mut: number, sessId?: string) =>
      !mountedRef.current ||
      generationRef.current !== gen ||
      loadSeqRef.current !== load ||
      mutationSeqRef.current !== mut ||
      (requestedRef.current !== null &&
        sessId !== undefined &&
        requestedRef.current.sessionId !== sessId),
    [],
  );

  const loadHistory = React.useCallback(
    async (
      ctx: ConversationContext,
      generation: number,
      loadSeq: number,
      mutationSeq: number,
      // True only for a history load issued by bootstrap for the scope it
      // just resolved authoritatively. Retained-context reloads, retries,
      // and session switches must never release the stale-scope latch: the
      // retained scope is not proof of the durable selection.
      verifiedScope = false,
    ): Promise<UiMessage[] | null> => {
      if (!ctx.sessionId) return null;
      try {
        const page = await backend.getConversation(ctx.workspaceId, ctx.projectId, ctx.sessionId);
        if (isStale(generation, loadSeq, mutationSeq, ctx.sessionId)) return null;
        const items = page.items.map(toUiMessage);
        setContext(ctx);
        setMessages(items);
        setError(null);
        setStatus('ready');
        if (verifiedScope) scopeStaleRef.current = false;
        return items;
      } catch (err) {
        if (isStale(generation, loadSeq, mutationSeq, ctx.sessionId)) return null;
        setError(err instanceof Error ? err.message : i18n.t('conversation.historyLoadFailed'));
        setStatus('error');
        return null;
      }
    },
    [backend, isStale],
  );

  const bootstrap = React.useCallback(async (): Promise<ConversationContext | null> => {
    if (bootPromiseRef.current) return bootPromiseRef.current;
    const run = (async () => {
      const generation = generationRef.current;
      const fail = (message: string) => {
        setError(message);
        setStatus('error');
      };
      const freshSeq = () => {
        loadSeqRef.current += 1;
        return { loadSeq: loadSeqRef.current, mutationSeq: mutationSeqRef.current };
      };
      const superseded = (seq: { loadSeq: number; mutationSeq: number }) =>
        !mountedRef.current ||
        generationRef.current !== generation ||
        loadSeqRef.current !== seq.loadSeq ||
        mutationSeqRef.current !== seq.mutationSeq;

      const isCurrentGen = () => !mountedRef.current || generationRef.current !== generation;
      const resolved = await resolveAuthoritativeSession(backend, isCurrentGen);
      if (isCurrentGen()) return null;

      if (resolved.kind === 'needs-workspace') {
        setActiveWorkspaceId(resolved.activeWorkspaceId);
        setStatus('needs-workspace');
        return null;
      }
      if (resolved.kind === 'needs-project') {
        setActiveWorkspaceId(resolved.activeWorkspaceId);
        setStatus('needs-project');
        return null;
      }
      if (resolved.kind === 'error') {
        bootPromiseRef.current = null;
        fail(resolved.message);
        return null;
      }

      setActiveWorkspaceId(resolved.context.workspaceId);
      if (resolved.context.installationId) {
        installationIdRef.current = resolved.context.installationId;
      }

      if (resolved.kind === 'ready-no-session') {
        setContext(resolved.context);
        createdRef.current = resolved.context;
        setMessages([]);
        const pendingFirst = readPendingFirstSend();
        if (
          pendingFirst &&
          pendingFirst.workspaceId === resolved.context.workspaceId &&
          pendingFirst.projectId === resolved.context.projectId
        ) {
          setError(i18n.t('conversation.firstSendPending'));
          setStatus('error');
        } else {
          setError(null);
          setStatus('ready');
        }
        scopeStaleRef.current = false;
        bootPromiseRef.current = null;
        return resolved.context;
      }

      const ctx = resolved.context;
      const seq = freshSeq();
      const loaded = await loadHistory(ctx, generation, seq.loadSeq, seq.mutationSeq, true);
      if (loaded !== null) {
        createdRef.current = ctx;
        const instId = ctx.installationId ?? installationIdRef.current;
        if (!persistAndAnnounceActiveSession(ctx, instId)) {
          setStorageWarning(i18n.t('conversation.storageUnavailable'));
        }
        const pendingFirst = readPendingFirstSend();
        if (
          pendingFirst &&
          pendingFirst.workspaceId === ctx.workspaceId &&
          pendingFirst.projectId === ctx.projectId
        ) {
          setError(i18n.t('conversation.firstSendPending'));
          setStatus('error');
        }
        scopeStaleRef.current = false;
        return ctx;
      }
      if (superseded(seq)) return null;
      bootPromiseRef.current = null;
      fail(
        resolved.kind === 'resumed'
          ? i18n.t('conversation.retryConnectivity', {
              message: i18n.t('conversation.historyNotLoaded'),
            })
          : i18n.t('conversation.reloadRetry', { message: i18n.t('conversation.startFailed') }),
      );
      return null;
    })();
    bootPromiseRef.current = run;
    return run;
  }, [backend, loadHistory]);

  React.useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  /// Re-run bootstrap after an out-of-band scope change (creation or
  /// selection): drops the settled run, bumps generation to discard
  /// old-scope history, and clears pending session switches. A read failure
  /// retries the read, never a fresh creation.
  const refreshScope = React.useCallback(() => {
    bootPromiseRef.current = null;
    generationRef.current += 1;
    requestedRef.current = null;
    createdRef.current = null;
    setContext(null);
    setMessages([]);
    scopeStaleRef.current = true;
    setStatus('bootstrapping');
    setError(null);
    void bootstrap();
  }, [bootstrap]);

  /// Reload history without submitting or creating anything. Targets the
  /// requested session when a switch is pending, so a failed switch
  /// followed by reload retries the requested target. Reload is READ-ONLY
  /// with respect to the frozen pending send: matching text in history is
  /// not proof of the same save (an older identical message would match),
  /// so the request identity is never cleared here. It resolves only
  /// through the response or receipt replay for that exact request.
  const reload = React.useCallback(async () => {
    if (scopeStaleRef.current || !context) {
      bootPromiseRef.current = null;
      await bootstrap();
      return;
    }
    const ctx = requestedRef.current ?? context ?? createdRef.current;
    if (!ctx) {
      bootPromiseRef.current = null;
      await bootstrap();
      return;
    }
    setStatus('bootstrapping');
    setError(null);
    loadSeqRef.current += 1;
    const items = await loadHistory(
      ctx,
      generationRef.current,
      loadSeqRef.current,
      mutationSeqRef.current,
    );
    if (items) {
      const pending = readPendingSend();
      if (
        pending &&
        ctx.sessionId !== null &&
        sameScope(pending, {
          workspaceId: ctx.workspaceId,
          projectId: ctx.projectId,
          sessionId: ctx.sessionId,
        })
      ) {
        // The history refresh succeeded, but the save is still
        // unresolved: keep the identity and say so instead of pretending
        // the refresh verified anything.
        setError(i18n.t('conversation.unknownSaveResend'));
        setStatus('error');
      }
    }
  }, [backend, bootstrap, context, loadHistory]);
  /// Retry after a failed start without creating a second session: a
  /// created session is resumed and only its history reloads. Prefers the
  /// requested switch target when one is pending.
  const retry = React.useCallback(async () => {
    bootPromiseRef.current = null;
    if (scopeStaleRef.current || !context) {
      await bootstrap();
      return;
    }
    const resumed = requestedRef.current ?? createdRef.current;
    setStatus('bootstrapping');
    setError(null);
    if (resumed) {
      loadSeqRef.current += 1;
      await loadHistory(resumed, generationRef.current, loadSeqRef.current, mutationSeqRef.current);
      return;
    }
    await bootstrap();
  }, [backend, bootstrap, context, loadHistory]);

  /// Switch to another session of the same workspace/project. Records the
  /// requested target immediately so retries and reloads cannot fall back
  /// to the previous session; bumps the generation so late responses for
  /// the previous session are ignored.
  const openSession = React.useCallback(
    async (sessionId: string | null, targetScope?: { workspaceId: string; projectId: string }) => {
      if (scopeStaleRef.current && !targetScope) return;
      if (targetScope) {
        scopeStaleRef.current = false;
        bootPromiseRef.current = null;
      }
      let base =
        (targetScope ? { ...targetScope, sessionId: null } : context) ?? createdRef.current;
      if (!base) {
        bootPromiseRef.current = null;
        const ctx = await bootstrap();
        if (!ctx) return;
        base = ctx;
      }
      const wsId = targetScope ? targetScope.workspaceId : base.workspaceId;
      const projId = targetScope ? targetScope.projectId : base.projectId;
      if (sessionId === null) {
        const next: ConversationContext = {
          workspaceId: wsId,
          projectId: projId,
          sessionId: null,
          ...(base.installationId ? { installationId: base.installationId } : {}),
        };
        requestedRef.current = next;
        generationRef.current += 1;
        setContext(next);
        createdRef.current = next;
        setMessages([]);
        const pendingFirst = readPendingFirstSend();
        if (
          pendingFirst &&
          pendingFirst.workspaceId === next.workspaceId &&
          pendingFirst.projectId === next.projectId
        ) {
          setError(i18n.t('conversation.firstSendPending'));
          setStatus('error');
        } else {
          setError(null);
          setStatus('ready');
        }
        removeStorage(SESSION_CACHE_KEY);
        return;
      }
      const next: ConversationContext = {
        workspaceId: wsId,
        projectId: projId,
        sessionId,
        ...(base.installationId ? { installationId: base.installationId } : {}),
      };
      requestedRef.current = next;
      generationRef.current += 1;
      const generation = generationRef.current;
      loadSeqRef.current += 1;
      const seq = { loadSeq: loadSeqRef.current, mutationSeq: mutationSeqRef.current };
      setStatus('bootstrapping');
      setMessages([]);
      setError(null);
      if ((await loadHistory(next, generation, seq.loadSeq, seq.mutationSeq)) !== null) {
        const instId = base.installationId ?? installationIdRef.current;
        if (!persistAndAnnounceActiveSession(next, instId)) {
          setStorageWarning(i18n.t('conversation.storageUnavailable'));
        }
      }
    },
    [backend, bootstrap, context, loadHistory],
  );

  React.useEffect(() => {
    const onSelect = (e: Event) => {
      const custom = e as CustomEvent<{
        workspaceId?: string;
        projectId?: string;
        sessionId?: string | null;
      }>;
      if (custom.detail?.sessionId === undefined) return;
      if (
        (custom.detail.workspaceId &&
          context &&
          custom.detail.workspaceId !== context.workspaceId) ||
        (custom.detail.projectId && context && custom.detail.projectId !== context.projectId)
      ) {
        return;
      }
      void openSession(custom.detail.sessionId);
    };
    window.addEventListener('adham:session-select', onSelect);
    return () => window.removeEventListener('adham:session-select', onSelect);
  }, [context, openSession]);

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

  return {
    status,
    messages,
    context,
    sessionId: context?.sessionId ?? null,
    activeWorkspaceId,
    error,
    storageWarning,
    pendingSend,
    submit,
    retry,
    reload,
    openSession,
    refreshScope,
    capabilities: conversationCapabilities,
  };
}
