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

export interface UncertainWrite {
  requestId: string;
  text: string;
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

/// A backend envelope rejection (structured error with a code) is a
/// definite answer: the command was not applied. Anything else thrown —
/// dropped IPC, transport failure — leaves the outcome unknown.
export function isBackendRejection(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    !(err instanceof Error) &&
    typeof (err as { code?: unknown }).code === 'string'
  );
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

export function useConversation({ backend }: { backend: ConversationBackend }) {
  const [status, setStatus] = React.useState<ConversationStatus>('bootstrapping');
  const [messages, setMessages] = React.useState<UiMessage[]>([]);
  const [context, setContext] = React.useState<ConversationContext | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [uncertainWrite, setUncertainWrite] = React.useState<UncertainWrite | null>(null);

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
      // 1. Resume a cached session after verifying it still loads. This
      // makes remounts safe: no second session is created for the same UI.
      const cached = readSessionCache();
      if (cached) {
        const seq = freshSeq();
        if (await loadHistory(cached, generation, seq.loadSeq, seq.mutationSeq)) {
          createdRef.current = cached;
          writeStorage(SESSION_CACHE_KEY, JSON.stringify(cached));
          return cached;
        }
        // A superseded verification must not fall through to creation.
        if (
          !mountedRef.current ||
          generationRef.current !== generation ||
          loadSeqRef.current !== seq.loadSeq ||
          mutationSeqRef.current !== seq.mutationSeq
        ) {
          return null;
        }
        removeStorage(SESSION_CACHE_KEY);
      }
      // 2. Deliberate creation with a stable request identity persisted
      // across remounts and retries, so an uncertain creation never forks
      // a duplicate session: the backend receipt replays the original.
      try {
        const snapshot = await backend.getBootstrapState();
        if (!snapshot.isInitialized || !snapshot.activeWorkspaceId || !snapshot.activeProjectId) {
          if (mountedRef.current && generationRef.current === generation) {
            fail('No provisioned workspace or project. Create one before chatting.');
          }
          return null;
        }
        const ws = snapshot.activeWorkspaceId;
        const proj = snapshot.activeProjectId;
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
          // Definite rejections will fail identically on retry; only
          // uncertain (possibly committed) creations keep their identity.
          if (isBackendRejection(err)) removeStorage(CREATE_INTENT_KEY);
          throw err;
        }
        const ctx: ConversationContext = {
          workspaceId: ws,
          projectId: proj,
          sessionId: session.sessionId,
        };
        // In-memory creation record: retries within this mount resume it
        // without creating again. The sessionStorage cache is written only
        // after a verified history load below.
        createdRef.current = ctx;
        removeStorage(CREATE_INTENT_KEY);
        const seq = freshSeq();
        if (await loadHistory(ctx, generation, seq.loadSeq, seq.mutationSeq)) {
          writeStorage(SESSION_CACHE_KEY, JSON.stringify(ctx));
        }
        return ctx;
      } catch (err) {
        if (mountedRef.current && generationRef.current === generation) {
          if (isBackendRejection(err)) {
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
  /// uncertain writes instead of blindly resubmitting them.
  const reload = React.useCallback(async () => {
    const ctx = requestedRef.current ?? context ?? createdRef.current;
    if (!ctx) {
      await bootstrap();
      return;
    }
    setStatus('bootstrapping');
    setError(null);
    loadSeqRef.current += 1;
    await loadHistory(ctx, generationRef.current, loadSeqRef.current, mutationSeqRef.current);
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
      let ctx = context;
      if (!ctx) {
        setStatus('bootstrapping');
        ctx = await bootstrap();
        if (!ctx) return { ok: false, error: 'Conversation is not ready.', uncertain: false };
      }
      // Same text as an unresolved uncertain write is the same logical
      // command: reuse its exact request identity so the backend receipt
      // replays the original instead of storing a duplicate.
      const requestId =
        uncertainWrite?.text === trimmed ? uncertainWrite.requestId : crypto.randomUUID();
      const generation = generationRef.current;
      setStatus('submitting');
      setError(null);
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
        setUncertainWrite((prev) => (prev?.requestId === requestId ? null : prev));
        setStatus('ready');
        return { ok: true };
      } catch (err) {
        if (!mountedRef.current || generationRef.current !== generation) {
          return { ok: false, error: 'Session changed while sending.', uncertain: false };
        }
        if (isBackendRejection(err)) {
          const message = rejectionMessage(err);
          setError(message);
          setStatus('error');
          return { ok: false, error: message, uncertain: false };
        }
        const message = err instanceof Error ? err.message : 'Message was not saved.';
        setUncertainWrite({ requestId, text: trimmed });
        setError(`${message} Save status is unknown. Reload history before resending.`);
        setStatus('error');
        return { ok: false, error: message, uncertain: true };
      }
    },
    [backend, bootstrap, context, uncertainWrite],
  );

  return {
    status,
    messages,
    context,
    sessionId: context?.sessionId ?? null,
    error,
    uncertainWrite,
    submit,
    retry,
    reload,
    openSession,
    capabilities: conversationCapabilities,
  };
}
