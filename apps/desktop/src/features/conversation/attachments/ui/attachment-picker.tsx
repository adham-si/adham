import * as React from 'react';
import { useTranslation } from 'react-i18next';
import { HugeiconsIcon } from '@hugeicons/react';
import { Attachment01Icon } from '@hugeicons/core-free-icons';
import { Button } from '@adham/ui';
import { ATTACHMENT_ACCEPT } from '../api/attachment-client';

export interface AttachmentPickerProps {
  onFiles: (files: File[]) => void;
  disabled?: boolean | undefined;
}

/** Text/code file picker. A refused file still becomes a labelled chip with
 *  its reason (see use-attachments); the picker itself never filters silently
 *  beyond the accept hint. */
export function AttachmentPicker({ onFiles, disabled = false }: AttachmentPickerProps) {
  const { t } = useTranslation();
  const inputRef = React.useRef<HTMLInputElement>(null);
  return (
    <>
      <Button
        size="sm"
        variant="ghost"
        iconOnly
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
        aria-label={t('attachments.picker')}
        title={t('attachments.pickerHint')}
      >
        <HugeiconsIcon icon={Attachment01Icon} className="size-4" />
      </Button>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={ATTACHMENT_ACCEPT}
        className="hidden"
        aria-label={t('attachments.picker')}
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          event.target.value = '';
          if (files.length > 0) onFiles(files);
        }}
      />
    </>
  );
}
