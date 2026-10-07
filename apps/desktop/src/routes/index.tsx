import * as React from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { MessageCard, type MessageRole } from '@adham/ui';
import { adhamClient, type ConversationMessageDto } from '@/shared/api/adham-client';
import { queryKeys } from '@/shared/api/query-keys';
import { NavigationRail, PrimarySidebar, ContextPanel, useShellLayout } from '@/widgets/shell';
import { WorkspaceHeader, EmptyWelcome, Composer } from '@/widgets/compose';

/** Map backend roles to design system MessageRole */
function toMessageRole(role: string): MessageRole {
  return role === 'user' || role === 'system' ? role : 'assistant';
}

export const Route = createFileRoute('/')({
  component: IndexComponent,
});

function IndexComponent() {
  const queryClient = useQueryClient();
  const { focusMode } = useShellLayout();
  const [inputText, setInputText] = React.useState('');
  const [activeSessionId, setActiveSessionId] = React.useState<string | null>(null);
  const [sessions, setSessions] = React.useState<Array<{ id: string; title: string }>>([]);

  // Authoritative bootstrap query
  const { data: bootstrap, isLoading: isBootstrapLoading } = useQuery({
    queryKey: queryKeys.bootstrap,
    queryFn: () =>
      adhamClient.getBootstrapState().catch(() => ({
        isInitialized: false,
        activeWorkspaceId: null,
        activeProjectId: null,
      })),
  });

  const workspaceId = bootstrap?.activeWorkspaceId;
  const projectId = bootstrap?.activeProjectId;

  // Ensure active workspace, project, and session exist
  const ensureActiveContext = React.useCallback(async () => {
    let wsId = bootstrap?.activeWorkspaceId;
    let projId = bootstrap?.activeProjectId;

    if (!bootstrap?.isInitialized || !wsId || !projId) {
      const ws = await adhamClient.createWorkspace({
        name: 'Personal Workspace',
        kind: 'personal',
        preferredLanguage: 'en',
      });
      wsId = ws.workspaceId;

      const proj = await adhamClient.createProject(wsId, {
        name: 'Default Project',
        storageKind: 'isolated',
      });
      projId = proj.projectId;

      await queryClient.invalidateQueries({ queryKey: queryKeys.bootstrap });
    }

    let sessId = activeSessionId;
    if (!sessId) {
      const sess = await adhamClient.createSession(wsId, projId, {
        title: 'Initial Session',
      });
      const newId = sess.sessionId;
      sessId = newId;
      setActiveSessionId(newId);
      setSessions((prev) =>
        prev.some((s) => s.id === newId)
          ? prev
          : [{ id: newId, title: sess.title || 'Initial Session' }, ...prev],
      );
    }

    return { workspaceId: wsId, projectId: projId, sessionId: sessId };
  }, [bootstrap, activeSessionId, queryClient]);

  // Auto-bootstrap on initial launch if uninitialized
  React.useEffect(() => {
    if (bootstrap && !bootstrap.isInitialized) {
      ensureActiveContext().catch(console.error);
    }
  }, [bootstrap, ensureActiveContext]);

  // Synchronous conversation projection query
  const { data: conversation } = useQuery({
    queryKey:
      workspaceId && projectId && activeSessionId
        ? queryKeys.conversation(workspaceId, projectId, activeSessionId)
        : ['conversation', 'empty'],
    queryFn: () => {
      if (!workspaceId || !projectId || !activeSessionId) {
        return { items: [], projectionPosition: '0' };
      }
      return adhamClient
        .getConversation(workspaceId, projectId, activeSessionId)
        .catch(() => ({ items: [], projectionPosition: '0' }));
    },
    enabled: Boolean(workspaceId && projectId && activeSessionId),
  });

  // Submit message mutation
  const submitMutation = useMutation({
    mutationFn: async (text: string) => {
      const ctx = await ensureActiveContext();
      return adhamClient.submitMessage(ctx.workspaceId, ctx.projectId, ctx.sessionId, { text });
    },
    onSuccess: () => {
      setInputText('');
      if (workspaceId && projectId && activeSessionId) {
        queryClient.invalidateQueries({
          queryKey: queryKeys.conversation(workspaceId, projectId, activeSessionId),
        });
      }
    },
  });

  const handleNewSession = async () => {
    if (!workspaceId || !projectId) return;
    const title = `Session ${sessions.length + 1}`;
    const sess = await adhamClient.createSession(workspaceId, projectId, { title });
    setSessions((prev) => [{ id: sess.sessionId, title }, ...prev]);
    setActiveSessionId(sess.sessionId);
  };

  const messages: ConversationMessageDto[] = conversation?.items || [];
  const currentSession = sessions.find((s) => s.id === activeSessionId);

  return (
    <div className="flex h-full w-full overflow-hidden bg-background">
      {/* 1. Navigation Rail (40px) */}
      {!focusMode && <NavigationRail />}

      {/* 2. Primary Collapsible Sidebar (247px - 600px) */}
      {!focusMode && (
        <PrimarySidebar
          sessions={sessions}
          activeSessionId={activeSessionId}
          onSelectSession={setActiveSessionId}
          onNewSession={handleNewSession}
        />
      )}

      {/* 3. Central Workspace */}
      <main className="flex flex-1 flex-col min-w-0 h-full overflow-hidden bg-background">
        <WorkspaceHeader
          sessionTitle={currentSession?.title}
          isLoading={isBootstrapLoading || submitMutation.isPending}
        />

        {/* Conversation or Calm Center */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6">
          {messages.length === 0 ? (
            <EmptyWelcome onSelectPrompt={(prompt) => setInputText(prompt)} />
          ) : (
            <div className="mx-auto max-w-4xl space-y-4">
              {messages.map((msg) => (
                <MessageCard
                  key={msg.messageId}
                  role={toMessageRole(msg.role)}
                  text={msg.text}
                  timestamp={new Date(msg.createdAt).toLocaleTimeString()}
                  dateTime={msg.createdAt}
                />
              ))}
            </div>
          )}
        </div>

        {/* Docked Expanding Composer */}
        <Composer
          inputText={inputText}
          onChangeInput={setInputText}
          onSubmit={() => {
            if (inputText.trim() && !submitMutation.isPending) {
              submitMutation.mutate(inputText.trim());
            }
          }}
          isSubmitting={submitMutation.isPending}
        />
      </main>

      {/* 4. Context Panel */}
      {!focusMode && <ContextPanel />}
    </div>
  );
}
