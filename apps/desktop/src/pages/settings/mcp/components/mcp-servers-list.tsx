import { useTranslation } from 'react-i18next';
import * as React from 'react';
import { McpServerCard, type McpServerItem } from './mcp-server-card';

interface McpServersListProps {
  servers: McpServerItem[];
  configuredIds: Set<string>;
  onToggle: (id: string) => void;
}

export function McpServersList({ servers, configuredIds, onToggle }: McpServersListProps) {
  const { t } = useTranslation();
  if (servers.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border-subtle p-8 text-center">
        <p className="text-sm font-medium text-foreground">
          {t('settings.mcp.emptyTitle', 'No MCP servers match filter')}
        </p>
        <p className="text-xs text-foreground-secondary mt-1">
          {t(
            'settings.mcp.emptyHint',
            'Switch to another filter tab or install a custom MCP server.',
          )}
        </p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
      {servers.map((server) => (
        <McpServerCard
          key={server.id}
          server={server}
          isConfigured={configuredIds.has(server.id)}
          onToggle={onToggle}
        />
      ))}
    </div>
  );
}
