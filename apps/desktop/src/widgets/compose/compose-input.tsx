import * as React from 'react';
import { useTranslation } from 'react-i18next';
import type { ComposeAttachment } from './compose-context-chips';

export interface ComposeInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onRecallPrevious?: (() => void) | undefined;
  onRecallNext?: (() => void) | undefined;
  onAttachPastedBlob?: ((attachment: ComposeAttachment) => void) | undefined;
  placeholder?: string | undefined;
  disabled?: boolean | undefined;
  minRows?: number | undefined;
  maxRows?: number | undefined;
  className?: string | undefined;
}

// Arabic / RTL character range detector
const RTL_REGEX = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;

export function isRtlText(text: string): boolean {
  if (!text) return false;
  // Check the first 50 characters to determine directionality
  const sample = text.slice(0, 50);
  return RTL_REGEX.test(sample);
}

export function ComposeInput({
  value,
  onChange,
  onSubmit,
  onRecallPrevious,
  onRecallNext,
  onAttachPastedBlob,
  placeholder,
  disabled = false,
  minRows = 2,
  maxRows = 10,
  className = '',
}: ComposeInputProps) {
  const { t } = useTranslation();
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);

  const isRtl = React.useMemo(() => isRtlText(value), [value]);

  // Auto-resize textarea height smoothly based on content
  React.useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const computedLineHeight = 20; // fallback approx line height
    const maxHeight = maxRows * computedLineHeight + 24;
    const nextHeight = Math.min(el.scrollHeight, maxHeight);
    el.style.height = `${Math.max(nextHeight, minRows * computedLineHeight)}px`;
  }, [value, minRows, maxRows]);

  // Handle paste: intercept large pastes (> 2000 characters) and turn them into a context chip
  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const pastedText = e.clipboardData.getData('text');
    if (pastedText && pastedText.length > 2000 && onAttachPastedBlob) {
      e.preventDefault();
      const firstLine = pastedText.trim().split('\n')[0]?.slice(0, 30) || 'Pasted text';
      const attachment: ComposeAttachment = {
        id: `paste-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        type: 'pasted-text',
        name: `${firstLine}... (${pastedText.length.toLocaleString()} chars)`,
        charCount: pastedText.length,
      };
      onAttachPastedBlob(attachment);
    }
  };

  // Keyboard navigation: Enter sends, Shift+Enter newlines, Up/Down recalls history when cursor at start/empty
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (value.trim() && !disabled) {
        onSubmit();
      }
      return;
    }

    if (e.key === 'ArrowUp' && (!value.trim() || e.currentTarget.selectionStart === 0)) {
      if (onRecallPrevious) {
        e.preventDefault();
        onRecallPrevious();
      }
      return;
    }

    if (
      e.key === 'ArrowDown' &&
      (!value.trim() || e.currentTarget.selectionStart === value.length)
    ) {
      if (onRecallNext) {
        e.preventDefault();
        onRecallNext();
      }
      return;
    }
  };

  return (
    <div className={`relative w-full ${className}`}>
      <textarea
        ref={textareaRef}
        dir={isRtl ? 'rtl' : 'ltr'}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
        placeholder={
          placeholder ??
          t('compose.placeholder', 'Ask anything, draft a plan, or direct an agent...')
        }
        rows={minRows}
        aria-label={t('compose.inputLabel', 'Message composer input')}
        className={`w-full resize-none border-none bg-transparent px-3 py-2 text-sm leading-relaxed text-foreground placeholder:text-foreground-muted focus:outline-none focus:ring-0 disabled:opacity-50 ${
          isRtl ? 'text-right' : 'text-left'
        }`}
      />
    </div>
  );
}
