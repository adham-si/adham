import type { SessionSearchResult } from '@adham/contracts-generated';
import { useTranslation } from 'react-i18next';
import type { SessionSummary } from '@/widgets/shell/primary-sidebar/primary-sidebar';
import { SessionRow } from './session-row';

interface SearchResultsProps {
  query: string;
  shortQuery: boolean;
  loading: boolean;
  error: string | null;
  results: SessionSearchResult[];
  truncated: boolean;
  scanLimitReached: boolean;
  skippedUnreadable: number;
  knownSessions: Map<string, SessionSummary>;
  activeSessionId: string | null;
  onRetry: () => void;
  onSelect: (result: SessionSearchResult) => void;
  onRenameSession?: ((session: SessionSummary) => void) | undefined;
  onDuplicateSession?: ((session: SessionSummary) => void) | undefined;
  onExportSession?: ((session: SessionSummary) => void) | undefined;
  onDeleteSession?: ((session: SessionSummary) => void) | undefined;
  onSetPinned?: ((sessionId: string, pinned: boolean) => void) | undefined;
  onSetArchived?: ((sessionId: string, archived: boolean) => void) | undefined;
  actionsDisabled: boolean;
}

function sessionFromResult(result: SessionSearchResult): SessionSummary {
  return {
    id: result.sessionId,
    title: result.title || `Session ${result.sessionId.slice(0, 8)}`,
    updatedAt: result.lastActivityAt,
    ...(result.summary ? { summary: result.summary } : {}),
    ...(result.summaryOrigin ? { summaryOrigin: result.summaryOrigin } : {}),
  };
}

function matchLabel(
  result: SessionSearchResult,
  t: (key: string, fallback: string) => string,
): string {
  if (result.matchKind === 'attachment') {
    return result.snippet
      ? t('conversation.historySearch.match.attachmentText', 'Attachment text')
      : t('conversation.historySearch.match.attachmentFileName', 'Attachment file name');
  }
  switch (result.matchKind) {
    case 'title':
      return t('conversation.historySearch.match.title', 'Title');
    case 'summary':
      return t('conversation.historySearch.match.summary', 'Summary');
    case 'message':
      return t('conversation.historySearch.match.message', 'Message');
    case 'bookmark':
      return t('conversation.historySearch.match.bookmark', 'Bookmark');
    default:
      return t('conversation.historySearch.match.session', 'Session');
  }
}

export function SearchResults({
  query,
  shortQuery,
  loading,
  error,
  results,
  truncated,
  scanLimitReached,
  skippedUnreadable,
  knownSessions,
  activeSessionId,
  onRetry,
  onSelect,
  onRenameSession,
  onDuplicateSession,
  onExportSession,
  onDeleteSession,
  onSetPinned,
  onSetArchived,
  actionsDisabled,
}: SearchResultsProps) {
  const { t } = useTranslation();
  if (shortQuery) {
    return (
      <div className="px-2 py-4 text-center text-xs text-foreground-muted">
        {t('conversation.historySearch.shortQuery', 'Type at least 2 characters.')}
      </div>
    );
  }
  if (error) {
    return (
      <div
        role="alert"
        className="m-2 flex flex-col gap-2 rounded-md border border-status-danger/30 bg-status-danger/10 p-2.5 text-xs text-status-danger"
      >
        <span>{error}</span>
        <button
          type="button"
          onClick={onRetry}
          className="self-start font-medium underline hover:opacity-80"
        >
          {t('common.retry', 'Retry')}
        </button>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-1">
      {skippedUnreadable > 0 ? (
        <div className="px-2 pb-1 text-[11px] text-foreground-muted">
          {t(
            'conversation.historySearch.skippedUnreadable',
            'Some saved content could not be read and was skipped.',
          )}
        </div>
      ) : null}
      {scanLimitReached ? (
        <div className="px-2 pb-1 text-[11px] text-foreground-muted">
          {t(
            'conversation.historySearch.scanLimit',
            'Search stopped after scanning 10,000 messages.',
          )}
        </div>
      ) : null}
      {loading && results.length === 0 ? (
        <div role="status" className="px-2 py-4 text-center text-xs text-foreground-muted">
          {t('conversation.historySearch.searching', 'Searching…')}
        </div>
      ) : null}
      {!loading && results.length === 0 ? (
        <div className="px-2 py-4 text-center text-xs text-foreground-muted">
          {t('conversation.historySearch.noResults', 'No matching sessions or messages.')}
        </div>
      ) : null}
      <nav aria-label={t('conversation.historySearch.results', 'Search results')}>
        {results.map((result, index) => {
          const session = knownSessions.get(result.sessionId) ?? sessionFromResult(result);
          return (
            <SessionRow
              key={`${result.matchKind}:${result.messageId ?? 'session'}:${index}`}
              session={session}
              active={activeSessionId === result.sessionId}
              onSelect={() => onSelect(result)}
              matchLabel={matchLabel(result, t)}
              snippet={result.snippet ?? undefined}
              attachmentName={result.attachmentName ?? undefined}
              onRenameSession={onRenameSession}
              onDuplicateSession={onDuplicateSession}
              onExportSession={onExportSession}
              onDeleteSession={onDeleteSession}
              onSetPinned={onSetPinned}
              onSetArchived={onSetArchived}
              actionsDisabled={actionsDisabled}
            />
          );
        })}
      </nav>
      {truncated ? (
        <div className="px-2 py-1 text-[11px] italic text-foreground-muted">
          {t(
            'conversation.historySearch.resultsTruncated',
            'Showing the first 50 results (truncated).',
          )}
        </div>
      ) : null}
      {query.trim() === '' ? (
        <div className="px-2 py-1 text-[11px] italic text-foreground-muted">
          {t(
            'conversation.historySearch.filterOnly',
            'Filter-only view. Type a query to search message text.',
          )}
        </div>
      ) : null}
    </div>
  );
}
