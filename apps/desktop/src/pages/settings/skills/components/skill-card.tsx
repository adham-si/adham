import * as React from 'react';
import { Button } from '@adham/ui';

export interface SkillItem {
  id: string;
  name: string;
  desc: string;
  icon: React.ReactNode;
  source: 'workspace' | 'global' | 'builtin';
  category: string;
}

interface SkillCardProps {
  skill: SkillItem;
  isActive: boolean;
  onToggle: (id: string) => void;
}

export function SkillCard({ skill, isActive, onToggle }: SkillCardProps) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-border-subtle bg-surface p-3 transition-colors hover:bg-surface-subtle/40">
      <div className="flex items-center gap-3 min-w-0">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-surface-subtle text-foreground overflow-hidden p-1.5 [&_svg]:size-icon-sm">
          {skill.icon}
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-foreground truncate">{skill.name}</span>
            {isActive && (
              <span className="rounded bg-success-surface px-1.5 py-0.5 text-2xs font-medium text-success-foreground">
                Active
              </span>
            )}
            <span className="rounded bg-surface-subtle px-1.5 py-0.5 text-2xs font-mono text-foreground-secondary uppercase">
              {skill.source}
            </span>
          </div>
          <div className="text-xs text-foreground-secondary truncate max-w-[200px] sm:max-w-[260px] mt-0.5">
            {skill.desc}
          </div>
        </div>
      </div>
      <Button
        size="sm"
        variant="secondary"
        onClick={() => onToggle(skill.id)}
        className="ms-3 shrink-0"
      >
        {isActive ? 'Active' : 'Enable'}
      </Button>
    </div>
  );
}
