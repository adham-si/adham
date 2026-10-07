import * as React from 'react';
import { PluginCard, type PluginItem } from './plugin-card';

interface PluginsListProps {
  plugins: PluginItem[];
  installedIds: Set<string>;
  onToggle: (id: string) => void;
}

export function PluginsList({ plugins, installedIds, onToggle }: PluginsListProps) {
  if (plugins.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border-subtle p-8 text-center">
        <p className="text-sm font-medium text-foreground">No plugins match filter</p>
        <p className="text-xs text-foreground-secondary mt-1">
          Switch to another tab or browse available extensions in the catalog.
        </p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
      {plugins.map((plugin) => (
        <PluginCard
          key={plugin.id}
          plugin={plugin}
          isInstalled={installedIds.has(plugin.id)}
          onToggle={onToggle}
        />
      ))}
    </div>
  );
}
