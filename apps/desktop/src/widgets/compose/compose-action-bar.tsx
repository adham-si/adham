import * as React from 'react';
import { useTranslation } from 'react-i18next';
import { HugeiconsIcon } from '@hugeicons/react';
import { ArrowUp01Icon } from '@hugeicons/core-free-icons';
import { Button } from '@adham/ui';
import type { ComposeMode } from './compose-mode-selector';
import { ComposeModeSelector } from './compose-mode-selector';
import type { ModelOption } from './compose-model-picker';
import { ComposeModelPicker } from './compose-model-picker';
import { ComposeAttachmentMenu } from './compose-attachment-menu';
import type { ComposeAttachment } from './compose-context-chips';
import type { ComposeStatus } from './use-compose-state';

export interface ComposeActionBarProps {
  mode: ComposeMode;
  onChangeMode: (mode: ComposeMode) => void;
  selectedModelId: string;
  onSelectModel: (modelId: string) => void;
  reasoningEffort?: ('low' | 'medium' | 'high') | undefined;
  onChangeReasoningEffort?: ((effort: 'low' | 'medium' | 'high') => void) | undefined;
  models?: ModelOption[] | undefined;
  onAddAttachments: (attachments: ComposeAttachment[]) => void;
  status: ComposeStatus;
  canSubmit: boolean;
  onSubmit: () => void;
  onStop: () => void;
  className?: string | undefined;
}

export function ComposeActionBar({
  mode,
  onChangeMode,
  selectedModelId,
  onSelectModel,
  reasoningEffort,
  onChangeReasoningEffort,
  models,
  onAddAttachments,
  status,
  canSubmit,
  onSubmit,
  onStop,
  className = '',
}: ComposeActionBarProps) {
  const { t } = useTranslation();
  const isRunning = status === 'sending' || status === 'streaming';

  return (
    <div
      role="toolbar"
      aria-label="Composer actions and controls"
      className={`flex flex-wrap items-center justify-between gap-2 px-3 pb-2 pt-1 border-t border-border-subtle ${className}`}
    >
      {/* Leading controls: Attachment trigger + Mode Selector */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <ComposeAttachmentMenu onAddAttachments={onAddAttachments} disabled={isRunning} />

        <ComposeModeSelector mode={mode} onChangeMode={onChangeMode} disabled={isRunning} />
      </div>

      {/* Trailing controls: Model Picker (with Data-boundary badge) + Send/Stop Morph Button */}
      <div className="flex items-center gap-2">
        <ComposeModelPicker
          selectedModelId={selectedModelId}
          onSelectModel={onSelectModel}
          reasoningEffort={reasoningEffort}
          onChangeReasoningEffort={onChangeReasoningEffort}
          models={models}
          disabled={isRunning}
        />

        {/* Morphing Send / Stop Button */}
        {isRunning ? (
          <Button
            size="xs"
            variant="danger"
            iconOnly
            onClick={onStop}
            aria-label={t('compose.stop', 'Stop generation')}
            title={t('compose.stop', 'Stop generation')}
          >
            {/* Square Stop Glyphs */}
            <span className="size-2.5 rounded-xs bg-current" />
          </Button>
        ) : (
          <Button
            size="xs"
            variant="primary"
            iconOnly
            disabled={!canSubmit}
            onClick={onSubmit}
            aria-label={t('compose.send', 'Send instruction')}
            title={t('compose.send', 'Send instruction')}
          >
            <HugeiconsIcon icon={ArrowUp01Icon} className="size-4 stroke-[2.5]" />
          </Button>
        )}
      </div>
    </div>
  );
}
