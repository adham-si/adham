import * as React from 'react';
import i18n from '@/shared/i18n';
import {
  type AnswerFeedback,
  type BranchSelection,
  type ConversationBackend,
  type ConversationContext,
  type SubmitOutcome,
} from './conversation-scope';

/** Session-scoped user actions that rewrite only local selection state:
 * picking the active member of an edited branch (line 65) and rating an
 * answer row (line 66). Both are server-validated against the session's
 * persisted rows, and neither ever touches the provider. */
export type ActionsDeps = {
  backend: ConversationBackend;
  context: ConversationContext | null;
  isStale: (gen: number, load: number, mut: number, sessId?: string) => boolean;
  generationRef: React.RefObject<number>;
  loadSeqRef: React.RefObject<number>;
  mutationSeqRef: React.RefObject<number>;
  setBranchSelections: React.Dispatch<React.SetStateAction<BranchSelection[]>>;
  setAnswerFeedbackRows: React.Dispatch<React.SetStateAction<AnswerFeedback[]>>;
  setBookmarkedMessageIds: React.Dispatch<React.SetStateAction<string[]>>;
};

export function useConversationActions(deps: ActionsDeps) {
  const {
    backend,
    context,
    isStale,
    generationRef,
    loadSeqRef,
    mutationSeqRef,
    setBranchSelections,
    setAnswerFeedbackRows,
    setBookmarkedMessageIds,
  } = deps;

  /** Switch which member of an edited branch the session continues from.
   *  Server-validated; the response is the session's selections after the
   *  write. A failure is surfaced as an error state, never a silent no-op. */
  const makeAlternativeActive = React.useCallback(
    async (rootMessageId: string, activeMessageId: string): Promise<SubmitOutcome> => {
      const ctx = context;
      if (!ctx?.sessionId) {
        return { ok: false, error: i18n.t('conversation.notReady'), uncertain: false };
      }
      const generation = generationRef.current;
      const loadSeq = loadSeqRef.current;
      const mutationSeq = mutationSeqRef.current;
      try {
        const selections = await backend.setActiveAlternative(
          ctx.workspaceId,
          ctx.projectId,
          ctx.sessionId,
          rootMessageId,
          activeMessageId,
        );
        // A stale response belongs to a session the user already left: it was
        // applied server-side, but must not overwrite the new session's map.
        if (isStale(generation, loadSeq, mutationSeq, ctx.sessionId)) return { ok: true };
        setBranchSelections(selections);
        return { ok: true };
      } catch (err) {
        if (isStale(generation, loadSeq, mutationSeq, ctx.sessionId)) return { ok: true };
        const message =
          err instanceof Error ? err.message : i18n.t('conversation.alternativeUpdateFailed');
        return { ok: false, error: message, uncertain: false };
      }
    },
    [backend, context, generationRef, isStale, loadSeqRef, mutationSeqRef, setBranchSelections],
  );

  /** Record, switch, or remove (verdict null) the local verdict for one
   *  answer row. Server-validated; the response is the session's feedback
   *  after the write. A failure is surfaced to the caller, never a silent
   *  no-op and never a flipped chip. */
  const setAnswerFeedback = React.useCallback(
    async (
      messageId: string,
      verdict: 'like' | 'dislike' | null,
      reason: string | null,
    ): Promise<SubmitOutcome> => {
      const ctx = context;
      if (!ctx?.sessionId) {
        return { ok: false, error: i18n.t('conversation.notReady'), uncertain: false };
      }
      const generation = generationRef.current;
      const loadSeq = loadSeqRef.current;
      const mutationSeq = mutationSeqRef.current;
      try {
        const feedback = await backend.setAnswerFeedback(
          ctx.workspaceId,
          ctx.projectId,
          ctx.sessionId,
          messageId,
          verdict,
          reason,
        );
        // A stale response belongs to a session the user already left: it was
        // applied server-side, but must not overwrite the new session's map.
        if (isStale(generation, loadSeq, mutationSeq, ctx.sessionId)) return { ok: true };
        setAnswerFeedbackRows(feedback);
        return { ok: true };
      } catch (err) {
        if (isStale(generation, loadSeq, mutationSeq, ctx.sessionId)) return { ok: true };
        const message =
          err instanceof Error ? err.message : i18n.t('conversation.feedbackUpdateFailed');
        return { ok: false, error: message, uncertain: false };
      }
    },
    [backend, context, generationRef, isStale, loadSeqRef, mutationSeqRef, setAnswerFeedbackRows],
  );

  /** Toggle one persisted message bookmark. The response is the session's
   *  ids after the write; a refusal never flips the star. */
  const setMessageBookmark = React.useCallback(
    async (messageId: string, bookmarked: boolean): Promise<SubmitOutcome> => {
      const ctx = context;
      if (!ctx?.sessionId || backend.setMessageBookmark === undefined) {
        return { ok: false, error: i18n.t('conversation.bookmarkUnavailable'), uncertain: false };
      }
      const generation = generationRef.current;
      const loadSeq = loadSeqRef.current;
      const mutationSeq = mutationSeqRef.current;
      try {
        const ids = await backend.setMessageBookmark(
          ctx.workspaceId,
          ctx.projectId,
          ctx.sessionId,
          messageId,
          bookmarked,
        );
        if (isStale(generation, loadSeq, mutationSeq, ctx.sessionId)) return { ok: true };
        setBookmarkedMessageIds(ids);
        return { ok: true };
      } catch (err) {
        if (isStale(generation, loadSeq, mutationSeq, ctx.sessionId)) return { ok: true };
        const message =
          err instanceof Error ? err.message : i18n.t('conversation.bookmarkUpdateFailed');
        return { ok: false, error: message, uncertain: false };
      }
    },
    [backend, context, generationRef, isStale, loadSeqRef, mutationSeqRef, setBookmarkedMessageIds],
  );

  return { makeAlternativeActive, setAnswerFeedback, setMessageBookmark };
}
