import * as React from 'react';
import { useTranslation } from 'react-i18next';
import { Input, Button } from '@adham/ui';

export function BudgetPage() {
  const { t } = useTranslation();
  const [dailyCap, setDailyCap] = React.useState('50000');
  const [monthlyCap, setMonthlyCap] = React.useState('1000000');
  const [hardStop, setHardStop] = React.useState(true);

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-base font-semibold text-foreground">
          {t('settings.budget.title', { defaultValue: 'Budget & Cost Limits' })}
        </h3>
        <p className="text-xs text-foreground-secondary">
          {t('settings.budget.desc', {
            defaultValue: 'Configure token budgets, spend caps, and hard limits across projects.',
          })}
        </p>
      </div>

      {/* Spend policy banner */}
      <div className="rounded-lg border border-border-subtle bg-surface-subtle p-4 space-y-2">
        <div className="flex items-center justify-between">
          <div className="text-xs font-semibold uppercase tracking-wider text-foreground-muted">
            Enforcement Policy
          </div>
          <span className="rounded bg-success-surface px-2 py-0.5 text-xs text-success-foreground font-medium">
            Zero-Cost Local Mode Active
          </span>
        </div>
        <p className="text-xs text-foreground-secondary">
          Local Ollama execution incurs $0.00 external API spend. Cloud tokens are capped at zero
          unless an API key is connected.
        </p>
      </div>

      {/* Token Caps */}
      <div className="rounded-lg border border-border-subtle bg-surface-subtle p-4 space-y-4">
        <label className="text-xs font-semibold uppercase tracking-wider text-foreground-muted">
          Token Allowances
        </label>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <span className="text-xs text-foreground-secondary">Daily Token Cap</span>
            <Input
              type="number"
              value={dailyCap}
              onChange={(e) => setDailyCap(e.target.value)}
              className="w-full text-xs"
            />
          </div>
          <div className="space-y-1.5">
            <span className="text-xs text-foreground-secondary">Monthly Token Cap</span>
            <Input
              type="number"
              value={monthlyCap}
              onChange={(e) => setMonthlyCap(e.target.value)}
              className="w-full text-xs"
            />
          </div>
        </div>

        {/* Hard limit toggle */}
        <div className="flex items-center justify-between border-t border-border-subtle pt-3">
          <div>
            <div className="text-xs font-medium text-foreground">Hard Stop at Limit</div>
            <div className="text-[11px] text-foreground-secondary">
              Halt agent execution immediately when budget is exhausted.
            </div>
          </div>
          <Button
            size="sm"
            variant={hardStop ? 'primary' : 'secondary'}
            onClick={() => setHardStop(!hardStop)}
          >
            {hardStop ? 'Enabled' : 'Disabled'}
          </Button>
        </div>
      </div>
    </div>
  );
}
