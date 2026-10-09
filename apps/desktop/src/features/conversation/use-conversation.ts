import * as React from 'react';
import type { ConversationMessageDto } from '@/shared/api/adham-client';

export interface UiMessage {
  id: string;
  role: string;
  text: string;
  createdAt: string;
}

export type ConversationStatus = 'bootstrapping' | 'ready' | 'submitting' | 'error';

export type SubmitOutcome = { ok: true } | { ok: false; error: string; uncertain: boolean };

/// A frozen logical command whose outcome is unknown. Carries the full
/// scope plus payload and request identity so retries and remounts replay
/// the exact command instead of minting a duplicate under another text or
/// scope. Persisted in sessionStorage until resolved.
export interface PendingSend {
  requestId: string;
  text: string;
  workspaceId: string;
  projectId: string;
  sessionId: string;
}

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

/// Codes the backend provably emits before any effect is applied.
/// STORAGE_UNAVAILABLE and unknown errors are NOT proof of rollback —
/// commit-failure handling returns storage failures when commit certainty
/// or receipt reads are unavailable. Only whitelisted pre-effect
/// rejections are definite; unknowns retain the logical command identity.
const PRE_EFFECT_REJECTION_CODES = new Set([
  'VALIDATION_FAILED',
  'INVALID_COMMAND_VERSION',
  'REQUEST_ID_CONFLICT',
  'CONTEXT_MISMATCH',
  'SESSION_NOT_FOUND',
  'PROJECT_NOT_FOUND',
  'WORKSPACE_NOT_FOUND',
]);

/// Un-prefixed validation strings the handlers emit before any effect.
const PRE_EFFECT_REJECTION_MESSAGES = new Set([
  'workspaceId context required',
  'projectId context required',
  'sessionId context required',
]);

function stringIsPreEffectRejection(err: string): boolean {
  if (PRE_EFFECT_REJECTION_MESSAGES.has(err)) return true;
  const colon = err.indexOf(':');
  if (colon <= 0) return false;
  return PRE_EFFECT_REJECTION_CODES.has(err.slice(0, colon));
}

/// A definite pre-effect rejection: the command provably was not applied,
/// so its logical identity is spent. Everything else — storage
/// unavailable, repair required, unknown codes, transport failures —
/// leaves the outcome unknown and the identity must be retained.
export function isDefinitePreEffectRejection(err: unknown): boolean {
  if (typeof err === 'string') return stringIsPreEffectRejection(err);
  if (typeof err === 'object' && err !== null && !(err instanceof Error)) {
    const code = (err as { code?: unknown }).code;
    if (typeof code === 'string' && PRE_EFFECT_REJECTION_CODES.has(code)) return true;
    const message = (err as { message?: unknown }).message;
    if (typeof message === 'string' && PRE_EFFECT_REJECTION_MESSAGES.has(message)) return true;
  }
  return false;
}

function rejectionMessage(err: unknown): string {
  if (
    typeof err === 'object' &&
    err !== null &&
    typeof (err as { message?: unknown }).message === 'string'
  ) {
    return (err as { message: string }).message;
  }
  if (err instanceof Error) return err.message;
  return 'Message was not saved.';
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

const SESSION_CACHE_KEY = 'adham:compose:session';
const CREATE_INTENT_KEY = 'adham:compose:create-intent';

function readStorage(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string): void {
  try {
    sessionStorage.setItem(key, value);
  } catch {
    // ignore: caching is best-effort, correctness never depends on it
  }
}

function removeStorage(key: string): void {
  try {
    sessionStorage.removeItem(key);
  } catch {
    // ignore
  }
}

function readSessionCache(): ConversationContext | null {
  const raw = readStorage(SESSION_CACHE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<ConversationContext>;
    if (
      typeof parsed.workspaceId === 'string' &&
      typeof parsed.projectId === 'string' &&
      typeof parsed.sessionId === 'string'
    ) {
      return {
        workspaceId: parsed.workspaceId,
        projectId: parsed.projectId,
        sessionId: parsed.sessionId,
      };
    }
    return null;
  } catch {
    return null;
  }
}

interface CreateIntent {
  requestId: string;
  workspaceId: string;
  projectId: string;
}

function readCreateIntent(workspaceId: string, projectId: string): CreateIntent | null {
  const raw = readStorage(CREATE_INTENT_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<CreateIntent>;
    if (
      typeof parsed.requestId === 'string' &&
      parsed.workspaceId === workspaceId &&
      parsed.projectId === projectId
    ) {
      return { requestId: parsed.requestId, workspaceId, projectId };
    }
    return null;
  } catch {
    return null;
  }
}

const PENDING_SEND_KEY = 'adham:compose:pending-send';

function readPendingSend(): PendingSend | null {
  const raw = readStorage(PENDING_SEND_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<PendingSend>;
    if (
      typeof parsed.requestId === 'string' &&
      typeof parsed.text === 'string' &&
      typeof parsed.workspaceId === 'string' &&
      typeof parsed.projectId === 'string' &&
      typeof parsed.sessionId === 'string'
    ) {
      return parsed as PendingSend;
    }
    return null;
  } catch {
    return null;
  }
}

function writePendingSend(record: PendingSend): void {
  writeStorage(PENDING_SEND_KEY, JSON.stringify(record));
}

function removePendingSend(): void {
  removeStorage(PENDING_SEND_KEY);
}

function sameScope(
  a: { workspaceId: string; projectId: string; sessionId: string },
  b: { workspaceId: string; projectId: string; sessionId: string },
): boolean {
  return (
    a.workspaceId === b.workspaceId && a.projectId === b.projectId && a.sessionId === b.sessionId
  );
}

export function useConversation({ backend }: { backend: ConversationBackend }) {
  const [status, setStatus] = React.useState<ConversationStatus>('bootstrapping');
  const [messages, setMessages] = React.useState<UiMessage[]>([]);
  const [context, setContext] = React.useState<ConversationContext | null>(null);
  const [error, setError] = React.useState<string | null>(null);
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
  // Frozen-command ordering: a reload may only resolve a pending send
  // when no newer pending send was recorded while the reload was in
  // flight.
  const pendingSeqRef = React.useRef(0);
  // Controller-boundary submit guard: overlapping submits are rejected
  // before any dispatch, not merely hidden by a later busy render.
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
    ): Promise<boolean> => {
      try {
        const page = await backend.getConversation(ctx.workspaceId, ctx.projectId, ctx.sessionId);
        if (
          !mountedRef.current ||
          generationRef.current !== generation ||
          loadSeqRef.current !== loadSeq ||
          mutationSeqRef.current !== mutationSeq ||
          (requestedRef.current !== null && requestedRef.current.sessionId !== ctx.sessionId)
        ) {
          return false;
        }
        setContext(ctx);
        setMessages(page.items.map(toUiMessage));
        setError(null);
        setStatus('ready');
        return true;
      } catch (err) {
        if (
          !mountedRef.current ||
          generationRef.current !== generation ||
          loadSeqRef.current !== loadSeq ||
          mutationSeqRef.current !== mutationSeq ||
          (requestedRef.current !== null && requestedRef.current.sessionId !== ctx.sessionId)
        ) {
          return false;
        }
        setError(err instanceof Error ? err.message : 'Conversation history failed to load.');
        setStatus('error');
        return false;
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
      if (!snapshot.isInitialized || !snapshot.activeWorkspaceId || !snapshot.activeProjectId) {
        if (mountedRef.current && generationRef.current === generation) {
          fail('No provisioned workspace or project. Create one before chatting.');
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
        if (await loadHistory(cached, generation, seq.loadSeq, seq.mutationSeq)) {
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
          writeStorage(CREATE_INTENT_KEY, JSON.stringify(intent));
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
        // second creation on remount.
        createdRef.current = ctx;
        writeStorage(SESSION_CACHE_KEY, JSON.stringify(ctx));
        removeStorage(CREATE_INTENT_KEY);
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

  /// Reload history without submitting or creating anything. Targets the
  /// requested session when a switch is pending, so a failed switch
  /// followed by reload retries the requested target. Used to verify
  /// uncertain writes instead of blindly resubmitting them: a successful
  /// reload resolves the frozen pending send for this scope, because the
  /// backend returns the full session history in one page — presence
  /// proves the write landed, absence proves it did not.
  const reload = React.useCallback(async () => {
    const ctx = requestedRef.current ?? context ?? createdRef.current;
    if (!ctx) {
      await bootstrap();
      return;
    }
    setStatus('bootstrapping');
    setError(null);
    loadSeqRef.current += 1;
    const pendingSeq = pendingSeqRef.current;
    const loaded = await loadHistory(
      ctx,
      generationRef.current,
      loadSeqRef.current,
      mutationSeqRef.current,
    );
    if (loaded && pendingSeq === pendingSeqRef.current) {
      const pending = readPendingSend();
      if (pending && sameScope(pending, ctx)) {
        removePendingSend();
        setPendingSend(null);
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
      if (await loadHistory(next, generation, seq.loadSeq, seq.mutationSeq)) {
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
      // any dispatch, not merely hidden by a later busy render.
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
      // Frozen logical command: an unresolved uncertain write keeps its
      // exact identity and scope until a reload verifies it. The same
      // text in the same scope reuses that identity so the backend
      // receipt replays the original; any other text in the same scope is
      // blocked so it can never steal or replace the identity. A pending
      // write from another session is left untouched and never transfers
      // its identity across scopes.
      const pending = readPendingSend();
      let requestId: string;
      if (pending && sameScope(pending, ctx)) {
        if (pending.text !== trimmed) {
          const message =
            'A previous message has an unknown save status. Reload history or resend it before sending another message.';
          setError(message);
          setStatus('error');
          return { ok: false, error: message, uncertain: true };
        }
        requestId = pending.requestId;
      } else {
        requestId = crypto.randomUUID();
      }
      const generation = generationRef.current;
      submitInFlightRef.current = true;
      setStatus('submitting');
      setError(null);
      const freezeRecord = (): PendingSend => {
        const record: PendingSend = {
          requestId,
          text: trimmed,
          workspaceId: ctx.workspaceId,
          projectId: ctx.projectId,
          sessionId: ctx.sessionId,
        };
        writePendingSend(record);
        pendingSeqRef.current += 1;
        setPendingSend(record);
        return record;
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
          return { ok: false, error: 'Session changed while sending.', uncertain: false };
        }
        const incoming = toUiMessage({ ...submitted, role: 'user' });
        // A confirmed write invalidates older in-flight histories: they
        // resolve against a stale mutation sequence and are discarded.
        mutationSeqRef.current += 1;
        setMessages((prev) =>
          prev.some((m) => m.id === incoming.id) ? prev : [...prev, incoming],
        );
        if (readPendingSend()?.requestId === requestId) removePendingSend();
        setPendingSend((prev) => (prev?.requestId === requestId ? null : prev));
        setStatus('ready');
        return { ok: true };
      } catch (err) {
        const definite = isDefinitePreEffectRejection(err);
        if (!mountedRef.current || generationRef.current !== generation) {
          // The command was already dispatched to the previous scope; an
          // unknown outcome must still freeze its identity for that scope.
          if (!definite) freezeRecord();
          return { ok: false, error: 'Session changed while sending.', uncertain: false };
        }
        if (definite) {
          // Proven pre-effect: nothing was stored, the logical identity is
          // spent, and a future send mints a fresh one.
          if (readPendingSend()?.requestId === requestId) removePendingSend();
          setPendingSend((prev) => (prev?.requestId === requestId ? null : prev));
          const message = rejectionMessage(err);
          setError(message);
          setStatus('error');
          return { ok: false, error: message, uncertain: false };
        }
        // Unknown outcome: freeze the full logical command so retries and
        // remounts replay it instead of minting a duplicate under another
        // text or scope.
        freezeRecord();
        const message = err instanceof Error ? err.message : 'Message was not saved.';
        setError(`${message} Save status is unknown. Reload history before resending.`);
        setStatus('error');
        return { ok: false, error: message, uncertain: true };
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
    error,
    pendingSend,
    submit,
    retry,
    reload,
    openSession,
    capabilities: conversationCapabilities,
  };
}
