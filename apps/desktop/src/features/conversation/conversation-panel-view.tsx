import * as React from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { HugeiconsIcon } from '@hugeicons/react';
import {
  ArrowDownToLineIcon,
  Bookmark01Icon,
  BotMessageSquareIcon,
  CopyIcon,
  MoreVerticalIcon,
  PencilLineIcon,
  RefreshCcwIcon,
  ThumbsDownIcon,
  ThumbsUpIcon,
  UserIcon,
} from '@hugeicons/core-free-icons';
import {
  contentFromText,
  MessageCard,
  type MarkdownLabels,
  type MessageActionIcons,
} from '@adham/ui';
import type { AttachmentDto } from '@adham/contracts-generated';
import {
  Composer,
  EmptyWelcome,
  type ComposeMode,
  type ComposeStatus,
  type ModelOption,
  type QueuedInstruction,
} from '@/widgets/compose';
import { MessageAttachments, type useAttachments } from './attachments';
import { formatTime } from '@/shared/i18n/format';
import type { useConversation, UiMessage } from './use-conversation';
import {
  PendingRecoveryBanner,
  PendingRecoveryReviewDialog,
  type usePendingRecovery,
} from './pending-recovery';
import { ProviderRecoveryBanner, type useProviderRecovery } from './provider-recovery';
import { TurnStatus } from './turn-status';
import type { AlternativeInfo } from './alternative-groups';
import type { AnswerFeedback } from './conversation-scope';
import type { PendingReference, TurnAction } from './use-turn-dispatch';

/** Header avatars and action glyphs as nodes: the card renders what the app
 *  hands it, so @adham/ui stays free of an icon dependency. */
const ASSISTANT_AVATAR = <HugeiconsIcon icon={BotMessageSquareIcon} className="size-5" />;
const USER_AVATAR = <HugeiconsIcon icon={UserIcon} className="size-5" />;
const MESSAGE_ICONS: MessageActionIcons = {
  copy: <HugeiconsIcon icon={CopyIcon} className="size-4" />,
  edit: <HugeiconsIcon icon={PencilLineIcon} className="size-4" />,
  regenerate: <HugeiconsIcon icon={RefreshCcwIcon} className="size-4" />,
  like: <HugeiconsIcon icon={ThumbsUpIcon} className="size-4" />,
  // Mirrored so the thumb faces the same way as the like glyph.
  dislike: <HugeiconsIcon icon={ThumbsDownIcon} className="size-4 -scale-x-100" />,
  more: <HugeiconsIcon icon={MoreVerticalIcon} className="size-4" />,
  bookmark: <HugeiconsIcon icon={Bookmark01Icon} className="size-4" />,
};

function formatTimestamp(createdAt: string): string {
  const parsed = new Date(createdAt);
  if (Number.isNaN(parsed.getTime())) return createdAt;
  return formatTime(parsed);
}

/**
 * Honest lifecycle note for a persisted assistant turn. Derived from the
 * stored completion only — never from text length or timing.
 */
function messageNote(m: UiMessage, t: TFunction): { text: string; tone: 'muted' | 'error' } | null {
  const completion = m.completion;
  if (!completion) return null;
  if (completion.state === 'interrupted') {
    return { text: t('conversation.turnInterrupted', 'Cancelled'), tone: 'muted' };
  }
  if (completion.state === 'failed') {
    return m.text === ''
      ? { text: t('conversation.turnNoAnswer', 'No answer was produced.'), tone: 'error' }
      : { text: t('conversation.turnFailed', 'Generation failed.'), tone: 'error' };
  }
  return completion.truncated
    ? { text: t('conversation.turnTruncated', 'Truncated by the length limit.'), tone: 'muted' }
    : null;
}

export interface ConversationPanelViewProps {
  conv: ReturnType<typeof useConversation>;
  attachments: ReturnType<typeof useAttachments>;
  recovery: ReturnType<typeof usePendingRecovery>;
  providerRecovery: ReturnType<typeof useProviderRecovery>;
  timeline: {
    ref: React.RefObject<HTMLDivElement | null>;
    onScroll: () => void;
    showJumpToLatest: boolean;
    scrollToLatest: () => void;
    isEmpty: boolean;
  };
  messages: {
    alternatives: Map<string, AlternativeInfo>;
    assistantName: string | undefined;
    turnAction: TurnAction | null;
    busy: boolean;
    feedbackByAnswer: Map<string, AnswerFeedback>;
    bookmarkedMessageIds: string[];
    readAttachmentText?: ((attachmentId: string) => Promise<AttachmentDto>) | undefined;
    onRegenerate: () => void;
    setActionNotice: (notice: string | null) => void;
    setPendingReference: (reference: PendingReference | null) => void;
    draftRef: React.RefObject<string>;
    setDraft: (text: string) => void;
  };
  compose: {
    draft: string;
    onSubmit: () => void;
    onStop: () => void;
    queued: QueuedInstruction[];
    onRemoveQueued: (id: string) => void;
    pendingReference: PendingReference | null;
    onCancelReference: () => void;
    status: ComposeStatus;
    enterToSend: boolean;
    mode: ComposeMode;
    onChangeMode: (mode: ComposeMode) => void;
    selectedModelId: string;
    onSelectModel: (modelId: string) => void;
    models: ModelOption[];
    modelUnavailable: boolean;
    think: boolean | string | null;
    onChangeThink: (value: boolean | string | null) => void;
    contextLimit: number | null;
    effectiveContextBudget: number | null;
    onAddFiles: (files: File[]) => void;
    onRemoveAttachment: (key: string) => void;
    isDragOverExternal: boolean;
    onRecallPrevious: () => void;
    onRecallNext: () => void;
  };
  notices: {
    actionNotice: string | null;
    executionUnavailable: boolean;
    stopNotice: boolean;
    submitError: string | null;
  };
}

/** The conversation render tree, separated from the orchestration state so
 *  both stay readable and within the file-size limit. */
export function ConversationPanelView({
  conv,
  attachments,
  recovery,
  providerRecovery,
  timeline,
  messages,
  compose,
  notices,
}: ConversationPanelViewProps) {
  const { t } = useTranslation();
  /** Localized strings for the message renderer (code copy, placeholders). */
  const markdownLabels = React.useMemo<Partial<MarkdownLabels>>(
    () => ({
      copyCode: t('compose.markdown.copyCode'),
      codeLabel: t('compose.markdown.code'),
      copyMessage: t('compose.markdown.copyMessage'),
      copied: t('compose.markdown.copied'),
      copyFailed: t('compose.markdown.copyFailed'),
      imageNotShown: t('compose.markdown.imageNotShown'),
      unsupportedContent: t('compose.markdown.unsupportedContent'),
      replyAction: t('compose.markdown.replyAction'),
      quoteLabel: t('compose.markdown.quoteLabel'),
      quoteUnavailable: t('compose.markdown.quoteUnavailable'),
      branchActiveLabel: t('compose.markdown.branchActive'),
      branchMakeActiveLabel: t('compose.markdown.branchMakeActive'),
      likeAction: t('compose.markdown.likeAnswer'),
      dislikeAction: t('compose.markdown.dislikeAnswer'),
      feedbackReason: t('compose.markdown.feedbackReason'),
      feedbackTitle: t('compose.markdown.feedbackTitle'),
      feedbackLocalNote: t('compose.markdown.feedbackLocalNote'),
      feedbackSave: t('compose.markdown.feedbackSave'),
      regenerateAction: t('conversation.regenerateAnswer'),
      moreActions: t('compose.markdown.moreActions'),
      bookmarkMessage: t('compose.markdown.bookmarkMessage'),
      removeBookmark: t('compose.markdown.removeBookmark'),
    }),
    [t],
  );
  const {
    ref: timelineRef,
    onScroll: handleTimelineScroll,
    showJumpToLatest,
    scrollToLatest,
    isEmpty,
  } = timeline;
  const {
    alternatives,
    assistantName,
    turnAction,
    busy,
    feedbackByAnswer,
    bookmarkedMessageIds,
    readAttachmentText,
    onRegenerate: handleTurnAction,
    setActionNotice,
    setPendingReference,
    draftRef,
    setDraft,
  } = messages;
  const bookmarkedIds = React.useMemo(() => new Set(bookmarkedMessageIds), [bookmarkedMessageIds]);
  const {
    draft,
    onSubmit: handleSubmit,
    onStop: handleStop,
    queued,
    onRemoveQueued,
    pendingReference,
    onCancelReference: cancelPendingReference,
    status: composeStatus,
    enterToSend,
    mode,
    onChangeMode: handleChangeMode,
    selectedModelId,
    onSelectModel: handleSelectModel,
    models: pickerModels,
    modelUnavailable,
    think,
    onChangeThink: setThink,
    contextLimit,
    effectiveContextBudget,
    onAddFiles,
    onRemoveAttachment,
    isDragOverExternal,
    onRecallPrevious,
    onRecallNext,
  } = compose;
  const { actionNotice, executionUnavailable, stopNotice, submitError } = notices;
  /** Quoted text for a reference: null when the target is not in the loaded
   *  history, which the card then states instead of inventing an excerpt. */
  const quotedExcerptOf = (messageId: string): string | null =>
    conv.messages.find((m) => m.id === messageId)?.text ?? null;

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden bg-transparent">
      {/* Pending recovery banners: unsent messages and unfinished provider
          operations have separate lifecycles and separate actions. */}
      <div className="space-y-2 px-4 pt-2">
        <PendingRecoveryBanner
          operations={recovery.operations}
          truncated={recovery.truncated}
          onReview={recovery.openReview}
          onDismiss={(op) => recovery.openDismiss(op)}
        />
        <ProviderRecoveryBanner
          operations={providerRecovery.operations}
          error={providerRecovery.error}
          busyOperationId={providerRecovery.busyOperationId}
          onRetry={() => void providerRecovery.refresh()}
          onMarkInterrupted={providerRecovery.markInterrupted}
        />
      </div>

      {/* Conversation Timeline (smoothly expands when messages exist) */}
      <div
        ref={timelineRef}
        onScroll={handleTimelineScroll}
        data-testid="conversation-timeline"
        className={`flex flex-col overflow-y-auto transition-all duration-500 ease-in-out ${
          isEmpty ? 'max-h-0 flex-0 opacity-0 pointer-events-none' : 'flex-1 opacity-100'
        }`}
      >
        <div className="flex w-full flex-1 flex-col gap-6 p-4">
          {conv.messages.map((m) => {
            const note = messageNote(m, t);
            const alternative = alternatives.get(m.id);
            const isAssistant = m.role === 'assistant' || m.role === 'agent';
            // Regenerate is offered on the newest answer attempt only: the
            // backend reruns that attempt, never an older one.
            const canRegenerate = turnAction !== null && m.id === turnAction.attemptId;
            return (
              <React.Fragment key={m.id}>
                <MessageCard
                  role={isAssistant ? 'assistant' : 'user'}
                  name={isAssistant ? assistantName : undefined}
                  avatar={isAssistant ? ASSISTANT_AVATAR : USER_AVATAR}
                  icons={MESSAGE_ICONS}
                  content={contentFromText(m.text)}
                  leading={
                    !isAssistant && (m.attachments?.length ?? 0) > 0 ? (
                      <MessageAttachments
                        attachments={m.attachments!}
                        readText={readAttachmentText}
                      />
                    ) : undefined
                  }
                  labels={
                    canRegenerate && turnAction.verb === 'retry'
                      ? { ...markdownLabels, regenerateAction: t('conversation.retryTurn') }
                      : markdownLabels
                  }
                  timestamp={formatTimestamp(m.createdAt)}
                  data-message-id={m.provisional ? undefined : m.id}
                  tabIndex={-1}
                  bookmarked={bookmarkedIds.has(m.id)}
                  onToggleBookmark={
                    m.provisional
                      ? undefined
                      : () => {
                          void conv
                            .setMessageBookmark(m.id, !bookmarkedIds.has(m.id))
                            .then((outcome) => setActionNotice(outcome.ok ? null : outcome.error));
                        }
                  }
                  onRegenerate={canRegenerate ? handleTurnAction : undefined}
                  regenerateDisabled={busy}
                  branch={
                    alternative
                      ? {
                          active: alternative.active,
                          onMakeActive: alternative.active
                            ? undefined
                            : () => {
                                void conv
                                  .makeAlternativeActive(alternative.rootId, m.id)
                                  .then((outcome) =>
                                    setActionNotice(outcome.ok ? null : outcome.error),
                                  );
                              },
                        }
                      : undefined
                  }
                  // Feedback is for a settled, persisted answer attempt: the
                  // provisional bubble has no durable id to key a verdict to,
                  // so it is never offered one.
                  feedback={m.provisional || !isAssistant ? undefined : feedbackByAnswer.get(m.id)}
                  onFeedback={
                    m.provisional || !isAssistant
                      ? undefined
                      : (verdict, reason) => {
                          void conv
                            .setAnswerFeedback(m.id, verdict, reason)
                            .then((outcome) => setActionNotice(outcome.ok ? null : outcome.error));
                        }
                  }
                  quotedExcerpt={
                    m.reference ? quotedExcerptOf(m.reference.refersToMessageId) : undefined
                  }
                  quotedRelation={m.reference?.relation}
                  // Only persisted rows can reference a message: the provisional
                  // bubble carries no durable id the backend could validate.
                  onReply={
                    m.provisional
                      ? undefined
                      : () =>
                          setPendingReference({ id: m.id, relation: 'replied', excerpt: m.text })
                  }
                  // Edit rewrites the prompt, which the backend accepts only
                  // for user rows: never offered where it would have to refuse.
                  onEdit={
                    m.provisional || m.role !== 'user'
                      ? undefined
                      : () => {
                          setPendingReference({
                            id: m.id,
                            relation: 'edited-from',
                            excerpt: m.text,
                            priorDraft: draftRef.current,
                          });
                          setDraft(m.text);
                        }
                  }
                />
                {note && (
                  <p
                    role="status"
                    className={`px-1 text-xs ${
                      note.tone === 'error' ? 'text-destructive' : 'text-foreground-muted'
                    }`}
                  >
                    {note.text}
                  </p>
                )}
              </React.Fragment>
            );
          })}
          {conv.streaming && conv.streaming.text !== '' && (
            <MessageCard
              key={conv.streaming.opId || 'streaming'}
              role="assistant"
              name={assistantName}
              avatar={ASSISTANT_AVATAR}
              icons={MESSAGE_ICONS}
              streaming
              content={contentFromText(conv.streaming.text)}
              labels={markdownLabels}
              timestamp={formatTime(new Date())}
            />
          )}
          {conv.streaming && conv.streaming.phase !== 'streaming' && (
            <TurnStatus
              phase={conv.streaming.phase}
              startedAt={conv.streaming.startedAt}
              name={assistantName}
            />
          )}
          {/* Non-authoritative recovery: only when the post-terminal history
              reload failed; replaced atomically by authoritative rows. */}
          {conv.recoverySnapshot && (
            <MessageCard
              key={conv.recoverySnapshot.id}
              role="assistant"
              name={assistantName}
              avatar={ASSISTANT_AVATAR}
              icons={MESSAGE_ICONS}
              content={contentFromText(conv.recoverySnapshot.text)}
              labels={markdownLabels}
              timestamp={formatTimestamp(conv.recoverySnapshot.createdAt)}
            />
          )}
          {showJumpToLatest && (
            <button
              type="button"
              onClick={scrollToLatest}
              aria-label={t('conversation.jumpToLatest')}
              title={t('conversation.jumpToLatest')}
              className="sticky bottom-0 flex size-8 items-center justify-center self-end rounded-full border border-border-subtle bg-surface-subtle text-foreground-secondary shadow-sm hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
            >
              <HugeiconsIcon icon={ArrowDownToLineIcon} className="size-4" />
            </button>
          )}
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
        {conv.storageWarning && (
          <div
            role="status"
            className="p-2 text-xs text-warning-foreground bg-warning-surface rounded"
          >
            <p>{conv.storageWarning}</p>
          </div>
        )}
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
        {actionNotice && (
          <div
            role="status"
            className="p-2 text-xs text-warning-foreground bg-warning-surface rounded"
          >
            <p>{actionNotice}</p>
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
        {conv.omittedMessages > 0 && (
          <div
            role="status"
            className="p-2 text-xs text-warning-foreground bg-warning-surface rounded"
          >
            <p>
              {t(
                'conversation.contextTruncated',
                'Older messages were omitted so this request fits the model context (estimated).',
              )}{' '}
              {t('conversation.omittedMessagesLabel', 'Omitted messages')}: {conv.omittedMessages}
            </p>
          </div>
        )}
        {stopNotice && (
          <p>
            {t(
              'conversation.stopUnavailable',
              'Stop is unavailable: there is no running operation to cancel.',
            )}
          </p>
        )}
        {submitError && (
          <div role="alert">
            <p>{submitError}</p>
          </div>
        )}
        {recovery.error && (
          <div role="alert" className="p-2 text-xs text-destructive bg-destructive/10 rounded">
            <p>{recovery.error}</p>
          </div>
        )}
        {recovery.cleanupWarning && (
          <div
            role="status"
            className="p-2 text-xs text-warning-foreground bg-warning-surface rounded"
          >
            <p>{recovery.cleanupWarning}</p>
          </div>
        )}
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
          onSubmit={handleSubmit}
          onStop={handleStop}
          queued={queued}
          onRemoveQueued={onRemoveQueued}
          replyTo={
            pendingReference
              ? { relation: pendingReference.relation, excerpt: pendingReference.excerpt }
              : null
          }
          onCancelReply={cancelPendingReference}
          status={composeStatus}
          enterToSend={enterToSend}
          mode={mode}
          onChangeMode={handleChangeMode}
          selectedModelId={selectedModelId}
          onSelectModel={handleSelectModel}
          models={pickerModels}
          modelUnavailable={modelUnavailable}
          think={think}
          onChangeThink={setThink}
          contextLimit={contextLimit}
          effectiveContextBudget={effectiveContextBudget}
          attachments={attachments.items.map((item) => ({
            key: item.key,
            fileName: item.fileName,
            byteSize: item.byteSize,
            charCount: item.charCount,
            status: item.status,
            truncated: item.meta?.truncated ?? false,
            errorCode: item.errorCode,
          }))}
          onAddFiles={onAddFiles}
          onRemoveAttachment={onRemoveAttachment}
          isDragOverExternal={isDragOverExternal}
          approvalRequest={null}
          onRecallPrevious={onRecallPrevious}
          onRecallNext={onRecallNext}
        />
      </div>

      <PendingRecoveryReviewDialog
        open={recovery.reviewDialogOpen}
        operation={recovery.activeReviewOp}
        validatingTarget={recovery.validatingTarget}
        targetMissing={recovery.targetMissing}
        initialDismissConfirm={recovery.initialDismissConfirm}
        onClose={recovery.closeReview}
        onResend={(op) => recovery.resendOperation(op)}
        onDismiss={(op) => recovery.dismissOperation(op)}
      />
    </div>
  );
}
