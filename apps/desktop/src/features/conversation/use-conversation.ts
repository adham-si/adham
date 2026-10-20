import * as React from 'react';
import i18n from '@/shared/i18n';
import { removeStorage } from '@/shared/lib/session-storage';
import {
  type PendingSend,
  readPendingSend,
  SESSION_CACHE_KEY,
  sameScope,
} from './conversation-identity';
import {
  type AnswerFeedback,
  type BranchSelection,
  type ConversationBackend,
  type ConversationContext,
  type UiCompletion,
  conversationCapabilities,
  resolveAuthoritativeSession,
  toUiMessage,
} from './conversation-scope';
import {
  isDurableSessionStorageAvailable,
  persistAndAnnounceActiveSession,
} from './durable-session-storage';
import { readPendingFirstSend } from './lazy-session-creation';
import { useConversationActions } from './use-conversation-actions';
import { useConversationDispatch } from './use-conversation-dispatch';
import { useConversationStream } from './use-conversation-stream';

export type { PendingSend } from './conversation-identity';
export type {
  BootstrapSnapshot,
  ConversationBackend,
  ConversationContext,
  ConversationSnapshot,
  SessionSnapshot,
  SubmitOutcome,
  SubmittedSnapshot,
} from './conversation-scope';
export { conversationCapabilities } from './conversation-scope';

export type UiMessage = {
  id: string;
  role: string;
  text: string;
  createdAt: string;
  /** Assistant terminal lifecycle; absent on optimistic/streaming bubbles. */
  completion?: UiCompletion | null;
  /** Durable reply/edit anchor recorded with this message, when it has one.
   *  Read-side shape: relation arrives as stored text, displayed as-is. */
  reference?: { refersToMessageId: string; relation: string } | null;
  /** Files this message was sent with (metadata only; a chip exists only
   *  because the dispatch link row exists). */
  attachments?: import('@adham/contracts-generated').MessageAttachmentDto[];
  /** True only for a local bubble not yet confirmed persisted: it carries no
   *  durable id and cannot be the anchor of anything. */
  provisional?: boolean;
};

/** A durable anchor for a NEW submission: the only relations the backend
 *  accepts, and what the composer can actually produce. */
export type UiMessageReference = {
  refersToMessageId: string;
  relation: 'replied' | 'edited-from';
};

/** Live streaming state for the timeline (phase drives the visible status). */
export type StreamingSnapshot = {
  /** Server op handle: '' until the first stream event lands. */
  opId: string;
  text: string;
  /** waiting = dispatch in flight, thinking = reasoning activity seen,
   * streaming = answer text arriving. Never advanced from elapsed time. */
  phase: 'waiting' | 'thinking' | 'streaming';
  /** Dispatch start (epoch ms), for the elapsed display. */
  startedAt: number;
};

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
  // Non-authoritative recovery snapshot: the streamed answer kept visible
  // after a terminal whose authoritative history reload failed. Cleared in
  // the same flush as the authoritative rows inside loadHistory.
  const [recoverySnapshot, setRecoverySnapshot] = React.useState<UiMessage | null>(null);
  // Older messages dropped from the last dispatch's assembled context
  // (reported by the server-side assembler; 0 when nothing was dropped).
  const [omittedMessages, setOmittedMessages] = React.useState(0);
  // Active-alternative selections for the loaded session (line 65). Local
  // state: choosing a branch never rewrites history, only what the next
  // dispatch is answered against.
  const [branchSelections, setBranchSelections] = React.useState<BranchSelection[]>([]);
  // Local like/dislike verdicts keyed by answer row: server-authoritative, so
  // a refusal never flips a chip, and a reload restores the stored verdict.
  const [answerFeedback, setAnswerFeedbackRows] = React.useState<AnswerFeedback[]>([]);

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
        setBranchSelections(page.branchSelections ?? []);
        setAnswerFeedbackRows(page.feedback ?? []);
        // Same-flush swap: the recovery snapshot (if any) is replaced by the
        // authoritative rows atomically — never two copies of an answer.
        setRecoverySnapshot(null);
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
        setRecoverySnapshot(null);
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
    setRecoverySnapshot(null);
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
        setRecoverySnapshot(null);
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
      setRecoverySnapshot(null);
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

  const actions = useConversationActions({
    backend,
    context,
    isStale,
    generationRef,
    loadSeqRef,
    mutationSeqRef,
    setBranchSelections,
    setAnswerFeedbackRows,
  });
  const { makeAlternativeActive, setAnswerFeedback } = actions;

  const stream = useConversationStream({
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
  });
  const { streamOnce, retryTurn, stop, streaming } = stream;

  const dispatch = useConversationDispatch({
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
  });
  const { submit } = dispatch;

  return {
    status,
    messages,
    context,
    sessionId: context?.sessionId ?? null,
    activeWorkspaceId,
    error,
    storageWarning,
    omittedMessages,
    pendingSend,
    submit,
    streamOnce,
    retryTurn,
    stop,
    branchSelections,
    makeAlternativeActive,
    answerFeedback,
    setAnswerFeedback,
    streaming,
    recoverySnapshot,
    retry,
    reload,
    openSession,
    refreshScope,
    capabilities: conversationCapabilities,
  };
}
