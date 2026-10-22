import * as React from 'react';
import type {
  SessionSearchRequest,
  SessionSearchResponse,
  SessionSearchResult,
} from '@adham/contracts-generated';
import { adhamClient } from '@/shared/api/adham-client';
import { rejectionMessage } from '@/shared/api/error-envelope';

export type SearchRole = 'user' | 'assistant';

export interface SessionSearchFilters {
  includeArchived: boolean;
  pinnedOnly: boolean;
  bookmarkedOnly: boolean;
  role: SearchRole | null;
  hasAttachments: boolean;
  from: string | null;
  to: string | null;
}

export const EMPTY_SEARCH_FILTERS: SessionSearchFilters = {
  includeArchived: false,
  pinnedOnly: false,
  bookmarkedOnly: false,
  role: null,
  hasAttachments: false,
  from: null,
  to: null,
};

export interface SessionSearchBackend {
  searchHistory(
    workspaceId: string,
    projectId: string,
    request: SessionSearchRequest,
  ): Promise<SessionSearchResponse>;
}

export interface UseSessionSearchOptions {
  backend?: SessionSearchBackend;
  workspaceId: string | null;
  projectId: string | null;
  query: string;
  filters: SessionSearchFilters;
}

export interface UseSessionSearchResult {
  results: SessionSearchResult[];
  loading: boolean;
  error: string | null;
  truncated: boolean;
  scanLimitReached: boolean;
  skippedUnreadable: number;
  retry: () => void;
}

/** True when a filter other than "show archived" is active. */
export function hasActiveSearchFilter(filters: SessionSearchFilters): boolean {
  return (
    filters.pinnedOnly ||
    filters.bookmarkedOnly ||
    filters.hasAttachments ||
    filters.role !== null ||
    filters.from !== null ||
    filters.to !== null
  );
}

/**
 * Debounced, sequence-guarded backend search. No plaintext is cached here;
 * results are replaced only by the latest response.
 */
export function useSessionSearch({
  backend = adhamClient,
  workspaceId,
  projectId,
  query,
  filters,
}: UseSessionSearchOptions): UseSessionSearchResult {
  const [results, setResults] = React.useState<SessionSearchResult[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [truncated, setTruncated] = React.useState(false);
  const [scanLimitReached, setScanLimitReached] = React.useState(false);
  const [skippedUnreadable, setSkippedUnreadable] = React.useState(0);
  const [retryToken, setRetryToken] = React.useState(0);
  const sequenceRef = React.useRef(0);

  const trimmed = query.trim();

  React.useEffect(() => {
    const sequence = sequenceRef.current + 1;
    sequenceRef.current = sequence;
    const activeFilter = hasActiveSearchFilter(filters);
    const workspace = workspaceId;
    const project = projectId;
    const shouldSearch =
      Boolean(workspace && project) &&
      (trimmed.length >= 2 || (trimmed.length === 0 && activeFilter));

    if (!shouldSearch || !workspace || !project) {
      setResults([]);
      setLoading(false);
      setError(null);
      setTruncated(false);
      setScanLimitReached(false);
      setSkippedUnreadable(0);
      return;
    }

    setLoading(true);
    setError(null);
    const timer = window.setTimeout(() => {
      const request: SessionSearchRequest = {
        query: trimmed,
        filters: {
          includeArchived: filters.includeArchived,
          pinnedOnly: filters.pinnedOnly,
          bookmarkedOnly: filters.bookmarkedOnly,
          role: filters.role,
          hasAttachments: filters.hasAttachments,
          from: filters.from,
          to: filters.to,
        },
      };
      void backend
        .searchHistory(workspace, project, request)
        .then((response) => {
          if (sequenceRef.current !== sequence) return;
          setResults(response.results);
          setTruncated(response.truncated);
          setScanLimitReached(response.scanLimitReached);
          setSkippedUnreadable(response.skippedUnreadable);
        })
        .catch((err: unknown) => {
          if (sequenceRef.current !== sequence) return;
          setResults([]);
          setTruncated(false);
          setScanLimitReached(false);
          setSkippedUnreadable(0);
          setError(rejectionMessage(err));
        })
        .finally(() => {
          if (sequenceRef.current === sequence) setLoading(false);
        });
    }, 250);

    return () => window.clearTimeout(timer);
  }, [
    backend,
    filters.includeArchived,
    filters.pinnedOnly,
    filters.bookmarkedOnly,
    filters.role,
    filters.hasAttachments,
    filters.from,
    filters.to,
    projectId,
    retryToken,
    trimmed,
    workspaceId,
  ]);

  const retry = React.useCallback(() => setRetryToken((token) => token + 1), []);
  return { results, loading, error, truncated, scanLimitReached, skippedUnreadable, retry };
}
