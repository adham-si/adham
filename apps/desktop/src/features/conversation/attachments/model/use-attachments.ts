import * as React from 'react';
import type { AttachmentDto, MessageAttachmentDto } from '@adham/contracts-generated';
import type { ConversationBackend } from '../../conversation-scope';
import {
  attachmentErrorCode,
  fileNameFromPath,
  readFileText,
  type AttachmentErrorCode,
  type PendingFile,
} from '../api/attachment-client';

export type AttachmentStatus = 'reading' | 'ready' | 'pending' | 'error';

/** One composer selection. 'reading' = the webview/Rust side is opening it,
 *  'ready' = stored in the session's attachment index, 'pending' = no session
 *  exists yet (created by the first send) so it is read at send time,
 *  'error' = refused; it stays visible until the user removes it. */
export interface ComposeAttachment {
  key: string;
  fileName: string;
  byteSize?: number | undefined;
  charCount?: number | undefined;
  status: AttachmentStatus;
  meta?: MessageAttachmentDto | undefined;
  pending?: PendingFile | undefined;
  errorCode?: AttachmentErrorCode | undefined;
}

export interface AttachmentScope {
  workspaceId: string;
  projectId: string;
  sessionId: string | null;
}

let localCounter = 0;
function nextKey(): string {
  localCounter += 1;
  return `attachment-${localCounter}`;
}

export function messageAttachmentOf(dto: AttachmentDto): MessageAttachmentDto {
  return {
    attachmentId: dto.attachmentId,
    fileName: dto.fileName,
    mediaType: dto.mediaType,
    byteSize: dto.byteSize,
    contentHash: dto.contentHash,
    hashAlgorithm: dto.hashAlgorithm,
    extractedChars: dto.extractedChars,
    truncated: dto.truncated,
  };
}

/** Composer attachment selections: pick/paste/drop ingestion now when a
 *  session exists, otherwise a pending payload the send ingests after the
 *  lazy session is created. Nothing is invented: a chip shows the state the
 *  backend returned, and a refusal keeps the chip with its reason. */
export function useAttachments({
  backend,
  scope,
}: {
  backend: ConversationBackend;
  scope: AttachmentScope | null;
}) {
  const [items, setItems] = React.useState<ComposeAttachment[]>([]);
  const scopeRef = React.useRef(scope);
  React.useEffect(() => {
    scopeRef.current = scope;
  }, [scope]);

  const patch = React.useCallback((key: string, update: Partial<ComposeAttachment>) => {
    setItems((prev) => prev.map((item) => (item.key === key ? { ...item, ...update } : item)));
  }, []);

  const ingestText = React.useCallback(
    async (key: string, fileName: string, text: string, byteSize: number, charCount: number) => {
      const current = scopeRef.current;
      const ingest = backend.ingestAttachment;
      if (!current?.sessionId || !ingest) {
        patch(key, {
          status: 'pending',
          pending: { kind: 'text', fileName, text },
          byteSize,
          charCount,
        });
        return;
      }
      try {
        const dto = await ingest(current.workspaceId, current.projectId, current.sessionId, {
          fileName,
          text,
        });
        patch(key, {
          status: 'ready',
          meta: messageAttachmentOf(dto),
          byteSize: dto.byteSize,
          charCount: dto.extractedChars,
        });
      } catch (error) {
        patch(key, { status: 'error', errorCode: attachmentErrorCode(error) });
      }
    },
    [backend, patch],
  );

  const ingestPath = React.useCallback(
    async (key: string, filePath: string) => {
      const current = scopeRef.current;
      const ingest = backend.ingestAttachmentPath;
      if (!current?.sessionId || !ingest) {
        patch(key, { status: 'pending', pending: { kind: 'path', filePath } });
        return;
      }
      try {
        const dto = await ingest(current.workspaceId, current.projectId, current.sessionId, {
          filePath,
        });
        patch(key, {
          status: 'ready',
          meta: messageAttachmentOf(dto),
          byteSize: dto.byteSize,
          charCount: dto.extractedChars,
        });
      } catch (error) {
        patch(key, { status: 'error', errorCode: attachmentErrorCode(error) });
      }
    },
    [backend, patch],
  );

  const addFiles = React.useCallback(
    (files: File[]) => {
      for (const file of files) {
        const key = nextKey();
        setItems((prev) => [
          ...prev,
          { key, fileName: file.name, byteSize: file.size, status: 'reading' },
        ]);
        void (async () => {
          try {
            const { text, byteSize } = await readFileText(file);
            await ingestText(key, file.name, text, byteSize, text.length);
          } catch (error) {
            patch(key, { status: 'error', errorCode: attachmentErrorCode(error) });
          }
        })();
      }
    },
    [ingestText, patch],
  );

  const addPaths = React.useCallback(
    (paths: string[]) => {
      for (const path of paths) {
        const key = nextKey();
        setItems((prev) => [...prev, { key, fileName: fileNameFromPath(path), status: 'reading' }]);
        void ingestPath(key, path);
      }
    },
    [ingestPath],
  );

  const remove = React.useCallback((key: string) => {
    setItems((prev) => prev.filter((item) => item.key !== key));
  }, []);

  /** Clears only the selections a send actually carried: files added while that
   *  dispatch was in flight stay in the composer for the next turn. */
  const clear = React.useCallback((keys: readonly string[]) => {
    setItems((prev) => prev.filter((item) => !keys.includes(item.key)));
  }, []);

  // A session switch drops the previous session's selections. The null →
  // session transition is the lazy first-send creation: those files ride into
  // the session this send materializes.
  const scopeKey = scope
    ? `${scope.workspaceId}\u0000${scope.projectId}\u0000${scope.sessionId ?? ''}`
    : null;
  const lastScopeRef = React.useRef(scopeKey);
  React.useEffect(() => {
    const prev = lastScopeRef.current;
    lastScopeRef.current = scopeKey;
    if (prev === null || scopeKey === null || prev === scopeKey) return;
    const [pw, pp, ps] = prev.split('\u0000');
    const [nw, np, ns] = scopeKey.split('\u0000');
    const carried = pw === nw && pp === np && !ps && Boolean(ns);
    if (!carried) setItems([]);
  }, [scopeKey]);

  const readyIds = items
    .filter((item) => item.status === 'ready' && item.meta)
    .map((item) => item.meta!.attachmentId);
  const pendingFiles = items.flatMap((item) =>
    item.status === 'pending' && item.pending ? [item.pending] : [],
  );

  return {
    items,
    addFiles,
    addPaths,
    remove,
    clear,
    readyIds,
    pendingFiles,
    isReading: items.some((item) => item.status === 'reading'),
    hasErrors: items.some((item) => item.status === 'error'),
  };
}
