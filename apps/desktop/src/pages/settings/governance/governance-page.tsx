import * as React from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@adham/ui';

export function GovernancePage() {
  const { t } = useTranslation();
  const [autonomyLevel, setAutonomyLevel] = React.useState<'supervised' | 'strict' | 'autonomous'>(
    'supervised',
  );

  const levels: Array<{ id: 'strict' | 'supervised' | 'autonomous'; label: string; desc: string }> =
    [
      {
        id: 'strict',
        label: 'Strict Confirmation',
        desc: 'Requires explicit human approval before any file modification, tool invocation, or bash command.',
      },
      {
        id: 'supervised',
        label: 'Supervised (Default)',
        desc: 'Executes non-destructive operations automatically. Prompts for file writes, git commands, and external tools.',
      },
      {
        id: 'autonomous',
        label: 'Autonomous Mode',
        desc: 'Executes verified playbooks within bounded sandbox staging environments without interactive prompts.',
      },
    ];

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-base font-semibold text-foreground">
          {t('settings.governance.title', { defaultValue: 'Policies & Governance' })}
        </h3>
        <p className="text-xs text-foreground-secondary">
          {t('settings.governance.desc', {
            defaultValue:
              'Define agent autonomy levels, safety guardrails, and compliance policy constraints.',
          })}
        </p>
      </div>

      {/* Autonomy Level */}
      <div className="rounded-lg border border-border-subtle bg-surface-subtle p-4 space-y-3">
        <label className="text-xs font-semibold uppercase tracking-wider text-foreground-muted">
          Agent Autonomy Level
        </label>
        <div className="space-y-2">
          {levels.map((item) => {
            const isSelected = autonomyLevel === item.id;
            return (
              <div
                key={item.id}
                onClick={() => setAutonomyLevel(item.id)}
                className={`flex cursor-pointer items-start justify-between rounded-md border p-3 transition-colors ${
                  isSelected
                    ? 'border-action bg-selection text-foreground'
                    : 'border-border-subtle bg-surface text-foreground-secondary hover:bg-surface-hover'
                }`}
              >
                <div>
                  <div className="text-xs font-semibold text-foreground">{item.label}</div>
                  <div className="text-[11px] text-foreground-secondary">{item.desc}</div>
                </div>
                <Button
                  size="sm"
                  variant={isSelected ? 'primary' : 'secondary'}
                  className="shrink-0 pointer-events-none"
                >
                  {isSelected ? 'Active' : 'Select'}
                </Button>
              </div>
            );
          })}
        </div>
      </div>

      {/* Policy Guardrails */}
      <div className="rounded-lg border border-border-subtle bg-surface-subtle p-4 space-y-3">
        <div className="text-xs font-semibold uppercase tracking-wider text-foreground-muted">
          Mandatory Security Guardrails
        </div>
        <div className="space-y-2 text-xs">
          <div className="flex items-center justify-between rounded border border-border-subtle bg-surface p-2.5">
            <div>
              <span className="font-semibold text-foreground">Git Push Protection: </span>
              <span className="text-foreground-secondary">
                Always prompt user before remote git push
              </span>
            </div>
            <span className="rounded bg-success-surface px-2 py-0.5 text-xs text-success-foreground font-medium">
              Enforced
            </span>
          </div>

          <div className="flex items-center justify-between rounded border border-border-subtle bg-surface p-2.5">
            <div>
              <span className="font-semibold text-foreground">Secret Scanning: </span>
              <span className="text-foreground-secondary">
                Block commits containing API keys or private tokens
              </span>
            </div>
            <span className="rounded bg-success-surface px-2 py-0.5 text-xs text-success-foreground font-medium">
              Enforced
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
