import * as React from 'react';
import { useTranslation } from 'react-i18next';
import { HugeiconsIcon } from '@hugeicons/react';
import {
  Attachment01Icon,
  Image01Icon,
  Folder01Icon,
  File01Icon,
} from '@hugeicons/core-free-icons';
import type { ComposeAttachment } from './compose-context-chips';

export interface ComposeAttachmentMenuProps {
  onAddAttachments: (attachments: ComposeAttachment[]) => void;
  supportsVision?: boolean | undefined;
  disabled?: boolean | undefined;
  className?: string | undefined;
}

export function ComposeAttachmentMenu({
  onAddAttachments,
  supportsVision = true,
  disabled = false,
  className = '',
}: ComposeAttachmentMenuProps) {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = React.useState(false);
  const containerRef = React.useRef<HTMLDivElement>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const imageInputRef = React.useRef<HTMLInputElement>(null);

  // Close menu on click outside or Escape
  React.useEffect(() => {
    if (!isOpen) return;
    const handleOutsideClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsOpen(false);
    };

    document.addEventListener('mousedown', handleOutsideClick);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  const handleFiles = (files: FileList | null, forcedType?: 'image' | 'file') => {
    if (!files || files.length === 0) return;
    const items: ComposeAttachment[] = [];

    Array.from(files).forEach((file) => {
      const isImg = forcedType === 'image' || file.type.startsWith('image/');
      items.push({
        id: `att-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        type: isImg ? 'image' : 'file',
        name: file.name,
        size: file.size,
        file,
      });
    });

    onAddAttachments(items);
    setIsOpen(false);
  };

  return (
    <div ref={containerRef} className={`relative inline-flex items-center ${className}`}>
      {/* Hidden file input for documents/files */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => handleFiles(e.target.files, 'file')}
      />

      {/* Hidden file input for images */}
      <input
        ref={imageInputRef}
        type="file"
        multiple
        accept="image/*"
        className="hidden"
        onChange={(e) => handleFiles(e.target.files, 'image')}
      />

      {/* Trigger Button */}
      <button
        type="button"
        disabled={disabled}
        onClick={() => setIsOpen((prev) => !prev)}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-label={t('compose.attach', 'Attach files, images or folders')}
        title={t('compose.attach', 'Attach files, images or folders')}
        className="flex size-7 items-center justify-center rounded-lg text-foreground-secondary transition-colors hover:bg-surface-hover hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus disabled:opacity-50"
      >
        <HugeiconsIcon icon={Attachment01Icon} className="size-4" />
      </button>

      {/* Dropdown Menu */}
      {isOpen && (
        <div
          role="menu"
          aria-label="Attachment options"
          className="absolute bottom-full mb-1.5 start-0 z-50 min-w-44 rounded-xl border border-border-subtle bg-surface p-1 shadow-xl backdrop-blur-md animate-in fade-in zoom-in-95 duration-100"
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => fileInputRef.current?.click()}
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs text-foreground transition-colors hover:bg-surface-hover"
          >
            <HugeiconsIcon icon={File01Icon} className="size-3.5 text-foreground-secondary" />
            <span>{t('compose.attachFile', 'Attach File')}</span>
          </button>

          <button
            type="button"
            role="menuitem"
            onClick={() => imageInputRef.current?.click()}
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs text-foreground transition-colors hover:bg-surface-hover"
          >
            <HugeiconsIcon icon={Image01Icon} className="size-3.5 text-foreground-secondary" />
            <div className="flex flex-col text-start">
              <span>{t('compose.attachImage', 'Attach Image')}</span>
              {!supportsVision && (
                <span className="text-[10px] text-warning">
                  Active model has no vision
                </span>
              )}
            </div>
          </button>

          <button
            type="button"
            role="menuitem"
            onClick={() => {
              // Simulated folder attachment chip for approved-folder rules
              onAddAttachments([
                {
                  id: `folder-${Date.now()}`,
                  type: 'folder',
                  name: 'Selected project folder',
                },
              ]);
              setIsOpen(false);
            }}
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs text-foreground transition-colors hover:bg-surface-hover"
          >
            <HugeiconsIcon icon={Folder01Icon} className="size-3.5 text-foreground-secondary" />
            <span>{t('compose.attachFolder', 'Attach Folder Scope')}</span>
          </button>
        </div>
      )}
    </div>
  );
}
