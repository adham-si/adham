import i18n from '@/shared/i18n';
import * as React from 'react';
import { adhamClient } from '@/shared/api/adham-client';
import type { SessionSummary as ContractSessionSummary } from '@adham/contracts-generated';
import type { SessionSummary as SidebarSessionSummary } from '@/widgets/shell/primary-sidebar/primary-sidebar';
import { SCOPE_CHANGED_EVENT } from '../provisioning';
import { readPendingSend } from './conversation-identity';
import { readPendingFirstSend } from './lazy-session-creation';

export interface UseProjectSessionsOptions {
  backend?: {
    listSessions(context: {
      workspaceId?: string;
      projectId: string;
      includeArchived?: boolean;
      activeSessionId?: string | null;
    }): Promise<{
      sessions: ContractSessionSummary[];
      truncated?: boolean;
      unreadableSummaries?: number;
    }>;
    createSession(
      workspaceId: string,
      projectId: string,
      payload: { title: string | null },
      options?: { requestId?: string },
    ): Promise<ContractSessionSummary>;
  };
  workspaceId: string | null;
  projectId: string | null;
}

export function useProjectSessions({
  backend = adhamClient,
  workspaceId,
  projectId,
}: UseProjectSessionsOptions) {
  const [sessions, setSessions] = React.useState<SidebarSessionSummary[]>([]);
  const [activeSessionId, setActiveSessionId] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [creating] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [truncated, setTruncated] = React.useState(false);
  const [unreadableSummaries, setUnreadableSummaries] = React.useState(0);

  const activeSessionIdRef = React.useRef<string | null>(null);
  const fetchSeqRef = React.useRef(0);
  const currentWorkspaceRef = React.useRef<string | null>(workspaceId);
  currentWorkspaceRef.current = workspaceId;
  const currentProjectRef = React.useRef<string | null>(projectId);
  currentProjectRef.current = projectId;
  const scopeGenerationRef = React.useRef(0);

  // Clear incompatible sidebar rows and active session during scope changes
  React.useEffect(() => {
    scopeGenerationRef.current += 1;
    setSessions([]);
    activeSessionIdRef.current = null;
    setActiveSessionId(null);
    setUnreadableSummaries(0);
    setError(null);
  }, [workspaceId, projectId]);

  const fetchSessions = React.useCallback(async () => {
    fetchSeqRef.current += 1;
    const seq = fetchSeqRef.current;
    if (!projectId) {
      setSessions([]);
      activeSessionIdRef.current = null;
      setActiveSessionId(null);
      setTruncated(false);
      setUnreadableSummaries(0);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const active = activeSessionIdRef.current;
      const queryContext = {
        ...(workspaceId ? { workspaceId } : {}),
        projectId,
        ...(active ? { activeSessionId: active } : {}),
      };
      const result = await backend.listSessions(queryContext);
      if (seq !== fetchSeqRef.current) return;
      setTruncated(Boolean(result.truncated));
      setUnreadableSummaries(result.unreadableSummaries ?? 0);
      const mapped: SidebarSessionSummary[] = result.sessions.map((s) => ({
        id: s.sessionId,
        title: s.title || `Session ${s.sessionId.slice(0, 8)}`,
        updatedAt: s.lastActivityAt || s.createdAt,
        ...(s.summary ? { summary: s.summary } : {}),
        summaryUnavailable: Boolean(s.summaryUnavailable),
        pinned: Boolean(s.pinned),
        archived: Boolean(s.archived),
      }));
      setSessions(mapped);
    } catch (err) {
      if (seq !== fetchSeqRef.current) return;
      setError(err instanceof Error ? err.message : i18n.t('conversation.listFailed'));
    } finally {
      if (seq === fetchSeqRef.current) {
        setLoading(false);
      }
    }
  }, [backend, projectId, workspaceId]);

  React.useEffect(() => {
    void fetchSessions();
  }, [fetchSessions]);

  React.useEffect(() => {
    const onScope = () => void fetchSessions();
    window.addEventListener(SCOPE_CHANGED_EVENT, onScope);
    return () => window.removeEventListener(SCOPE_CHANGED_EVENT, onScope);
  }, [fetchSessions]);

  const fetchSessionsRef = React.useRef(fetchSessions);
  fetchSessionsRef.current = fetchSessions;

  React.useEffect(() => {
    const onActive = (e: Event) => {
      const custom = e as CustomEvent<{
        workspaceId?: string;
        projectId?: string;
        sessionId: string;
      }>;
      if (!custom.detail?.sessionId) return;
      // Validate workspace/project identity in consumer
      if (
        (custom.detail.workspaceId && custom.detail.workspaceId !== currentWorkspaceRef.current) ||
        (custom.detail.projectId && custom.detail.projectId !== currentProjectRef.current)
      ) {
        return;
      }
      activeSessionIdRef.current = custom.detail.sessionId;
      setActiveSessionId(custom.detail.sessionId);
      void fetchSessionsRef.current();
    };
    window.addEventListener('adham:session-active', onActive);
    return () => window.removeEventListener('adham:session-active', onActive);
  }, []);

  const selectSession = React.useCallback(
    (sessionId: string) => {
      if (!workspaceId || !projectId) return;
      // Highlight selection only after confirmed opening: do not setActiveSessionId eagerly here
      window.dispatchEvent(
        new CustomEvent('adham:session-select', {
          detail: { workspaceId, projectId, sessionId },
        }),
      );
    },
    [workspaceId, projectId],
  );

  const newSession = React.useCallback(async () => {
    if (!workspaceId || !projectId) return;

    // Block starting a new session while a send is unresolved (in this or another scope)
    const pendingFirst = readPendingFirstSend();
    if (pendingFirst) {
      setError(i18n.t('conversation.firstSendPendingSession'));
      return;
    }

    const pendingSend = readPendingSend();
    if (
      pendingSend &&
      pendingSend.workspaceId === workspaceId &&
      pendingSend.projectId === projectId
    ) {
      setError(i18n.t('conversation.prevMessagePending'));
      return;
    }

    setError(null);
    activeSessionIdRef.current = null;
    setActiveSessionId(null);
    window.dispatchEvent(
      new CustomEvent('adham:session-select', {
        detail: { workspaceId, projectId, sessionId: null },
      }),
    );
  }, [projectId, workspaceId]);

  return {
    sessions,
    activeSessionId,
    loading,
    creating,
    error,
    truncated,
    unreadableSummaries,
    selectSession,
    newSession,
    refresh: fetchSessions,
  };
}
