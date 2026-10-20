import { describe, expect, it, vi } from 'vitest';
import {
  MAX_ATTACHMENT_BYTES,
  attachmentErrorCode,
  fileNameFromPath,
  readFileText,
} from './attachment-client';

describe('attachmentErrorCode', () => {
  it('maps the backend refusal codes', () => {
    expect(attachmentErrorCode(new Error('VALIDATION_FAILED: attachment.tooLarge'))).toBe(
      'tooLarge',
    );
    expect(attachmentErrorCode('attachment.selectionTooLarge')).toBe('selectionTooLarge');
    expect(attachmentErrorCode(new Error('attachment.unreadable: disk error'))).toBe('unreadable');
  });

  it('keeps anything else unknown instead of guessing a reason', () => {
    expect(attachmentErrorCode(new Error('policy denied'))).toBe('unknown');
    expect(attachmentErrorCode(new Error('attachment.somethingNew'))).toBe('unknown');
  });
});

describe('readFileText', () => {
  it('decodes UTF-8 bytes with the declared byte size', async () => {
    const file = new File(['# notes\nsalam'], 'notes.md', { type: 'text/markdown' });
    const { text, byteSize } = await readFileText(file);
    expect(text).toBe('# notes\nsalam');
    expect(byteSize).toBe(13);
  });

  it('refuses invalid UTF-8 instead of mangling it', async () => {
    const file = new File([new Uint8Array([0xff, 0xfe, 0x41])], 'broken.txt');
    await expect(readFileText(file)).rejects.toThrow('attachment.notUtf8');
  });

  it('refuses an oversize file before reading any bytes', async () => {
    const arrayBuffer = vi.fn();
    const oversize = { size: MAX_ATTACHMENT_BYTES + 1, arrayBuffer } as unknown as File;
    await expect(readFileText(oversize)).rejects.toThrow('attachment.tooLarge');
    expect(arrayBuffer).not.toHaveBeenCalled();
  });
});

describe('fileNameFromPath', () => {
  it('reads the base name of posix and windows paths', () => {
    expect(fileNameFromPath('/tmp/notes.md')).toBe('notes.md');
    expect(fileNameFromPath('C:\\Users\\dev\\main.rs')).toBe('main.rs');
    expect(fileNameFromPath('bare.txt')).toBe('bare.txt');
  });
});
