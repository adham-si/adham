import * as React from 'react';
import { useTranslation } from 'react-i18next';
import { HugeiconsIcon } from '@hugeicons/react';
import { Cancel01Icon } from '@hugeicons/core-free-icons';
import { ComposeInput } from './compose-input';
import type { ComposeAttachment } from './compose-context-chips';
import { ComposeContextChips } from './compose-context-chips';
import { ComposeActionBar } from './compose-action-bar';
import { ComposeStatusStrip } from './compose-status-strip';
import type { ComposeApprovalBarProps } from './compose-approval-bar';
import { ComposeApprovalBar } from './compose-approval-bar';
import type { ComposeMode } from './compose-mode-selector';
import type { ComposeStatus } from './use-compose-state';
import type { ModelOption } from './compose-model-picker';

/** A send that arrived while a turn was running; it stays visible here until
 *  it is dispatched (or removed) — never injected into the active call. */
export interface QueuedInstruction {
  id: string;
  text: string;
}

export interface ComposerProps {
  inputText: string;
  onChangeInput: (text: string) => void;
  onSubmit: () => void;
  onStop?: (() => void) | undefined;
  /** Instructions waiting for the running turn to settle, shown above the
   *  input so a queueing send is never a silent no-op. */
  queued?: QueuedInstruction[] | undefined;
  onRemoveQueued?: ((id: string) => void) | undefined;
  status?: ComposeStatus | undefined;
  mode?: ComposeMode | undefined;
  onChangeMode?: ((mode: ComposeMode) => void) | undefined;
  selectedModelId?: string | undefined;
  onSelectModel?: ((modelId: string) => void) | undefined;
  /** Thinking on/off for evidenced thinking models (documented parameter). */
  think?: boolean | string | null | undefined;
  onChangeThink?: ((value: boolean | string | null) => void) | undefined;
  models?: ModelOption[] | undefined;
  attachments?: ComposeAttachment[] | undefined;
  onAddAttachments?: ((attachments: ComposeAttachment[]) => void) | undefined;
  onRemoveAttachment?: ((id: string) => void) | undefined;
  approvalRequest?: Omit<ComposeApprovalBarProps, 'className'> | null | undefined;
  /** Model maximum context in tokens, when the provider evidenced one. */
  contextLimit?: number | null | undefined;
  /** Effective request budget (model max ∩ configured), when evidenced. */
  effectiveContextBudget?: number | null | undefined;
  onRecallPrevious?: (() => void) | undefined;
  onRecallNext?: (() => void) | undefined;
  placeholder?: string | undefined;
  isCentered?: boolean | undefined;
  className?: string | undefined;
  /** Backend preference (Settings → Send message on Enter). Defaults to true. */
  enterToSend?: boolean | undefined;
}

export function Composer({
  inputText,
  onChangeInput,
  onSubmit,
  onStop = () => {},
  queued = [],
  onRemoveQueued,
  status = 'idle',
  mode = 'plan',
  onChangeMode = () => {},
  selectedModelId = '',
  onSelectModel = () => {},
  think = null,
  onChangeThink,
  models = [],
  attachments = [],
  onAddAttachments = () => {},
  onRemoveAttachment = () => {},
  approvalRequest = null,
  contextLimit = null,
  effectiveContextBudget = null,
  onRecallPrevious,
  onRecallNext,
  placeholder,
  isCentered = false,
  className = '',
  enterToSend = true,
}: ComposerProps) {
  const { t } = useTranslation();
  const [isDragOver, setIsDragOver] = React.useState(false);

  const canSubmit = Boolean(inputText.trim() || attachments.length > 0) && status !== 'error';

  // Drag and drop handlers
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const items: ComposeAttachment[] = Array.from(e.dataTransfer.files).map((f) => ({
        id: `drop-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        type: f.type.startsWith('image/') ? 'image' : 'file',
        name: f.name,
        size: f.size,
        file: f,
      }));
      onAddAttachments(items);
    }
  };

  const handleAttachPastedBlob = (attachment: ComposeAttachment) => {
    onAddAttachments([attachment]);
  };

  return (
    <footer
      className={`w-full transition-all duration-500 ease-in-out ${
        isCentered ? 'bg-transparent p-0' : 'bg-transparent px-4 pb-4 pt-1'
      } ${className}`}
    >
      {/* Screen reader announcement for streaming state */}
      <div aria-live="polite" className="sr-only">
        {status === 'streaming'
          ? t('compose.srStreaming', 'Agent is streaming response')
          : status === 'awaiting-approval'
            ? t('compose.srAwaitingApproval', 'Agent requires approval to proceed')
            : ''}
      </div>

      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`w-full transition-all duration-500 ease-in-out ${
          isCentered ? 'max-w-2xl mx-auto border-border' : 'border-border-subtle'
        } rounded-2xl border bg-surface hover:border-border focus-within:border-focus focus-within:ring-1 focus-within:ring-focus ${
          isDragOver ? 'border-focus border-dashed bg-focus/5 ring-2 ring-focus/20' : ''
        }`}
      >
        {/* Top: evidenced context status (renders nothing without evidence) */}
        <ComposeStatusStrip
          contextLimit={contextLimit}
          effectiveContextBudget={effectiveContextBudget}
          className="border-b border-border-subtle/60"
        />

        {/* Docked Inline Approval Bar (if waiting for confirmation) */}
        {approvalRequest && (
          <div className="p-2 border-b border-border-subtle/80">
            <ComposeApprovalBar
              actionSummary={approvalRequest.actionSummary}
              onApprove={approvalRequest.onApprove}
              onDeny={approvalRequest.onDeny}
              onReviewDiff={approvalRequest.onReviewDiff}
              riskLevel={approvalRequest.riskLevel}
            />
          </div>
        )}

        {/* Attached Context Chips (Files, Folders, Pasted Text Blobs) */}
        <ComposeContextChips attachments={attachments} onRemove={onRemoveAttachment} />

        {/* Queued instructions: visible while a turn runs; each is dispatched
            when the turn settles unless the user removes it first. */}
        {queued.length > 0 && (
          <div aria-live="polite" className="space-y-1 px-3 pt-2">
            {queued.map((item) => (
              <div
                key={item.id}
                className="flex items-center gap-2 rounded-md border border-border-subtle bg-surface-subtle px-2 py-1 text-xs text-foreground-secondary"
              >
                <span className="shrink-0 rounded border border-border-subtle bg-surface px-1 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-foreground-muted">
                  {t('compose.queuedHeading', 'Queued')}
                </span>
                <span className="truncate" title={item.text}>
                  {item.text}
                </span>
                <button
                  type="button"
                  onClick={() => onRemoveQueued?.(item.id)}
                  aria-label={t('compose.removeQueued', 'Remove queued instruction')}
                  title={t('compose.removeQueued', 'Remove queued instruction')}
                  className="ms-auto shrink-0 rounded p-0.5 text-foreground-muted hover:bg-surface-hover hover:text-foreground"
                >
                  <HugeiconsIcon icon={Cancel01Icon} className="size-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* RTL-aware Textarea */}
        <ComposeInput
          value={inputText}
          onChange={onChangeInput}
          onSubmit={onSubmit}
          onRecallPrevious={onRecallPrevious}
          onRecallNext={onRecallNext}
          onAttachPastedBlob={handleAttachPastedBlob}
          placeholder={placeholder}
          enterToSend={enterToSend}
        />

        {/* Bottom Control Bar: Attachments, Modes, Model & Privacy, Send/Stop */}
        <ComposeActionBar
          mode={mode}
          onChangeMode={onChangeMode}
          selectedModelId={selectedModelId}
          onSelectModel={onSelectModel}
          think={think}
          onChangeThink={onChangeThink}
          models={models}
          onAddAttachments={onAddAttachments}
          status={status}
          canSubmit={canSubmit}
          onSubmit={onSubmit}
          onStop={onStop}
        />
      </div>
    </footer>
  );
}
