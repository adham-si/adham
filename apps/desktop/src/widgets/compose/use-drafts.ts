import * as React from 'react';

const DRAFT_PREFIX = 'adham:compose:draft:';
const HISTORY_PREFIX = 'adham:compose:history:';

export interface UseDraftsOptions {
  sessionId?: string;
  maxHistory?: number;
}

export function useDrafts({ sessionId = 'default', maxHistory = 50 }: UseDraftsOptions = {}) {
  const [draft, setDraftState] = React.useState<string>(() => {
    try {
      return localStorage.getItem(`${DRAFT_PREFIX}${sessionId}`) || '';
    } catch {
      return '';
    }
  });

  const [history, setHistory] = React.useState<string[]>(() => {
    try {
      const stored = localStorage.getItem(`${HISTORY_PREFIX}${sessionId}`);
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });

  const [historyIndex, setHistoryIndex] = React.useState<number>(-1);

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
