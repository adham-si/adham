import * as React from 'react';

export function SkillSourcesBanner() {
  return (
    <div className="rounded-lg border border-border-subtle bg-surface p-4 space-y-2.5">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-semibold text-foreground">Skill Discovery &amp; Hierarchy</h4>
        <span className="rounded bg-brand/15 border border-brand/30 px-1.5 py-0.5 text-2xs font-semibold text-brand">
          Auto-Discovered
        </span>
      </div>
      <p className="text-xs text-foreground-secondary leading-relaxed">
        Agent skills are discovered dynamically from your workspace (
        <code className="font-mono text-foreground">.agents/skills/</code>) and global system
        configuration (<code className="font-mono text-foreground">~/.gemini/config/skills/</code>).
        Workspace definitions take precedence when naming collisions occur.
      </p>
    </div>
  );
}
