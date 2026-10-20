import * as React from 'react';
import { useTranslation } from 'react-i18next';
import { HugeiconsIcon } from '@hugeicons/react';
import { SendIcon } from '@hugeicons/core-free-icons';
import { Button } from '@adham/ui';
import { AttachmentPicker } from '@/features/conversation/attachments';
import type { ComposeMode } from './compose-mode-selector';
import { ComposeModeSelector } from './compose-mode-selector';
import type { ModelOption } from './compose-model-picker';
import { ComposeModelPicker } from './compose-model-picker';
import type { ComposeStatus } from './use-compose-state';

export interface ComposeActionBarProps {
  mode: ComposeMode;
  onChangeMode: (mode: ComposeMode) => void;
  selectedModelId: string;
  onSelectModel: (modelId: string) => void;
  /** Thinking on/off for evidenced thinking models (documented parameter). */
  think?: boolean | string | null | undefined;
  onChangeThink?: ((value: boolean | string | null) => void) | undefined;
  models?: ModelOption[] | undefined;
  /** No provider/model is set up yet (drives the picker's empty state). */
  modelUnavailable?: boolean | undefined;
  onAddFiles: (files: File[]) => void;
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
  think = null,
  onChangeThink,
  models,
  modelUnavailable,
  onAddFiles,
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
      aria-label={t('compose.actionsToolbar', 'Composer actions and controls')}
      className={`flex flex-wrap items-center justify-between gap-2 border-t border-border-subtle px-4 py-2 ${className}`}
    >
      {/* Leading controls: Attachment trigger + Mode Selector */}
      <div className="flex flex-wrap items-center gap-2">
        <AttachmentPicker onFiles={onAddFiles} disabled={isRunning} />

        <ComposeModeSelector mode={mode} onChangeMode={onChangeMode} disabled={isRunning} />
      </div>

      {/* Trailing controls: Model Picker (with Data-boundary badge) + Send/Stop Morph Button */}
      <div className="flex items-center gap-2">
        <ComposeModelPicker
          selectedModelId={selectedModelId}
          onSelectModel={onSelectModel}
          think={think}
          onChangeThink={onChangeThink}
          models={models}
          unavailable={modelUnavailable}
          disabled={isRunning}
        />

        {/* Morphing Send / Stop Button; while running, a queued send has its
            own visible affordance instead of the send slot. */}
        {isRunning ? (
          <div className="flex items-center gap-2">
            {canSubmit && (
              <Button
                size="sm"
                variant="primary"
                iconOnly
                onClick={onSubmit}
                aria-label={t('compose.queue', 'Queue instruction')}
                title={t('compose.queue', 'Queue instruction')}
              >
                <HugeiconsIcon icon={SendIcon} className="size-4" />
              </Button>
            )}
            <Button
              size="sm"
              variant="danger"
              iconOnly
              onClick={onStop}
              aria-label={t('compose.stop', 'Stop generation')}
              title={t('compose.stop', 'Stop generation')}
            >
              {/* Square Stop Glyphs */}
              <span className="size-3 rounded-xs bg-current" />
            </Button>
          </div>
        ) : (
          <Button
            size="sm"
            variant="primary"
            iconOnly
            disabled={!canSubmit}
            onClick={onSubmit}
            aria-label={t('compose.send', 'Send instruction')}
            title={t('compose.send', 'Send instruction')}
          >
            <HugeiconsIcon icon={SendIcon} className="size-4" />
          </Button>
        )}
      </div>
    </div>
  );
}
