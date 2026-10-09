import * as React from 'react';
import { useTranslation } from 'react-i18next';
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
import { DEFAULT_MODELS } from './compose-model-picker';

export interface ComposerProps {
  inputText: string;
  onChangeInput: (text: string) => void;
  onSubmit: () => void;
  onStop?: (() => void) | undefined;
  status?: ComposeStatus | undefined;
  mode?: ComposeMode | undefined;
  onChangeMode?: ((mode: ComposeMode) => void) | undefined;
  selectedModelId?: string | undefined;
  onSelectModel?: ((modelId: string) => void) | undefined;
  reasoningEffort?: ('low' | 'medium' | 'high') | undefined;
  onChangeReasoningEffort?: ((effort: 'low' | 'medium' | 'high') => void) | undefined;
  models?: ModelOption[] | undefined;
  attachments?: ComposeAttachment[] | undefined;
  onAddAttachments?: ((attachments: ComposeAttachment[]) => void) | undefined;
  onRemoveAttachment?: ((id: string) => void) | undefined;
  approvalRequest?: Omit<ComposeApprovalBarProps, 'className'> | null | undefined;
  scopeFolder?: string | null | undefined;
  scopePolicy?: ('standing-approval' | 'always-ask') | null | undefined;
  usedTokens?: number | null | undefined;
  maxTokens?: number | null | undefined;
  sessionSpend?: string | null | undefined;
  spendCap?: string | null | undefined;
  onRecallPrevious?: (() => void) | undefined;
  onRecallNext?: (() => void) | undefined;
  placeholder?: string | undefined;
  isCentered?: boolean | undefined;
  className?: string | undefined;
}

export function Composer({
  inputText,
  onChangeInput,
  onSubmit,
  onStop = () => {},
  status = 'idle',
  mode = 'plan',
  onChangeMode = () => {},
  selectedModelId = DEFAULT_MODELS[0]!.id,
  onSelectModel = () => {},
  reasoningEffort = 'medium',
  onChangeReasoningEffort,
  models = DEFAULT_MODELS,
  attachments = [],
  onAddAttachments = () => {},
  onRemoveAttachment = () => {},
  approvalRequest = null,
  scopeFolder = null,
  scopePolicy = null,
  usedTokens = null,
  maxTokens = null,
  sessionSpend = null,
  spendCap = null,
  onRecallPrevious,
  onRecallNext,
  placeholder,
  isCentered = false,
  className = '',
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
        {/* Top: Scope & Budget Status Strip */}
        <ComposeStatusStrip
          scopeFolder={scopeFolder}
          scopePolicy={scopePolicy}
          usedTokens={usedTokens}
          maxTokens={maxTokens}
          sessionSpend={sessionSpend}
          spendCap={spendCap}
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

        {/* RTL-aware Textarea */}
        <ComposeInput
          value={inputText}
          onChange={onChangeInput}
          onSubmit={onSubmit}
          onRecallPrevious={onRecallPrevious}
          onRecallNext={onRecallNext}
          onAttachPastedBlob={handleAttachPastedBlob}
          placeholder={placeholder}
          disabled={status === 'sending' || status === 'streaming'}
        />

        {/* Bottom Control Bar: Attachments, Modes, Model & Privacy, Send/Stop */}
        <ComposeActionBar
          mode={mode}
          onChangeMode={onChangeMode}
          selectedModelId={selectedModelId}
          onSelectModel={onSelectModel}
          reasoningEffort={reasoningEffort}
          onChangeReasoningEffort={onChangeReasoningEffort}
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
