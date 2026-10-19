import * as React from 'react';
import { useTranslation } from 'react-i18next';

export interface ComposeInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onRecallPrevious?: (() => void) | undefined;
  onRecallNext?: (() => void) | undefined;
  /** Files pasted from the clipboard; pasted text itself stays inline. */
  onPasteFiles?: ((files: File[]) => void) | undefined;
  placeholder?: string | undefined;
  disabled?: boolean | undefined;
  minRows?: number | undefined;
  maxRows?: number | undefined;
  className?: string | undefined;
  /** Backend preference (Settings → Send message on Enter). Off means Enter
   * inserts a newline like Shift+Enter. Defaults to true. */
  enterToSend?: boolean | undefined;
  /** True when a send is valid without text (selected attachments). */
  canSendEmpty?: boolean | undefined;
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
  onPasteFiles,
  placeholder,
  disabled = false,
  minRows = 2,
  maxRows = 10,
  className = '',
  enterToSend = true,
  canSendEmpty = false,
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

  // Paste: clipboard files (a copied file) go through the same ingestion as a
  // picker selection; pasted text stays inline — long pastes are just text,
  // never a chip that pretends the model received a file.
  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(e.clipboardData?.files ?? []);
    if (files.length > 0 && onPasteFiles) {
      e.preventDefault();
      onPasteFiles(files);
    }
  };

  // Keyboard navigation: Enter sends (when enter-to-send is on),
  // Shift+Enter always newlines, Up/Down recalls history when cursor at start/empty
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // IME confirmations surface as keyCode 229: never submit mid-composition.
    const composing =
      e.keyCode === 229 ||
      (typeof e.nativeEvent === 'object' &&
        e.nativeEvent !== null &&
        'isComposing' in e.nativeEvent &&
        (e.nativeEvent as { isComposing?: unknown }).isComposing === true);
    if (composing) return;

    if (e.key === 'Enter' && !e.shiftKey && enterToSend) {
      e.preventDefault();
      if ((value.trim() || canSendEmpty) && !disabled) {
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
