import * as React from 'react';
import { useTranslation } from 'react-i18next';
import { MessageCard } from '@adham/ui';
import {
  Composer,
  EmptyWelcome,
  migratePendingDraft,
  useDrafts,
  type ComposeAttachment,
  type ComposeMode,
} from '@/widgets/compose';
import { adhamClient } from '@/shared/api/adham-client';
import { useConversation, type ConversationBackend } from './use-conversation';
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
}

/**
 * Production conversation surface. Renders backend-persisted messages only:
 * no simulated execution, no fabricated verification, no timer-driven agent
 * text. Execution, approval, and stop have no backend command and are
 * rendered unavailable instead of faked.
 */
export function ConversationPanel({ backend = adhamClient }: ConversationPanelProps) {
  const { t } = useTranslation();
  const conv = useConversation({ backend });
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

  // Drop the transient pre-bootstrap bucket residue once the backend session
  // is known. Draft text itself lives in state and is unaffected; migration
  // persists it under the session key so reloads and remounts keep it.
  React.useEffect(() => {
    if (!conv.sessionId) return;
    migratePendingDraft(conv.sessionId);
  }, [conv.sessionId]);

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
