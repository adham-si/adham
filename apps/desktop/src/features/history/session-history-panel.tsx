import * as React from 'react';
import { useTranslation } from 'react-i18next';
import { AdhamIcon } from '@adham/ui';
import type { SessionSearchResult } from '@adham/contracts-generated';
import type { SessionSummary } from '@/widgets/shell/primary-sidebar/primary-sidebar';
import { SessionRow } from './session-row';
import {
  EMPTY_SEARCH_FILTERS,
  hasActiveSearchFilter,
  useSessionSearch,
  type SessionSearchBackend,
  type SessionSearchFilters,
} from './use-session-search';

export interface SessionHistoryPanelProps {
  workspaceId: string | null;
  projectId: string | null;
  sessions: SessionSummary[];
  activeSessionId?: string | null;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  truncated?: boolean;
  unreadableSummaries?: number;
  includeArchived: boolean;
  onIncludeArchivedChange: (includeArchived: boolean) => void;
  onSelectSession: (sessionId: string) => void;
  onRenameSession?: ((session: SessionSummary) => void) | undefined;
  onDuplicateSession?: ((session: SessionSummary) => void) | undefined;
  onExportSession?: ((session: SessionSummary) => void) | undefined;
  onDeleteSession?: ((session: SessionSummary) => void) | undefined;
  onSetPinned?: ((sessionId: string, pinned: boolean) => void) | undefined;
  onSetArchived?: ((sessionId: string, archived: boolean) => void) | undefined;
  actionsDisabled?: boolean;
  actionsError?: string | null;
  /** Bump after a mutation so an active search refetches. */
  refreshToken?: number;
  backend?: SessionSearchBackend;
}

function dateOnly(value: string | null): string {
  return value ? value.slice(0, 10) : '';
}

function startOfDay(value: string): string | null {
  return value ? `${value}T00:00:00Z` : null;
}

function endOfDay(value: string): string | null {
  return value ? `${value}T23:59:59Z` : null;
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

export function SessionHistoryPanel({
  workspaceId,
  projectId,
  sessions,
  activeSessionId = null,
  loading = false,
  error = null,
  onRetry,
  truncated = false,
  unreadableSummaries = 0,
  includeArchived,
  onIncludeArchivedChange,
  onSelectSession,
  onRenameSession,
  onDuplicateSession,
  onExportSession,
  onDeleteSession,
  onSetPinned,
  onSetArchived,
  actionsDisabled = false,
  actionsError = null,
  refreshToken = 0,
  backend,
}: SessionHistoryPanelProps) {
  const { t } = useTranslation();
  const [query, setQuery] = React.useState('');
  const [showFilters, setShowFilters] = React.useState(false);
  const [filters, setFilters] = React.useState<SessionSearchFilters>(() => ({
    ...EMPTY_SEARCH_FILTERS,
    includeArchived,
  }));

  React.useEffect(() => {
    setFilters((current) =>
      current.includeArchived === includeArchived ? current : { ...current, includeArchived },
    );
  }, [includeArchived]);

  React.useEffect(() => {
    if (query.trim() === '' && filters.role !== null) {
      setFilters((current) => ({ ...current, role: null }));
    }
  }, [filters.role, query]);

  const trimmed = query.trim();
  const activeFilter = hasActiveSearchFilter(filters);
  const searchMode = trimmed.length > 0 || activeFilter;
  const shortQuery = trimmed.length > 0 && trimmed.length < 2;
  const searchReady = trimmed.length >= 2 || (trimmed.length === 0 && activeFilter);
  const search = useSessionSearch({
    ...(backend ? { backend } : {}),
    workspaceId,
    projectId,
    query: searchReady ? query : '',
    filters,
  });

  React.useEffect(() => {
    if (refreshToken > 0) search.retry();
  }, [refreshToken, search.retry]);

  const knownSessions = React.useMemo(
    () => new Map(sessions.map((session) => [session.id, session])),
    [sessions],
  );

  const selectResult = React.useCallback(
    (result: SessionSearchResult) => {
      onSelectSession(result.sessionId);
      if (result.messageId && workspaceId && projectId) {
        window.dispatchEvent(
          new CustomEvent('adham:session-focus-message', {
            detail: {
              workspaceId,
              projectId,
              sessionId: result.sessionId,
              messageId: result.messageId,
            },
          }),
        );
      }
    },
    [onSelectSession, projectId, workspaceId],
  );

  const updateFilter = <K extends keyof SessionSearchFilters>(
    key: K,
    value: SessionSearchFilters[K],
  ) => setFilters((current) => ({ ...current, [key]: value }));

  return (
    <div data-testid="session-history-panel" className="flex min-h-0 flex-1 flex-col">
      <div className="border-b border-border-subtle px-3 py-2">
        <div className="flex items-center gap-1.5 rounded-md bg-surface-subtle px-2 py-1 text-xs text-foreground-secondary">
          <AdhamIcon size="sm" label={t('rail.search', 'Search')}>
            <path d="M21 21l-4.35-4.35" />
            <circle cx="11" cy="11" r="7" />
          </AdhamIcon>
          <input
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t(
              'conversation.historySearch.placeholder',
              'Search sessions and messages',
            )}
            aria-label={t('conversation.historySearch.placeholder', 'Search sessions and messages')}
            className="w-full bg-transparent text-xs text-foreground placeholder:text-foreground-muted focus:outline-none"
          />
        </div>
        <div className="mt-1.5 flex items-center justify-between gap-2">
          <button
            type="button"
            aria-label={t('conversation.historySearch.filters', 'Filters')}
            title={t('conversation.historySearch.filters', 'Filters')}
            aria-expanded={showFilters}
            aria-controls="session-history-filters"
            onClick={() => setShowFilters((current) => !current)}
            className={`relative flex size-7 items-center justify-center rounded-md border transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-action ${
              showFilters
                ? 'border-focus bg-selection text-action'
                : 'border-border-subtle bg-surface text-foreground-muted hover:bg-surface-hover hover:text-foreground'
            }`}
          >
            <AdhamIcon size="sm">
              <path d="M4 5h16l-6 7v5l-4 2v-7z" />
            </AdhamIcon>
            {activeFilter ? (
              <span
                aria-hidden="true"
                className="absolute end-1 top-1 size-1.5 rounded-full bg-action"
              />
            ) : null}
          </button>
          {search.loading ? (
            <span role="status" className="text-[11px] text-foreground-muted">
              {t('conversation.historySearch.searching', 'Searching…')}
            </span>
          ) : null}
        </div>
        {showFilters ? (
          <div
            id="session-history-filters"
            role="group"
            aria-label={t('conversation.historySearch.filters', 'Filters')}
            className="mt-2 grid grid-cols-2 gap-x-2 gap-y-1.5 text-[11px] text-foreground-secondary"
          >
            <label className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={includeArchived}
                onChange={(event) => onIncludeArchivedChange(event.target.checked)}
              />
              {t('conversation.historySearch.showArchived', 'Show archived')}
            </label>
            <label className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={filters.pinnedOnly}
                onChange={(event) => updateFilter('pinnedOnly', event.target.checked)}
              />
              {t('conversation.historySearch.pinnedOnly', 'Pinned only')}
            </label>
            <label className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={filters.bookmarkedOnly}
                onChange={(event) => updateFilter('bookmarkedOnly', event.target.checked)}
              />
              {t('conversation.historySearch.bookmarkedOnly', 'Bookmarked only')}
            </label>
            <label className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={filters.hasAttachments}
                onChange={(event) => updateFilter('hasAttachments', event.target.checked)}
              />
              {t('conversation.historySearch.hasAttachments', 'Has attachments')}
            </label>
            <label className="col-span-2 flex items-center justify-between gap-2">
              <span>{t('conversation.historySearch.role', 'Role')}</span>
              <select
                value={filters.role ?? ''}
                disabled={trimmed.length === 0}
                onChange={(event) =>
                  updateFilter(
                    'role',
                    event.target.value === 'user' || event.target.value === 'assistant'
                      ? event.target.value
                      : null,
                  )
                }
                aria-label={t('conversation.historySearch.role', 'Role')}
                className="rounded border border-border-subtle bg-surface px-1.5 py-0.5 text-[11px] disabled:opacity-50"
              >
                <option value="">{t('conversation.historySearch.anyRole', 'Any role')}</option>
                <option value="user">{t('conversation.historySearch.user', 'User')}</option>
                <option value="assistant">
                  {t('conversation.historySearch.assistant', 'Assistant')}
                </option>
              </select>
            </label>
            <label className="flex flex-col gap-0.5">
              <span>{t('conversation.historySearch.from', 'From')}</span>
              <input
                type="date"
                value={dateOnly(filters.from)}
                onChange={(event) => updateFilter('from', startOfDay(event.target.value))}
                className="rounded border border-border-subtle bg-surface px-1.5 py-0.5 text-[11px]"
              />
            </label>
            <label className="flex flex-col gap-0.5">
              <span>{t('conversation.historySearch.to', 'To')}</span>
              <input
                type="date"
                value={dateOnly(filters.to)}
                onChange={(event) => updateFilter('to', endOfDay(event.target.value))}
                className="rounded border border-border-subtle bg-surface px-1.5 py-0.5 text-[11px]"
              />
            </label>
            <p className="col-span-2 pt-1 text-[10px] leading-snug text-foreground-muted">
              {t(
                'conversation.historySearch.unavailableFilters',
                'Not available yet: agents, participants, task status, model/provider, tags/folders, cost, and artifacts. Their data does not exist yet.',
              )}
            </p>
          </div>
        ) : null}
      </div>

      <div className="flex-1 overflow-y-auto p-2" aria-live="polite">
        {searchMode ? (
          <SearchResults
            query={query}
            shortQuery={shortQuery}
            loading={search.loading}
            error={search.error}
            results={search.results}
            truncated={search.truncated}
            scanLimitReached={search.scanLimitReached}
            skippedUnreadable={search.skippedUnreadable}
            knownSessions={knownSessions}
            activeSessionId={activeSessionId}
            onRetry={search.retry}
            onSelect={selectResult}
            onRenameSession={onRenameSession}
            onDuplicateSession={onDuplicateSession}
            onExportSession={onExportSession}
            onDeleteSession={onDeleteSession}
            onSetPinned={onSetPinned}
            onSetArchived={onSetArchived}
            actionsDisabled={actionsDisabled}
          />
        ) : (
          <SessionList
            sessions={sessions}
            activeSessionId={activeSessionId}
            loading={loading}
            error={error}
            onRetry={onRetry}
            truncated={truncated}
            unreadableSummaries={unreadableSummaries}
            onSelectSession={onSelectSession}
            onRenameSession={onRenameSession}
            onDuplicateSession={onDuplicateSession}
            onExportSession={onExportSession}
            onDeleteSession={onDeleteSession}
            onSetPinned={onSetPinned}
            onSetArchived={onSetArchived}
            actionsDisabled={actionsDisabled}
          />
        )}
        {actionsError ? (
          <div role="alert" className="px-2 py-1 text-[11px] text-danger-foreground">
            {actionsError}
          </div>
        ) : null}
      </div>
    </div>
  );
}

interface SessionListProps {
  sessions: SessionSummary[];
  activeSessionId: string | null;
  loading: boolean;
  error: string | null;
  onRetry?: (() => void) | undefined;
  truncated: boolean;
  unreadableSummaries: number;
  onSelectSession: (sessionId: string) => void;
  onRenameSession?: ((session: SessionSummary) => void) | undefined;
  onDuplicateSession?: ((session: SessionSummary) => void) | undefined;
  onExportSession?: ((session: SessionSummary) => void) | undefined;
  onDeleteSession?: ((session: SessionSummary) => void) | undefined;
  onSetPinned?: ((sessionId: string, pinned: boolean) => void) | undefined;
  onSetArchived?: ((sessionId: string, archived: boolean) => void) | undefined;
  actionsDisabled: boolean;
}

function SessionList({
  sessions,
  activeSessionId,
  loading,
  error,
  onRetry,
  truncated,
  unreadableSummaries,
  onSelectSession,
  onRenameSession,
  onDuplicateSession,
  onExportSession,
  onDeleteSession,
  onSetPinned,
  onSetArchived,
  actionsDisabled,
}: SessionListProps) {
  const { t } = useTranslation();
  if (error) {
    return (
      <div
        role="alert"
        className="m-2 flex flex-col gap-2 rounded-md border border-status-danger/30 bg-status-danger/10 p-2.5 text-xs text-status-danger"
      >
        <span>{error}</span>
        {onRetry ? (
          <button
            type="button"
            onClick={onRetry}
            className="self-start font-medium underline hover:opacity-80"
          >
            {t('common.retry', 'Retry')}
          </button>
        ) : null}
      </div>
    );
  }
  if (loading && sessions.length === 0) {
    return (
      <div role="status" className="px-2 py-4 text-center text-xs text-foreground-muted">
        {t('conversation.historySearch.loadingSessions', 'Loading sessions…')}
      </div>
    );
  }
  if (sessions.length === 0) {
    return (
      <div className="px-2 py-4 text-center text-xs text-foreground-muted">
        {t('compose.emptyHistory', 'No sessions yet')}
      </div>
    );
  }
  return (
    <nav aria-label={t('sessions', 'Sessions')} className="flex flex-col gap-1">
      {unreadableSummaries > 0 ? (
        <div className="px-2 pb-1 text-[11px] text-foreground-muted">
          {t('sidebar.summariesUnavailable', 'Some summaries could not be read.')}
        </div>
      ) : null}
      {sessions.map((session) => (
        <SessionRow
          key={session.id}
          session={session}
          active={activeSessionId === session.id}
          onSelect={onSelectSession}
          onRenameSession={onRenameSession}
          onDuplicateSession={onDuplicateSession}
          onExportSession={onExportSession}
          onDeleteSession={onDeleteSession}
          onSetPinned={onSetPinned}
          onSetArchived={onSetArchived}
          actionsDisabled={actionsDisabled}
        />
      ))}
      {truncated ? (
        <div className="px-2 py-1 text-[11px] italic text-foreground-muted">
          {t('sidebar.sessionsTruncated', 'Showing latest 100 sessions (truncated)')}
        </div>
      ) : null}
    </nav>
  );
}

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

function SearchResults({
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
