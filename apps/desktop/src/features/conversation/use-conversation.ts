import * as React from 'react';
import type { ConversationMessageDto } from '@/shared/api/adham-client';
import {
  CREATE_INTENT_KEY,
  SESSION_CACHE_KEY,
  isDefinitePreEffectRejection,
  readCreateIntent,
  readPendingSend,
  readSessionCache,
  rejectionMessage,
  removePendingSend,
  removeStorage,
  sameScope,
  type PendingSend,
  writePendingSend,
  writeStorage,
} from './conversation-identity';

export type { PendingSend } from './conversation-identity';

export interface UiMessage {
  id: string;
  role: string;
  text: string;
  createdAt: string;
}

export type ConversationStatus =
  | 'bootstrapping'
  | 'needs-workspace'
  | 'needs-project'
  | 'ready'
  | 'submitting'
  | 'error';

export type SubmitOutcome = { ok: true } | { ok: false; error: string; uncertain: boolean };

/// Backend capability report. Execution, streaming, and stop have no
/// backend command, so the UI must render them unavailable — never simulate
/// them. submitMessage is the only supported conversation command.
export const conversationCapabilities = {
  submitMessage: true,
  execution: false,
  stop: false,
} as const;

export interface ConversationContext {
  workspaceId: string;
  projectId: string;
  sessionId: string;
}

interface BootstrapSnapshot {
  isInitialized: boolean;
  activeWorkspaceId: string | null;
  activeProjectId: string | null;
}

interface SessionSnapshot {
  sessionId: string;
}

interface SubmittedSnapshot {
  messageId: string;
  text: string;
  createdAt: string;
}

interface ConversationSnapshot {
  items: ConversationMessageDto[];
}

export interface ConversationBackend {
  getBootstrapState(): Promise<BootstrapSnapshot>;
  createSession(
    workspaceId: string,
    projectId: string,
    payload: { title: string | null },
    options?: { requestId?: string },
  ): Promise<SessionSnapshot>;
  submitMessage(
    workspaceId: string,
    projectId: string,
    sessionId: string,
    payload: { text: string },
    options?: { requestId?: string },
  ): Promise<SubmittedSnapshot>;
  getConversation(
    workspaceId: string,
    projectId: string,
    sessionId: string,
  ): Promise<ConversationSnapshot>;
}

function toUiMessage(dto: {
  messageId: string;
  role?: string;
  text: string;
  createdAt: string;
}): UiMessage {
  return {
    id: dto.messageId,
    role: dto.role ?? 'user',
    text: dto.text,
    createdAt: dto.createdAt,
  };
}

export function useConversation({ backend }: { backend: ConversationBackend }) {
  const [status, setStatus] = React.useState<ConversationStatus>('bootstrapping');
  const [messages, setMessages] = React.useState<UiMessage[]>([]);
  const [context, setContext] = React.useState<ConversationContext | null>(null);
  const [error, setError] = React.useState<string | null>(null);
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

  const loadHistory = React.useCallback(
    async (
      ctx: ConversationContext,
      generation: number,
      loadSeq: number,
      mutationSeq: number,
    ): Promise<UiMessage[] | null> => {
      try {
        const page = await backend.getConversation(ctx.workspaceId, ctx.projectId, ctx.sessionId);
        if (
          !mountedRef.current ||
          generationRef.current !== generation ||
          loadSeqRef.current !== loadSeq ||
          mutationSeqRef.current !== mutationSeq ||
          (requestedRef.current !== null && requestedRef.current.sessionId !== ctx.sessionId)
        ) {
          return null;
        }
        const items = page.items.map(toUiMessage);
        setContext(ctx);
        setMessages(items);
        setError(null);
        setStatus('ready');
        return items;
      } catch (err) {
        if (
          !mountedRef.current ||
          generationRef.current !== generation ||
          loadSeqRef.current !== loadSeq ||
          mutationSeqRef.current !== mutationSeq ||
          (requestedRef.current !== null && requestedRef.current.sessionId !== ctx.sessionId)
        ) {
          return null;
        }
        setError(err instanceof Error ? err.message : 'Conversation history failed to load.');
        setStatus('error');
        return null;
      }
    },
    [backend],
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
      // 1. Trusted selection: the bootstrap snapshot is the authority for
      //    the active workspace/project. A cached session may only be
      //    resumed when it still belongs to that selection, so a stale
      //    cache can never bypass a newer choice.
      let snapshot: BootstrapSnapshot;
      try {
        snapshot = await backend.getBootstrapState();
      } catch (err) {
        if (mountedRef.current && generationRef.current === generation) {
          fail(
            `${err instanceof Error ? err.message : 'Bootstrap state failed to load.'} Retry once connectivity returns.`,
          );
        }
        return null;
      }
      // Partial provisioning is a state, not a fatal error: a workspace
      // without a project must reach the project step, never a session.
      setActiveWorkspaceId(snapshot.activeWorkspaceId);
      if (!snapshot.isInitialized || !snapshot.activeWorkspaceId) {
        if (mountedRef.current && generationRef.current === generation) {
          setStatus('needs-workspace');
        }
        return null;
      }
      if (!snapshot.activeProjectId) {
        if (mountedRef.current && generationRef.current === generation) {
          setStatus('needs-project');
        }
        return null;
      }
      const ws = snapshot.activeWorkspaceId;
      const proj = snapshot.activeProjectId;
      // 2. Resume a cached session only within the trusted selection. A
      //    history failure is an outage, never evidence the session is
      //    gone: the cache and session identity are retained and nothing
      //    is recreated.
      const cached = readSessionCache();
      if (cached && cached.workspaceId === ws && cached.projectId === proj) {
        const seq = freshSeq();
        if ((await loadHistory(cached, generation, seq.loadSeq, seq.mutationSeq)) !== null) {
          createdRef.current = cached;
          writeStorage(SESSION_CACHE_KEY, JSON.stringify(cached));
          return cached;
        }
        if (superseded(seq)) return null;
        fail('Saved conversation could not be loaded. Retry once connectivity returns.');
        return null;
      }
      if (cached) {
        removeStorage(SESSION_CACHE_KEY);
      }
      // 3. Deliberate creation with a stable request identity persisted
      // across remounts and retries, so an uncertain creation never forks
      // a duplicate session: the backend receipt replays the original.
      try {
        let intent = readCreateIntent(ws, proj);
        if (!intent) {
          intent = { requestId: crypto.randomUUID(), workspaceId: ws, projectId: proj };
          // A create intent that cannot be persisted must block the
          // dispatch: without a durable identity a retry would mint a
          // second session.
          if (!writeStorage(CREATE_INTENT_KEY, JSON.stringify(intent))) {
            fail(
              'Session creation identity could not be recorded. Retry once storage is available.',
            );
            return null;
          }
        }
        let session: SessionSnapshot;
        try {
          session = await backend.createSession(
            ws,
            proj,
            { title: null },
            {
              requestId: intent.requestId,
            },
          );
        } catch (err) {
          // Only proven pre-effect rejections clear the identity; unknown
          // or storage errors may have committed and must retry with the
          // same request identity.
          if (isDefinitePreEffectRejection(err)) removeStorage(CREATE_INTENT_KEY);
          throw err;
        }
        const ctx: ConversationContext = {
          workspaceId: ws,
          projectId: proj,
          sessionId: session.sessionId,
        };
        // Durable identity first: the backend has issued the session, so
        // the cache is written before history verification and the create
        // intent is cleared only once the cache holds the identity. A
        // history outage after a successful create can then never cause a
        // second creation on remount. If the cache write itself fails the
        // intent stays, so a remount replays creation with the same
        // request identity instead of forking a duplicate.
        createdRef.current = ctx;
        if (writeStorage(SESSION_CACHE_KEY, JSON.stringify(ctx))) {
          removeStorage(CREATE_INTENT_KEY);
        }
        const seq = freshSeq();
        await loadHistory(ctx, generation, seq.loadSeq, seq.mutationSeq);
        return ctx;
      } catch (err) {
        if (mountedRef.current && generationRef.current === generation) {
          if (isDefinitePreEffectRejection(err)) {
            fail(rejectionMessage(err));
          } else {
            fail(
              `${err instanceof Error ? err.message : 'Conversation failed to start.'} Reload or retry once connectivity returns.`,
            );
          }
        }
        return null;
      }
    })();
    bootPromiseRef.current = run;
    return run;
  }, [backend, loadHistory]);

  React.useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  /// Re-run bootstrap after out-of-band provisioning (workspace/project
  /// creation): drops the settled run so the fresh snapshot drives scope.
  /// Sets a transitioning status so the old creation form cannot dispatch
  /// again while the authoritative read is in flight. A read failure retries
  /// the read, never a fresh creation.
  const refreshScope = React.useCallback(() => {
    bootPromiseRef.current = null;
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
    const ctx = requestedRef.current ?? context ?? createdRef.current;
    if (!ctx) {
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
      if (pending && sameScope(pending, ctx)) {
        // The history refresh succeeded, but the save is still
        // unresolved: keep the identity and say so instead of pretending
        // the refresh verified anything.
        setError(
          'A previous message has an unknown save status. Resend it to retry with the same save identity.',
        );
        setStatus('error');
      }
    }
  }, [backend, bootstrap, context, loadHistory]);
  /// Retry after a failed start without creating a second session: a
  /// created session is resumed and only its history reloads. Prefers the
  /// requested switch target when one is pending.
  const retry = React.useCallback(async () => {
    bootPromiseRef.current = null;
    const resumed = requestedRef.current ?? createdRef.current;
    setStatus('bootstrapping');
    setError(null);
    if (resumed) {
      loadSeqRef.current += 1;
      await loadHistory(resumed, generationRef.current, loadSeqRef.current, mutationSeqRef.current);
      return;
    }
    await bootstrap();
  }, [backend, bootstrap, loadHistory]);

  /// Switch to another session of the same workspace/project. Records the
  /// requested target immediately so retries and reloads cannot fall back
  /// to the previous session; bumps the generation so late responses for
  /// the previous session are ignored.
  const openSession = React.useCallback(
    async (sessionId: string) => {
      let base = context ?? createdRef.current;
      if (!base) {
        const ctx = await bootstrap();
        if (!ctx) return;
        base = ctx;
      }
      const next: ConversationContext = {
        workspaceId: base.workspaceId,
        projectId: base.projectId,
        sessionId,
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
        writeStorage(SESSION_CACHE_KEY, JSON.stringify(next));
      }
    },
    [backend, bootstrap, context, loadHistory],
  );

  const submit = React.useCallback(
    async (text: string): Promise<SubmitOutcome> => {
      const trimmed = text.trim();
      if (!trimmed) return { ok: false, error: 'Message text cannot be empty.', uncertain: false };
      // Controller-boundary guard: overlapping submits are rejected before
      // any dispatch, not merely hidden by a later busy render. The guard
      // is acquired BEFORE the bootstrap await below, so two submits that
      // both arrive before the context exists cannot both proceed.
      if (submitInFlightRef.current) {
        return { ok: false, error: 'A message is already being saved.', uncertain: false };
      }
      // A requested session switch that has not resolved must never fall
      // back to the previous context for sending.
      if (requestedRef.current && requestedRef.current.sessionId !== context?.sessionId) {
        return {
          ok: false,
          error: 'Session switch has not completed. Retry the switch before sending.',
          uncertain: false,
        };
      }
      submitInFlightRef.current = true;
      try {
        let ctx = context;
        if (!ctx) {
          setStatus('bootstrapping');
          ctx = await bootstrap();
          if (!ctx) return { ok: false, error: 'Conversation is not ready.', uncertain: false };
          if (requestedRef.current && requestedRef.current.sessionId !== ctx.sessionId) {
            return {
              ok: false,
              error: 'Session switch has not completed. Retry the switch before sending.',
              uncertain: false,
            };
          }
        }
        // Frozen logical command: the identity is frozen BEFORE dispatch, so
        // navigating away, crashing, or losing the transport mid-save can
        // never drop it. While any unresolved record exists, only a resend
        // of the exact same text in the exact same scope may proceed (it
        // reuses the frozen identity so the backend receipt replays the
        // original); every other send is blocked so no second record can
        // overwrite it and no identity can leak across scopes.
        const pending = readPendingSend();
        let requestId: string;
        let reusedFrozenIdentity = false;
        if (pending) {
          if (sameScope(pending, ctx) && pending.text === trimmed) {
            requestId = pending.requestId;
            reusedFrozenIdentity = true;
          } else {
            const message =
              'A previous message has an unknown save status. Reload history or resend it before sending another message.';
            setError(message);
            setStatus('error');
            return { ok: false, error: message, uncertain: true };
          }
        } else {
          requestId = crypto.randomUUID();
        }
        const generation = generationRef.current;
        setStatus('submitting');
        setError(null);
        const record: PendingSend = {
          requestId,
          text: trimmed,
          workspaceId: ctx.workspaceId,
          projectId: ctx.projectId,
          sessionId: ctx.sessionId,
        };
        if (!reusedFrozenIdentity && !writePendingSend(record)) {
          // The identity could not be persisted: dispatching anyway would
          // reopen the duplicate window the record exists to close.
          const message = 'Save identity could not be recorded. The message was not sent.';
          setError(message);
          setStatus('error');
          return { ok: false, error: message, uncertain: false };
        }
        if (!reusedFrozenIdentity) {
          setPendingSend(record);
        }
        // Clear the frozen identity only when this exact logical command is
        // known to be resolved (confirmed success or proven pre-effect
        // rejection).
        const clearFrozenIdentity = () => {
          if (readPendingSend()?.requestId === requestId) removePendingSend();
          setPendingSend((prev) => (prev?.requestId === requestId ? null : prev));
        };
        try {
          const submitted = await backend.submitMessage(
            ctx.workspaceId,
            ctx.projectId,
            ctx.sessionId,
            { text: trimmed },
            { requestId },
          );
          if (!mountedRef.current || generationRef.current !== generation) {
            // The write landed even though this scope is gone: the frozen
            // identity is resolved and must not block a future send.
            clearFrozenIdentity();
            return { ok: false, error: 'Session changed while sending.', uncertain: false };
          }
          const incoming = toUiMessage({ ...submitted, role: 'user' });
          // A confirmed write invalidates older in-flight histories: they
          // resolve against a stale mutation sequence and are discarded.
          mutationSeqRef.current += 1;
          setMessages((prev) =>
            prev.some((m) => m.id === incoming.id) ? prev : [...prev, incoming],
          );
          clearFrozenIdentity();
          setStatus('ready');
          return { ok: true };
        } catch (err) {
          const definite = isDefinitePreEffectRejection(err);
          if (!mountedRef.current || generationRef.current !== generation) {
            // Proven pre-effect: nothing was stored, so drop the identity
            // even though this scope is gone. An unknown outcome keeps the
            // pre-frozen record for a later reload or same-text resend.
            if (definite) clearFrozenIdentity();
            return { ok: false, error: 'Session changed while sending.', uncertain: false };
          }
          if (definite) {
            // Proven pre-effect: nothing was stored, the logical identity is
            // spent, and a future send mints a fresh one.
            clearFrozenIdentity();
            const message = rejectionMessage(err);
            setError(message);
            setStatus('error');
            return { ok: false, error: message, uncertain: false };
          }
          // Unknown outcome: the record was frozen before dispatch and stays
          // until a reload verifies it or a same-text resend replays it.
          const message = err instanceof Error ? err.message : 'Message was not saved.';
          setError(`${message} Save status is unknown. Reload history before resending.`);
          setStatus('error');
          return { ok: false, error: message, uncertain: true };
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
    pendingSend,
    submit,
    retry,
    reload,
    openSession,
    refreshScope,
    capabilities: conversationCapabilities,
  };
}
