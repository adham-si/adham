import * as React from 'react';
import { useTranslation } from 'react-i18next';
import { MessageCard } from '@adham/ui';
import {
  Composer,
  EmptyWelcome,
  useDrafts,
  type ComposeAttachment,
  type ComposeMode,
} from '@/widgets/compose';
import { adhamClient } from '@/shared/api/adham-client';
import { useConversation, type ConversationBackend } from './use-conversation';
import { useProvisioning, type ProvisioningBackend } from './use-provisioning';
import { useSelection, type SelectionBackend } from '../workspace-selection/use-selection';
import { WorkspaceSelection } from '../workspace-selection/workspace-selection';
import { announceScopeChanged, SCOPE_CHANGED_EVENT } from './conversation-identity';
import { ProvisioningForm } from './provisioning-form';
import { submissionNotice } from './submission-notice';

const DEFAULT_MODEL_ID = 'local:qwen2.5-coder:32b';
const PENDING_DRAFT_BUCKET = 'pending';

function formatTimestamp(createdAt: string): string {
  const parsed = new Date(createdAt);
  if (Number.isNaN(parsed.getTime())) return createdAt;
  return parsed.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export interface ConversationPanelProps {
  backend?: ConversationBackend;
  /** Injectable provisioning backend for tests; defaults to the real client. */
  provisioning?: ProvisioningBackend;
  /** Injectable selection backend for tests; defaults to the real client. */
  selection?: SelectionBackend;
}

/**
 * Production conversation surface. Renders backend-persisted messages only:
 * no simulated execution, no fabricated verification, no timer-driven agent
 * text. Execution, approval, and stop have no backend command and are
 * rendered unavailable instead of faked.
 */
export function ConversationPanel({
  backend = adhamClient,
  provisioning,
  selection,
}: ConversationPanelProps) {
  const { t } = useTranslation();
  const conv = useConversation({ backend });
  const prov = useProvisioning({ backend: provisioning });
  const needsProvisioning = conv.status === 'needs-workspace' || conv.status === 'needs-project';
  /// Committed creation or selection awaiting authoritative bootstrap.
  /// Holds the confirmed step disabled so a second action cannot fork a
  /// duplicate while the read is in flight. Cleared only when bootstrap
  /// advances; a read failure keeps it and shows a read-only retry (never
  /// a fresh creation or reselection).
  const [provisionTransition, setProvisionTransition] = React.useState<{
    step: 'workspace' | 'project';
    origin: 'created' | 'selected';
  } | null>(null);
  const { draft, setDraft, commitPrompt, recallPrevious, recallNext } = useDrafts({
    sessionId: conv.sessionId ?? PENDING_DRAFT_BUCKET,
  });
  const draftRef = React.useRef(draft);
  draftRef.current = draft;

  const [mode, setMode] = React.useState<ComposeMode>('plan');
  const [selectedModelId, setSelectedModelId] = React.useState(DEFAULT_MODEL_ID);
  const [reasoningEffort, setReasoningEffort] = React.useState<'low' | 'medium' | 'high'>('medium');
  const [attachments, setAttachments] = React.useState<ComposeAttachment[]>([]);
  const [stopNotice, setStopNotice] = React.useState(false);

  const busy = conv.status === 'submitting' || conv.status === 'bootstrapping';
  const refreshScope = conv.refreshScope;
  const sel = useSelection({ backend: selection, enabled: needsProvisioning });
  /// Workspace chosen for its first project (an existing workspace without
  /// projects). Project creation binds to it; the workspace itself is never
  /// recreated. Cleared once authoritative scope is ready.
  const [chosenWorkspaceId, setChosenWorkspaceId] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (conv.status === 'ready') setChosenWorkspaceId(null);
  }, [conv.status]);

  // A confirmed scope change (creation or selection, from any surface)
  // advances through the authoritative bootstrap. The announced step is
  // held until bootstrap moves past it; a read failure keeps the hold for
  // a read-only retry that never recreates or reselects.
  React.useEffect(() => {
    const onScopeChanged = (event: Event) => {
      const detail = (event as CustomEvent<{ step?: unknown; origin?: unknown }>).detail;
      setProvisionTransition({
        step: detail?.step === 'workspace' ? ('workspace' as const) : ('project' as const),
        origin: detail?.origin === 'created' ? ('created' as const) : ('selected' as const),
      });
      refreshScope();
    };
    window.addEventListener(SCOPE_CHANGED_EVENT, onScopeChanged);
    return () => window.removeEventListener(SCOPE_CHANGED_EVENT, onScopeChanged);
  }, [refreshScope]);

  const handleProvision = React.useCallback(
    async (name: string) => {
      if (prov.working || provisionTransition) return;
      if (conv.status === 'needs-workspace' && chosenWorkspaceId === null) {
        const outcome = await prov.createWorkspace(name);
        // The announcement carries the confirmed step and triggers the
        // single authoritative refresh; failures stay local.
        if (outcome.ok) announceScopeChanged('workspace', 'created');
      } else {
        // Project step, or a workspace chosen for its first project: bind
        // creation to the chosen workspace, never recreate it.
        const wsId = chosenWorkspaceId ?? conv.activeWorkspaceId;
        if (!wsId) return;
        const outcome = await prov.createProject(name, wsId);
        if (outcome.ok) announceScopeChanged('project', 'created');
      }
    },
    [chosenWorkspaceId, conv, prov, provisionTransition],
  );

  const handleSelect = React.useCallback(
    async (workspaceId: string, projectId: string) => {
      if (sel.working || provisionTransition) return;
      // Success announces; the subscription above holds the transition and
      // refreshes authoritative scope. Failures stay local: no event, no
      // fallback into another scope.
      await sel.select(workspaceId, projectId);
    },
    [sel, provisionTransition],
  );

  // Release the hold only when authoritative bootstrap advances past the
  // confirmed step. A read failure (error) keeps the hold for a read-only
  // retry; it never re-enables the old creation action.
  React.useEffect(() => {
    if (provisionTransition?.step === 'workspace' && conv.status !== 'needs-workspace') {
      if (conv.status === 'needs-project' || conv.status === 'ready') {
        setProvisionTransition(null);
      }
    } else if (provisionTransition?.step === 'project' && conv.status === 'ready') {
      setProvisionTransition(null);
    }
  }, [conv.status, provisionTransition]);

  const formWorking = prov.working || sel.working || provisionTransition !== null;

  const handleSubmit = React.useCallback(async () => {
    const text = draftRef.current.trim();
    if (!text || busy) return;
    const sent = text;
    const outcome = await conv.submit(sent);
    // Retain the draft on failure; never erase edits typed meanwhile.
    if (outcome.ok && draftRef.current === sent) {
      commitPrompt(sent);
    }
  }, [busy, commitPrompt, conv]);

  const handleStop = React.useCallback(() => {
    // No backend stop command exists; the button is unreachable because the
    // composer never enters a streaming state. Defensive notice only.
    setStopNotice(true);
  }, []);

  const notice = submissionNotice({
    attachmentCount: attachments.length,
    hasCustomSettings: selectedModelId !== DEFAULT_MODEL_ID || reasoningEffort !== 'medium',
  });
  const executionUnavailable = mode === 'execute';
  const isEmpty = conv.messages.length === 0;

  // Partial provisioning replaces the composer: there is no session yet, so
  // nothing may be submitted. The form drives one deliberate creation step.
  // After a committed creation the step stays held (disabled) until the
  // authoritative bootstrap advances; a read failure offers a read-only
  // retry that preserves the issued identity.
  if (provisionTransition && conv.status === 'error') {
    return (
      <div className="relative flex h-full w-full flex-col items-center justify-center bg-transparent">
        <div className="mx-auto flex w-full max-w-md flex-col gap-3 p-4">
          <p role="alert" className="text-sm">
            {conv.error ?? t('provision.refreshFailed', 'Change saved. Reload failed.')}
          </p>
          <button type="button" onClick={() => conv.refreshScope()} className="text-sm underline">
            {t('provision.retryLoad', 'Retry loading')}
          </button>
        </div>
      </div>
    );
  }
  if (needsProvisioning || (provisionTransition && conv.status === 'bootstrapping')) {
    const step =
      conv.status === 'needs-workspace'
        ? 'workspace'
        : conv.status === 'needs-project'
          ? 'project'
          : (provisionTransition?.step ?? 'workspace');
    // A held transition keeps its own confirmed UI disabled: creation holds
    // its form, selection holds its (disabled) list. No step switch happens
    // until authoritative bootstrap advances.
    if (provisionTransition) {
      if (provisionTransition.origin === 'selected') {
        return (
          <div className="relative flex h-full w-full flex-col items-center justify-center bg-transparent">
            <div className="mx-auto flex w-full max-w-md flex-col gap-3 p-4">
              <WorkspaceSelection
                key={step}
                workspaces={sel.workspaces}
                projectsBy={sel.projectsBy}
                truncatedWorkspaces={false}
                truncatedProjects={{}}
                activeWorkspaceId={conv.activeWorkspaceId ?? sel.activeWorkspaceId}
                activeProjectId={sel.activeProjectId}
                loading={false}
                listError={null}
                disabled
                selectError={null}
                onSelectProject={() => {}}
              />
            </div>
          </div>
        );
      }
      return (
        <div className="relative flex h-full w-full flex-col items-center justify-center bg-transparent">
          <ProvisioningForm
            key={provisionTransition.step}
            step={provisionTransition.step}
            working
            error={prov.error}
            onSubmit={() => {}}
          />
        </div>
      );
    }
    // Existing records are offered for selection first; provisioning owns
    // only the genuinely empty step — never automatic recreation. The check
    // is per step: a workspace without projects still provisions its project,
    // and a project step with projects anywhere offers switching.
    const totalProjects = Object.values(sel.projectsBy).reduce((n, ps) => n + ps.length, 0);
    const stepHasRecords =
      conv.status === 'needs-workspace' ? sel.workspaces.length > 0 : totalProjects > 0;
    // A failed project list for the active workspace is not empty: offer a
    // read-only retry, never the creation form.
    const activeProjectsFailed =
      conv.status === 'needs-project' &&
      sel.failedProjectLists.includes(conv.activeWorkspaceId ?? '');
    if (sel.loading && !sel.loaded) {
      return (
        <div className="relative flex h-full w-full flex-col items-center justify-center bg-transparent">
          <p>{t('loading', 'Loading…')}</p>
        </div>
      );
    }
    // A failed first load offers a read-only retry — never the creation
    // form, which would invite duplicate creation for existing records.
    // A workspace chosen for its first project provisions that project here,
    // bound to the chosen workspace. Checked before the selection list so
    // the choice is honored. The key resets the name field so the workspace
    // text never bleeds into the project name.
    if (chosenWorkspaceId !== null) {
      const chosenProjects = sel.projectsBy[chosenWorkspaceId] ?? [];
      if (chosenProjects.length === 0) {
        const chosenName =
          sel.workspaces.find((w) => w.workspaceId === chosenWorkspaceId)?.name ?? '';
        return (
          <div className="relative flex h-full w-full flex-col items-center justify-center bg-transparent">
            <div className="mx-auto flex w-full max-w-md flex-col gap-3 p-4">
              <p className="text-sm text-foreground-muted">
                {t('firstProjectIn', 'First project in {{name}}', { name: chosenName })}
              </p>
              <ProvisioningForm
                key={`project:${chosenWorkspaceId}`}
                step="project"
                working={formWorking}
                error={prov.error}
                onSubmit={(name) => void handleProvision(name)}
              />
              <button
                type="button"
                onClick={() => setChosenWorkspaceId(null)}
                className="text-sm underline"
              >
                {t('allWorkspaces', 'All workspaces')}
              </button>
            </div>
          </div>
        );
      }
    }
    if (stepHasRecords || activeProjectsFailed || (sel.listError && !sel.loaded)) {
      return (
        <div className="relative flex h-full w-full flex-col items-center justify-center bg-transparent">
          <div className="mx-auto flex w-full max-w-md flex-col gap-3 p-4">
            <WorkspaceSelection
              key={step}
              workspaces={sel.workspaces}
              projectsBy={sel.projectsBy}
              truncatedWorkspaces={sel.truncatedWorkspaces}
              truncatedProjects={sel.truncatedProjects}
              activeWorkspaceId={conv.activeWorkspaceId ?? sel.activeWorkspaceId}
              activeProjectId={sel.activeProjectId}
              loading={sel.loading}
              listError={sel.listError}
              disabled={formWorking}
              selectError={sel.error}
              onSelectProject={(wsId, projId) => void handleSelect(wsId, projId)}
              onChooseWorkspace={setChosenWorkspaceId}
              onRetryLists={() => void sel.refresh()}
            />
          </div>
        </div>
      );
    }
    return (
      <div className="relative flex h-full w-full flex-col items-center justify-center bg-transparent">
        <ProvisioningForm
          key={step}
          step={step}
          working={formWorking}
          error={prov.error}
          onSubmit={(name) => void handleProvision(name)}
        />
      </div>
    );
  }

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden bg-transparent">
      {/* Conversation Timeline (smoothly expands when messages exist) */}
      <div
        className={`flex flex-col overflow-y-auto transition-all duration-500 ease-in-out ${
          isEmpty ? 'max-h-0 flex-0 opacity-0 pointer-events-none' : 'flex-1 opacity-100'
        }`}
      >
        <div className="flex w-full flex-1 flex-col gap-4 p-4">
          {conv.messages.map((m) => (
            <MessageCard
              key={m.id}
              role={m.role === 'agent' ? 'assistant' : 'user'}
              text={m.text}
              timestamp={formatTimestamp(m.createdAt)}
            />
          ))}
        </div>
      </div>

      {/* Centered Logo (pushes to center when empty, smoothly collapses when session starts) */}
      <div
        className={`flex flex-col items-center justify-end transition-all duration-500 ease-in-out ${
          isEmpty
            ? 'flex-1 pb-6 opacity-100 scale-100'
            : 'max-h-0 flex-0 pb-0 opacity-0 scale-95 pointer-events-none overflow-hidden'
        }`}
      >
        <EmptyWelcome />
      </div>

      {/* Status and availability notices */}
      <div aria-live="polite">
        {conv.status === 'bootstrapping' && (
          <p>{t('conversation.starting', 'Starting conversation…')}</p>
        )}
        {conv.status === 'submitting' && <p>{t('conversation.saving', 'Saving message…')}</p>}
        {conv.error && (
          <div role="alert">
            <p>{conv.error}</p>
            <p>
              {t(
                'conversation.uncertainHint',
                'If this message may not have saved, reload history before resending.',
              )}
            </p>
            <button type="button" onClick={() => void conv.reload()}>
              {t('conversation.reloadHistory', 'Reload history')}
            </button>
          </div>
        )}
        {executionUnavailable && (
          <p>
            {t(
              'conversation.executionUnavailable',
              'Execution is unavailable in this build. Messages are saved as text only.',
            )}
          </p>
        )}
        {stopNotice && (
          <p>
            {t(
              'conversation.stopUnavailable',
              'Stop is unavailable: there is no running operation to cancel.',
            )}
          </p>
        )}
        <p>{notice}</p>
      </div>

      {/* Composer: smoothly glides from center to bottom */}
      <div
        className={`w-full transition-all duration-500 ease-in-out ${
          isEmpty
            ? 'flex-1 max-w-3xl mx-auto px-4 pb-16 flex flex-col justify-start'
            : 'flex-0 w-full'
        }`}
      >
        <Composer
          isCentered={isEmpty}
          inputText={draft}
          onChangeInput={setDraft}
          onSubmit={() => void handleSubmit()}
          onStop={handleStop}
          status="idle"
          mode={mode}
          onChangeMode={setMode}
          selectedModelId={selectedModelId}
          onSelectModel={setSelectedModelId}
          reasoningEffort={reasoningEffort}
          onChangeReasoningEffort={setReasoningEffort}
          attachments={attachments}
          onAddAttachments={(next) => setAttachments((prev) => [...prev, ...next])}
          onRemoveAttachment={(id) => setAttachments((prev) => prev.filter((a) => a.id !== id))}
          approvalRequest={null}
          onRecallPrevious={() => {
            recallPrevious();
          }}
          onRecallNext={() => {
            recallNext();
          }}
        />
      </div>
    </div>
  );
}
