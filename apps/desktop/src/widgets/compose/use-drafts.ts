import * as React from 'react';

const DRAFT_PREFIX = 'adham:compose:draft:';
const HISTORY_PREFIX = 'adham:compose:history:';
const PENDING_BUCKET = 'pending';
const HISTORY_CAP = 50;

function readDraftBucket(sessionId: string): string {
  try {
    return localStorage.getItem(`${DRAFT_PREFIX}${sessionId}`) || '';
  } catch {
    return '';
  }
}

function readHistoryBucket(sessionId: string): string[] {
  try {
    const stored = localStorage.getItem(`${HISTORY_PREFIX}${sessionId}`);
    const parsed: unknown = stored ? JSON.parse(stored) : [];
    return Array.isArray(parsed) ? parsed.filter((p): p is string => typeof p === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * Carry pre-bootstrap draft text into the resolved session bucket. The
 * pending (newest) edit wins the session bucket; a distinct target draft
 * is preserved in the session's recallable history instead of being
 * silently dropped. Pending content is removed only once it has been
 * adopted. Never runs for the pending bucket itself.
 */
export function migratePendingDraft(nextSessionId: string): void {
  if (nextSessionId === PENDING_BUCKET) return;
  try {
    const pendingKey = `${DRAFT_PREFIX}${PENDING_BUCKET}`;
    const targetKey = `${DRAFT_PREFIX}${nextSessionId}`;
    const pending = localStorage.getItem(pendingKey);
    if (!pending) return;
    const target = localStorage.getItem(targetKey);
    if (target && target !== pending) {
      // Conflict: both drafts are distinct user text. The live pending
      // edit takes the session bucket; the displaced target draft is
      // preserved in recallable history rather than lost.
      const historyKey = `${HISTORY_PREFIX}${nextSessionId}`;
      const stored = localStorage.getItem(historyKey);
      let history: string[] = [];
      try {
        const parsed: unknown = stored ? JSON.parse(stored) : [];
        history = Array.isArray(parsed)
          ? parsed.filter((p): p is string => typeof p === 'string')
          : [];
      } catch {
        history = [];
      }
      if (!history.includes(target)) {
        localStorage.setItem(
          historyKey,
          JSON.stringify([target, ...history].slice(0, HISTORY_CAP)),
        );
      }
    }
    if (!target || target !== pending) {
      localStorage.setItem(targetKey, pending);
    }
    localStorage.removeItem(pendingKey);
  } catch {
    // ignore: migration is best-effort, in-memory text is unaffected
  }
}

export interface UseDraftsOptions {
  sessionId?: string;
  maxHistory?: number;
}

export function useDrafts({ sessionId = 'default', maxHistory = 50 }: UseDraftsOptions = {}) {
  const [draft, setDraftState] = React.useState<string>(() => readDraftBucket(sessionId));

  const [history, setHistory] = React.useState<string[]>(() => readHistoryBucket(sessionId));

  const [historyIndex, setHistoryIndex] = React.useState<number>(-1);

  // Draft/history ownership tracks the real session: hydrate both buckets
  // whenever the session key changes, after migrating any pending
  // pre-bootstrap text. Without this, a remount that resolves a cached
  // session would leave the textarea on the stale bucket and a switch
  // would carry the previous session's text and history in memory.
  const prevSessionRef = React.useRef(sessionId);
  React.useEffect(() => {
    if (prevSessionRef.current === sessionId) return;
    prevSessionRef.current = sessionId;
    migratePendingDraft(sessionId);
    setDraftState(readDraftBucket(sessionId));
    setHistory(readHistoryBucket(sessionId));
    setHistoryIndex(-1);
  }, [sessionId]);

  // Synchronize draft to storage
  const setDraft = React.useCallback(
    (text: string) => {
      setDraftState(text);
      setHistoryIndex(-1);
      try {
        if (text) {
          localStorage.setItem(`${DRAFT_PREFIX}${sessionId}`, text);
        } else {
          localStorage.removeItem(`${DRAFT_PREFIX}${sessionId}`);
        }
      } catch {
        // ignore
      }
    },
    [sessionId],
  );

  // Commit prompt to history on submit and clear draft
  const commitPrompt = React.useCallback(
    (prompt: string) => {
      const trimmed = prompt.trim();
      if (!trimmed) return;

      setHistory((prev) => {
        const next = [trimmed, ...prev.filter((p) => p !== trimmed)].slice(0, maxHistory);
        try {
          localStorage.setItem(`${HISTORY_PREFIX}${sessionId}`, JSON.stringify(next));
          localStorage.removeItem(`${DRAFT_PREFIX}${sessionId}`);
        } catch {
          // ignore
        }
        return next;
      });

      setDraftState('');
      setHistoryIndex(-1);
    },
    [sessionId, maxHistory],
  );

  // Recall previous prompt with Up Arrow
  const recallPrevious = React.useCallback((): string | null => {
    if (history.length === 0) return null;
    const nextIndex = Math.min(historyIndex + 1, history.length - 1);
    setHistoryIndex(nextIndex);
    const recalled = history[nextIndex] ?? null;
    if (recalled !== null) {
      setDraftState(recalled);
    }
    return recalled;
  }, [history, historyIndex]);

  // Recall next prompt with Down Arrow
  const recallNext = React.useCallback((): string | null => {
    if (historyIndex <= 0) {
      setHistoryIndex(-1);
      return null;
    }
    const nextIndex = historyIndex - 1;
    setHistoryIndex(nextIndex);
    const recalled = history[nextIndex] ?? null;
    if (recalled !== null) {
      setDraftState(recalled);
    }
    return recalled;
  }, [history, historyIndex]);

  return {
    draft,
    setDraft,
    history,
    historyIndex,
    commitPrompt,
    recallPrevious,
    recallNext,
  };
}
