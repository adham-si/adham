import * as React from 'react';
import { Button } from '@adham/ui';

export interface ProviderItem {
  id: string;
  name: string;
  desc: string;
  icon: React.ReactNode;
  category: 'local' | 'cloud';
}

interface ProviderCardProps {
  provider: ProviderItem;
  isConnected: boolean;
  onToggleConnect: (id: string) => void;
}

export function ProviderCard({ provider, isConnected, onToggleConnect }: ProviderCardProps) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-border-subtle bg-surface p-3 transition-colors hover:bg-surface-subtle/40">
      <div className="flex items-center gap-3 min-w-0">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-surface-subtle text-foreground overflow-hidden p-1.5 [&_svg]:size-icon-sm">
          {provider.icon}
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-foreground truncate">{provider.name}</span>
            {isConnected && (
              <span className="rounded bg-success-surface px-1.5 py-0.2 text-[10px] font-medium text-success-foreground">
                Connected
              </span>
            )}
          </div>
          <div className="text-xs text-foreground-secondary truncate max-w-[200px] sm:max-w-[260px] mt-0.5">
            {provider.desc}
          </div>
        </div>
      </div>
      <Button
        size="sm"
        variant={isConnected ? 'secondary' : 'secondary'}
        onClick={() => onToggleConnect(provider.id)}
        className="ms-3 shrink-0"
      >
        {isConnected ? 'Disconnect' : 'Connect'}
      </Button>
    </div>
  );
}
