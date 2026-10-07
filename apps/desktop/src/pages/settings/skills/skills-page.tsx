import * as React from 'react';
import { useTranslation } from 'react-i18next';

export function SkillsPage() {
  const { t } = useTranslation();

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-base font-semibold text-foreground">
          {t('settings.extensions.skills')}
        </h3>
        <p className="text-xs text-foreground-secondary">
          Configure agent workflow skills, instructional playbooks, and contextual execution
          capabilities.
        </p>
      </div>

      {/* Discovery roots */}
      <div className="rounded-lg border border-border-subtle bg-surface-subtle p-4 space-y-3">
        <div className="text-xs font-semibold uppercase tracking-wider text-foreground-muted">
          Skill Discovery Roots
        </div>
        <div className="rounded border border-border-subtle bg-surface p-2.5 text-xs text-foreground-secondary space-y-1">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-foreground">Workspace:</span>
            <span className="font-mono">.agents/skills/</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="font-semibold text-foreground">Global:</span>
            <span className="font-mono">~/.gemini/config/skills/</span>
          </div>
        </div>
      </div>

      {/* Available skills */}
      <div className="rounded-lg border border-border-subtle bg-surface-subtle p-4 space-y-2">
        <div className="flex items-center justify-between">
          <div className="text-xs font-semibold uppercase tracking-wider text-foreground-muted">
            Installed Playbooks
          </div>
          <span className="rounded bg-success-surface px-2 py-0.5 text-xs text-success-foreground font-medium">
            Verified
          </span>
        </div>
        <p className="text-xs text-foreground-secondary">
          Skills are validated for deterministic execution without ambient file system leaks.
        </p>
      </div>
    </div>
  );
}
