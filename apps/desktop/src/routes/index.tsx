import * as React from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@adham/ui';
import { adhamClient, type ConversationMessageDto } from '@/shared/api/adham-client';
import { queryKeys } from '@/shared/api/query-keys';

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
    <main className="flex-1 flex flex-col max-w-4xl w-full mx-auto p-6 justify-between">
      {/* Header */}
      <header className="flex justify-between items-center py-4 border-b border-[var(--color-border-subtle,#E2E2E6)]">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-[var(--color-text-primary,#121214)] flex items-center gap-2">
            <span className="w-3 h-3 rounded-full bg-[var(--color-brand,#2B2BFF)] inline-block"></span>
            {t('appName')}
          </h1>
          <p className="text-xs text-[var(--color-text-muted,#8B8B99)]">{t('tagline')}</p>
        </div>
        <div className="text-xs font-mono px-2 py-1 bg-[var(--color-bg-subtle,#F4F4F6)] rounded border border-[var(--color-border-subtle,#E2E2E6)]">
          {isBootstrapLoading || submitMutation.isPending ? t('status.loading') : t('status.ready')}
        </div>
      </header>

      {/* Conversation or Calm Center */}
      <section className="flex-1 overflow-y-auto py-8 space-y-4">
        {messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-8">
            <div className="w-16 h-16 mb-4 rounded-2xl bg-[var(--color-brand-subtle,#EBEBFF)] flex items-center justify-center">
              <span className="text-2xl font-bold text-[var(--color-brand,#2B2BFF)]">🐎</span>
            </div>
            <h2 className="text-2xl font-semibold mb-2">{t('welcome')}</h2>
            <p className="text-sm text-[var(--color-text-secondary,#5C5C66)] max-w-md">
              A private workspace where people and intelligent agents work together safely.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {messages.map((msg) => (
              <div
                key={msg.messageId}
                className="p-4 rounded-xl bg-[var(--color-bg-surface,#FFFFFF)] border border-[var(--color-border-subtle,#E2E2E6)] shadow-xs"
              >
                <div className="flex justify-between text-xs text-[var(--color-text-muted,#8B8B99)] mb-1">
                  <span className="font-semibold uppercase tracking-wider">{msg.role}</span>
                  <span>{new Date(msg.createdAt).toLocaleTimeString()}</span>
                </div>
                <p className="text-sm whitespace-pre-wrap">{msg.text}</p>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Input Box */}
      <footer className="pt-4 border-t border-[var(--color-border-subtle,#E2E2E6)]">
        <form onSubmit={handleSubmit} className="relative">
          <textarea
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
            className="w-full p-4 pr-24 rounded-xl bg-[var(--color-bg-surface,#FFFFFF)] border border-[var(--color-border-strong,#C8C8D0)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-brand,#2B2BFF)] resize-none"
          />
          <div className="absolute right-3 bottom-4 flex items-center gap-2">
            <Button
              type="submit"
              size="sm"
              disabled={!inputText.trim() || submitMutation.isPending}
            >
              {submitMutation.isPending ? t('status.loading') : t('compose.send')}
            </Button>
          </div>
        </form>
      </footer>
    </main>
  );
}
