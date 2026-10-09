import * as React from 'react';
import type { ConversationMessageDto } from '@/shared/api/adham-client';

export interface UiMessage {
  id: string;
  role: string;
  text: string;
  createdAt: string;
}

export type ConversationStatus = 'bootstrapping' | 'ready' | 'submitting' | 'error';

export type SubmitOutcome = { ok: true } | { ok: false; error: string };

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
  ): Promise<SessionSnapshot>;
  submitMessage(
    workspaceId: string,
    projectId: string,
    sessionId: string,
    payload: { text: string },
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

  const mountedRef = React.useRef(true);
  const bootPromiseRef = React.useRef<Promise<ConversationContext | null> | null>(null);
  const generationRef = React.useRef(0);
  const createdRef = React.useRef<ConversationContext | null>(null);

  React.useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const bootstrap = React.useCallback(async (): Promise<ConversationContext | null> => {
    if (bootPromiseRef.current) return bootPromiseRef.current;
    const run = (async () => {
      const generation = generationRef.current;
      try {
        const snapshot = await backend.getBootstrapState();
        if (!snapshot.isInitialized || !snapshot.activeWorkspaceId || !snapshot.activeProjectId) {
          if (mountedRef.current && generationRef.current === generation) {
            setError('No provisioned workspace or project. Create one before chatting.');
            setStatus('error');
          }
          return null;
        }
        const session = await backend.createSession(
          snapshot.activeWorkspaceId,
          snapshot.activeProjectId,
          { title: null },
        );
        const ctx: ConversationContext = {
          workspaceId: snapshot.activeWorkspaceId,
          projectId: snapshot.activeProjectId,
          sessionId: session.sessionId,
        };
        createdRef.current = ctx;
        const page = await backend.getConversation(ctx.workspaceId, ctx.projectId, ctx.sessionId);
        if (mountedRef.current && generationRef.current === generation) {
          generationRef.current += 1;
          setContext(ctx);
          setMessages(page.items.map(toUiMessage));
          setError(null);
          setStatus('ready');
        }
        return ctx;
      } catch (err) {
        if (mountedRef.current && generationRef.current === generation) {
          setError(err instanceof Error ? err.message : 'Conversation failed to start.');
          setStatus('error');
        }
        return null;
      }
    })();
    bootPromiseRef.current = run;
    return run;
  }, [backend]);

  React.useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  const loadHistory = React.useCallback(
    async (ctx: ConversationContext, generation: number): Promise<boolean> => {
      try {
        const page = await backend.getConversation(ctx.workspaceId, ctx.projectId, ctx.sessionId);
        if (!mountedRef.current || generationRef.current !== generation) return false;
        setContext(ctx);
        setMessages(page.items.map(toUiMessage));
        setError(null);
        setStatus('ready');
        return true;
      } catch (err) {
        if (!mountedRef.current || generationRef.current !== generation) return false;
        setError(err instanceof Error ? err.message : 'Conversation history failed to load.');
        setStatus('error');
        return false;
      }
    },
    [backend],
  );

  /// Reload history for the current session without submitting or
  /// creating anything. Used to verify uncertain writes instead of
  /// blindly resubmitting them under a fresh request id.
  const reload = React.useCallback(async () => {
    const ctx = context ?? createdRef.current;
    if (!ctx) {
      await bootstrap();
      return;
    }
    setStatus('bootstrapping');
    setError(null);
    await loadHistory(ctx, generationRef.current);
  }, [backend, bootstrap, context, loadHistory]);
  /// Retry after a failed start without creating a second session: a
  /// created session is resumed and only its history reloads.
  const retry = React.useCallback(async () => {
    bootPromiseRef.current = null;
    const resumed = createdRef.current;
    setStatus('bootstrapping');
    setError(null);
    if (resumed) {
      await loadHistory(resumed, generationRef.current);
      return;
    }
    await bootstrap();
  }, [backend, bootstrap, loadHistory]);

  /// Switch to another session of the same workspace/project. Bumps the
  /// generation so late responses for the previous session are ignored.
  const openSession = React.useCallback(
    async (sessionId: string) => {
      let base = context ?? createdRef.current;
      if (!base) {
        const ctx = await bootstrap();
        if (!ctx) return;
        base = ctx;
      }
      generationRef.current += 1;
      const generation = generationRef.current;
      const next: ConversationContext = {
        workspaceId: base.workspaceId,
        projectId: base.projectId,
        sessionId,
      };
      setStatus('bootstrapping');
      setMessages([]);
      setError(null);
      await loadHistory(next, generation);
    },
    [backend, bootstrap, context, loadHistory],
  );

  const submit = React.useCallback(
    async (text: string): Promise<SubmitOutcome> => {
      const trimmed = text.trim();
      if (!trimmed) return { ok: false, error: 'Message text cannot be empty.' };
      let ctx = context;
      if (!ctx) {
        setStatus('bootstrapping');
        ctx = await bootstrap();
        if (!ctx) return { ok: false, error: 'Conversation is not ready.' };
      }
      const generation = generationRef.current;
      setStatus('submitting');
      setError(null);
      try {
        const submitted = await backend.submitMessage(
          ctx.workspaceId,
          ctx.projectId,
          ctx.sessionId,
          { text: trimmed },
        );
        if (!mountedRef.current || generationRef.current !== generation) {
          return { ok: false, error: 'Session changed while sending.' };
        }
        setMessages((prev) => [...prev, toUiMessage({ ...submitted, role: 'user' })]);
        setStatus('ready');
        return { ok: true };
      } catch (err) {
        if (!mountedRef.current || generationRef.current !== generation) {
          return { ok: false, error: 'Session changed while sending.' };
        }
        const message = err instanceof Error ? err.message : 'Message was not saved.';
        setError(message);
        setStatus('error');
        return { ok: false, error: message };
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
    submit,
    retry,
    reload,
    openSession,
    capabilities: conversationCapabilities,
  };
}
