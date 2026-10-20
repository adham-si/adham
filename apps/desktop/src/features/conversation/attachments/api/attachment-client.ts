/** One selected file the composer will send: the extracted text of a picked
 *  file (read in the webview, bounded) or a dropped filesystem path the Rust
 *  side will read. Both are handed to ingestion at send time when no session
 *  exists yet (the session is created by the first send). */
export type PendingFile =
  | { kind: 'text'; fileName: string; text: string }
  | { kind: 'path'; filePath: string };

/** Refusal codes the backend can return under `attachment.<code>`. Unknown
 *  messages stay 'unknown' — the UI never invents a reason. */
export type AttachmentErrorCode =
  | 'tooLarge'
  | 'unsupportedType'
  | 'binaryContent'
  | 'notUtf8'
  | 'notFound'
  | 'selectionTooLarge'
  | 'unsupportedSource'
  | 'unreadable'
  | 'unknown';

/** Mirror of the Rust `MAX_ATTACHMENT_BYTES` (5 MiB): a fast pre-check only,
 *  the backend re-validates every byte it receives. */
export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;

const KNOWN_CODES: readonly AttachmentErrorCode[] = [
  'tooLarge',
  'unsupportedType',
  'binaryContent',
  'notUtf8',
  'notFound',
  'selectionTooLarge',
  'unsupportedSource',
  'unreadable',
];

export function attachmentErrorCode(error: unknown): AttachmentErrorCode {
  const message = error instanceof Error ? error.message : String(error);
  const match = /attachment\.([A-Za-z]+)/.exec(message);
  const code = match?.[1] as AttachmentErrorCode | undefined;
  return code && KNOWN_CODES.includes(code) ? code : 'unknown';
}

/** Read a picked file as UTF-8 with a fatal decoder, so an invalid byte
 *  sequence is a refusal instead of a silently mangled prompt. */
export async function readFileText(file: File): Promise<{ text: string; byteSize: number }> {
  if (file.size > MAX_ATTACHMENT_BYTES) {
    throw new Error('VALIDATION_FAILED: attachment.tooLarge');
  }
  const buffer = await file.arrayBuffer();
  try {
    return {
      text: new TextDecoder('utf-8', { fatal: true }).decode(buffer),
      byteSize: buffer.byteLength,
    };
  } catch {
    throw new Error('VALIDATION_FAILED: attachment.notUtf8');
  }
}

/** Display-only base name of a dropped path; the backend sanitizes the name it
 *  stores, and this only labels the chip while a path is still pending. */
export function fileNameFromPath(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

/** Extensions the backend classifies as text/code (mirror of `classify_text`).
 *  The picker filter is a convenience; the backend re-checks and refuses. */
export const ATTACHMENT_ACCEPT = [
  '.txt',
  '.text',
  '.log',
  '.md',
  '.markdown',
  '.json',
  '.yaml',
  '.yml',
  '.toml',
  '.csv',
  '.tsv',
  '.html',
  '.htm',
  '.css',
  '.xml',
  '.ini',
  '.cfg',
  '.conf',
  '.sh',
  '.bash',
  '.zsh',
  '.py',
  '.rs',
  '.go',
  '.java',
  '.kt',
  '.kts',
  '.swift',
  '.c',
  '.h',
  '.cc',
  '.cpp',
  '.cxx',
  '.hpp',
  '.cs',
  '.rb',
  '.php',
  '.sql',
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.vue',
  '.svelte',
].join(',');
