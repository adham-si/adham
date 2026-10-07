import * as React from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button, MessageCard, Textarea, type MessageRole } from '@adham/ui';
import { adhamClient, type ConversationMessageDto } from '@/shared/api/adham-client';
import { queryKeys } from '@/shared/api/query-keys';

/** The backend sends a free-form role string; the design system needs a closed set. */
function toMessageRole(role: string): MessageRole {
  return role === 'user' || role === 'system' ? role : 'assistant';
}

export const Route = createFileRoute('/')({
  component: IndexComponent,
});

function IndexComponent() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [inputText, setInputText] = React.useState('');
  const [activeSessionId, setActiveSessionId] = React.useState<string | null>(null);

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
      sessId = sess.sessionId;
      setActiveSessionId(sessId);
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

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim() || submitMutation.isPending) return;
    submitMutation.mutate(inputText.trim());
  };

  const messages: ConversationMessageDto[] = conversation?.items || [];

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col justify-between p-6">
      {/* Header */}
      <header className="flex items-center justify-between border-b border-border-subtle py-4">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight text-foreground">
            <span className="inline-block size-3 rounded-full bg-brand" />
            {t('appName')}
          </h1>
          <p className="text-xs text-foreground-muted">{t('tagline')}</p>
        </div>
        <div className="rounded border border-border-subtle bg-surface-subtle px-2 py-1 font-mono text-xs">
          {isBootstrapLoading || submitMutation.isPending ? t('status.loading') : t('status.ready')}
        </div>
      </header>

      {/* Conversation or Calm Center */}
      <section className="flex-1 space-y-4 overflow-y-auto py-8">
        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center p-8 text-center">
            <div className="mb-4 flex size-16 items-center justify-center rounded-2xl bg-selection">
              <span className="text-2xl font-bold text-accent">🐎</span>
            </div>
            <h2 className="mb-2 text-2xl font-semibold">{t('welcome')}</h2>
            <p className="max-w-md text-sm text-foreground-secondary">
              A private workspace where people and intelligent agents work together safely.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
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
      </section>

      {/* Input Box */}
      <footer className="border-t border-border-subtle pt-4">
        <form onSubmit={handleSubmit} className="relative">
          <Textarea
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSubmit(e);
              }
            }}
            placeholder={t('compose.placeholder')}
            rows={3}
            className="pe-28"
          />
          {/* Logical inset: a fixed side would mirror wrong in Arabic. */}
          <div className="absolute end-3 bottom-4 flex items-center gap-2">
            <Button type="submit" size="sm" disabled={!inputText.trim()}>
              {submitMutation.isPending ? t('status.loading') : t('compose.send')}
            </Button>
          </div>
        </form>
      </footer>
    </main>
  );
}
