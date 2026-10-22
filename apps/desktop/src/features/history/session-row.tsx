import * as React from 'react';
import { useTranslation } from 'react-i18next';
import { AdhamIcon, MenuContent, MenuItem, MenuRoot, MenuTrigger, SidebarItem } from '@adham/ui';
import type { SessionSummary } from '@/widgets/shell/primary-sidebar/primary-sidebar';

export interface SessionRowProps {
  session: SessionSummary;
  active: boolean;
  onSelect: (sessionId: string) => void;
  onRenameSession?: ((session: SessionSummary) => void) | undefined;
  onDuplicateSession?: ((session: SessionSummary) => void) | undefined;
  onExportSession?: ((session: SessionSummary) => void) | undefined;
  onDeleteSession?: ((session: SessionSummary) => void) | undefined;
  onSetPinned?: ((sessionId: string, pinned: boolean) => void) | undefined;
  onSetArchived?: ((sessionId: string, archived: boolean) => void) | undefined;
  actionsDisabled?: boolean | undefined;
  /** Search-only context: the field that matched. */
  matchLabel?: string | undefined;
  snippet?: string | undefined;
  attachmentName?: string | undefined;
}

export function SessionRow({
  session,
  active,
  onSelect,
  onRenameSession,
  onDuplicateSession,
  onExportSession,
  onDeleteSession,
  onSetPinned,
  onSetArchived,
  actionsDisabled = false,
  matchLabel,
  snippet,
  attachmentName,
}: SessionRowProps) {
  const { t } = useTranslation();
  const hasActions = Boolean(
    onRenameSession ||
      onDuplicateSession ||
      onExportSession ||
      onDeleteSession ||
      onSetPinned ||
      onSetArchived,
  );
  return (
    <div className="group relative">
      <SidebarItem
        selected={active}
        onClick={() => onSelect(session.id)}
        className="items-start py-2 pe-8"
      >
        <AdhamIcon size="sm" label={session.title}>
          <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
        </AdhamIcon>
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="truncate">{session.title}</span>
            {session.pinned ? (
              <span className="shrink-0 rounded bg-surface-subtle px-1 py-0.5 text-[10px] font-normal text-foreground-muted">
                {t('sidebar.pinned', 'Pinned')}
              </span>
            ) : null}
            {session.archived ? (
              <span className="shrink-0 rounded bg-surface-subtle px-1 py-0.5 text-[10px] font-normal text-foreground-muted">
                {t('sidebar.archived', 'Archived')}
              </span>
            ) : null}
          </span>
          {matchLabel ? (
            <span className="text-[10px] font-medium uppercase tracking-wide text-foreground-muted">
              {matchLabel}
            </span>
          ) : null}
          {attachmentName ? (
            <span className="truncate text-[11px] font-normal text-foreground-muted">
              {attachmentName}
            </span>
          ) : null}
          {(snippet ?? session.summary) ? (
            <span
              dir="auto"
              className="line-clamp-2 text-[11px] font-normal leading-snug text-foreground-muted"
            >
              {snippet ?? session.summary}
            </span>
          ) : null}
        </span>
      </SidebarItem>
      {hasActions ? (
        <MenuRoot>
          <MenuTrigger
            disabled={actionsDisabled}
            aria-label={t('conversation.sessionActions.label', 'Session actions')}
            className="absolute end-1 top-1 rounded px-1.5 py-0.5 text-sm text-foreground-muted opacity-0 hover:bg-surface-hover focus-visible:opacity-100 group-hover:opacity-100"
          >
            <span aria-hidden="true">⋯</span>
          </MenuTrigger>
          <MenuContent
            className="end-0 top-full z-menu mt-1 min-w-40"
            label={t('conversation.sessionActions.label', 'Session actions')}
            onSelect={(value) => {
              if (value === 'rename') onRenameSession?.(session);
              if (value === 'duplicate') onDuplicateSession?.(session);
              if (value === 'export') onExportSession?.(session);
              if (value === 'delete') onDeleteSession?.(session);
              if (value === 'pin') onSetPinned?.(session.id, !session.pinned);
              if (value === 'archive') onSetArchived?.(session.id, !session.archived);
            }}
          >
            {onRenameSession ? (
              <MenuItem value="rename" disabled={actionsDisabled}>
                {t('conversation.sessionActions.rename', 'Rename')}
              </MenuItem>
            ) : null}
            {onDuplicateSession ? (
              <MenuItem value="duplicate" disabled={actionsDisabled}>
                {t('conversation.sessionActions.duplicate', 'Duplicate')}
              </MenuItem>
            ) : null}
            {onExportSession ? (
              <MenuItem value="export" disabled={actionsDisabled}>
                {t('conversation.sessionActions.export', 'Export Markdown')}
              </MenuItem>
            ) : null}
            {onDeleteSession ? (
              <MenuItem value="delete" disabled={actionsDisabled} className="text-danger">
                {t('conversation.sessionActions.delete', 'Delete from history')}
              </MenuItem>
            ) : null}
            {onSetPinned ? (
              <MenuItem value="pin" disabled={actionsDisabled}>
                {session.pinned
                  ? t('conversation.sessionActions.unpin', 'Unpin')
                  : t('conversation.sessionActions.pin', 'Pin')}
              </MenuItem>
            ) : null}
            {onSetArchived ? (
              <MenuItem value="archive" disabled={actionsDisabled}>
                {session.archived
                  ? t('conversation.sessionActions.unarchive', 'Unarchive')
                  : t('conversation.sessionActions.archive', 'Archive')}
              </MenuItem>
            ) : null}
          </MenuContent>
        </MenuRoot>
      ) : null}
    </div>
  );
}
