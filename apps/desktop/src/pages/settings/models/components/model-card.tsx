import * as React from 'react';
import { Button } from '@adham/ui';

export interface ModelItem {
  id: string;
  name: string;
  provider: string;
  providerId: string;
  contextWindow: string;
  desc: string;
  icon: React.ReactNode;
  type: 'local' | 'cloud';
  capabilities: string[];
}

interface ModelCardProps {
  model: ModelItem;
  isDefault: boolean;
  isFallback: boolean;
  onSetDefault: (id: string) => void;
  onSetFallback: (id: string) => void;
}

export function ModelCard({
  model,
  isDefault,
  isFallback,
  onSetDefault,
  onSetFallback,
}: ModelCardProps) {
  return (
    <div
      className={`flex flex-col justify-between rounded-lg border p-3.5 transition-colors gap-3 ${
        isDefault
          ? 'border-brand/40 bg-surface shadow-xs'
          : 'border-border-subtle bg-surface hover:bg-surface-subtle/40'
      }`}
    >
      {/* Top row: Icon + Names + Badges */}
      <div className="flex items-start justify-between gap-3 min-w-0">
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-surface-subtle text-foreground overflow-hidden p-1.5 [&_svg]:size-icon-sm">
            {model.icon}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-sm font-semibold text-foreground truncate">{model.name}</span>
              {isDefault && (
                <span className="rounded bg-brand/15 border border-brand/30 px-1.5 py-0.5 text-[10px] font-semibold text-brand">
                  Default
                </span>
              )}
              {isFallback && !isDefault && (
                <span className="rounded bg-info-surface px-1.5 py-0.5 text-[10px] font-semibold text-info-foreground">
                  Fallback
                </span>
              )}
            </div>
            <div className="text-xs text-foreground-secondary mt-0.5 truncate">
              {model.provider} • <span className="font-mono text-2xs">{model.contextWindow}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Description */}
      <p className="text-xs text-foreground-secondary line-clamp-2 leading-relaxed">{model.desc}</p>

      {/* Bottom row: Capabilities and Action Buttons */}
      <div className="flex items-center justify-between pt-1 border-t border-border-subtle/50">
        <div className="flex items-center gap-1 overflow-hidden">
          {model.capabilities.map((cap) => (
            <span
              key={cap}
              className="rounded bg-surface-subtle px-1.5 py-0.5 text-[10px] text-foreground-secondary font-medium"
            >
              {cap}
            </span>
          ))}
        </div>

        <div className="flex items-center gap-1.5 shrink-0 ms-2">
          {!isDefault && (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => onSetDefault(model.id)}
              className="text-xs"
            >
              Make default
            </Button>
          )}
          {!isFallback && !isDefault && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onSetFallback(model.id)}
              className="text-xs text-foreground-secondary hover:text-foreground"
            >
              Set fallback
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
