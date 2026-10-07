import * as React from 'react';
import { useTranslation } from 'react-i18next';

export function BudgetPage() {
  const { t } = useTranslation();
  const [monthlySpend, setMonthlySpend] = React.useState('50');
  const [dailyTokens, setDailyTokens] = React.useState('500k');
  const [alertThreshold, setAlertThreshold] = React.useState('80');
  const [hardStop, setHardStop] = React.useState(true);
  const [fallbackToLocal, setFallbackToLocal] = React.useState(true);
  const [desktopNotify, setDesktopNotify] = React.useState(true);

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div>
        <h2 className="text-xl font-bold tracking-tight text-foreground">
          {t('settings.budget.title', { defaultValue: 'Budget & Cost Limits' })}
        </h2>
        <p className="text-xs text-foreground-secondary mt-1">
          {t('settings.budget.desc', {
            defaultValue:
              'Configure token budgets, monthly spending guardrails, and automated execution limits.',
          })}
        </p>
      </div>

      {/* Spend Guardrails Section */}
      <div className="space-y-1">
        <h3 className="text-sm font-semibold text-foreground pt-2 pb-1">Spend guardrails</h3>
        <div className="divide-y divide-border-subtle/40">
          {/* Monthly Spend Limit */}
          <div className="flex items-center justify-between py-3">
            <div>
              <div className="text-sm font-medium text-foreground">Monthly API spend limit</div>
              <div className="text-xs text-foreground-secondary mt-0.5">
                Maximum dollar allowance across all connected cloud model providers
              </div>
            </div>
            <select
              value={monthlySpend}
              onChange={(e) => setMonthlySpend(e.target.value)}
              className="min-h-control-sm rounded-md border border-border-subtle bg-surface px-3 py-1 text-xs text-foreground cursor-pointer hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-focus"
            >
              <option value="20">$20.00 / month</option>
              <option value="50">$50.00 / month</option>
              <option value="100">$100.00 / month</option>
              <option value="250">$250.00 / month</option>
              <option value="unlimited">Unlimited (No cap)</option>
            </select>
          </div>

          {/* Daily Token Allowance */}
          <div className="flex items-center justify-between py-3">
            <div>
              <div className="text-sm font-medium text-foreground">Daily token allowance</div>
              <div className="text-xs text-foreground-secondary mt-0.5">
                Target ceiling for total prompt and completion tokens per 24 hours
              </div>
            </div>
            <select
              value={dailyTokens}
              onChange={(e) => setDailyTokens(e.target.value)}
              className="min-h-control-sm rounded-md border border-border-subtle bg-surface px-3 py-1 text-xs text-foreground cursor-pointer hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-focus"
            >
              <option value="100k">100,000 tokens</option>
              <option value="500k">500,000 tokens</option>
              <option value="1m">1,000,000 tokens</option>
              <option value="unlimited">Unlimited</option>
            </select>
          </div>

          {/* Alert Threshold */}
          <div className="flex items-center justify-between py-3">
            <div>
              <div className="text-sm font-medium text-foreground">Warning threshold</div>
              <div className="text-xs text-foreground-secondary mt-0.5">
                Trigger in-app notification before reaching hard cap
              </div>
            </div>
            <select
              value={alertThreshold}
              onChange={(e) => setAlertThreshold(e.target.value)}
              className="min-h-control-sm rounded-md border border-border-subtle bg-surface px-3 py-1 text-xs text-foreground cursor-pointer hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-focus"
            >
              <option value="75">At 75% of limit</option>
              <option value="80">At 80% of limit</option>
              <option value="90">At 90% of limit</option>
            </select>
          </div>
        </div>
      </div>

      {/* Enforcement Actions Section */}
      <div className="space-y-1">
        <h3 className="text-sm font-semibold text-foreground pt-2 pb-1">Enforcement actions</h3>
        <div className="divide-y divide-border-subtle/40">
          {/* Hard Stop Toggle */}
          <div className="flex items-center justify-between py-3">
            <div>
              <div className="text-sm font-medium text-foreground">Hard stop at limit</div>
              <div className="text-xs text-foreground-secondary mt-0.5">
                Halt agent invocations immediately when monthly limit is reached
              </div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={hardStop}
              aria-label="Hard stop at limit"
              onClick={() => setHardStop(!hardStop)}
              className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full px-0.5 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus ${
                hardStop ? 'bg-action' : 'bg-surface-muted'
              }`}
            >
              <span
                className={`pointer-events-none inline-block size-4 transform rounded-full bg-surface shadow-sm transition-transform ${
                  hardStop ? 'translate-x-4' : 'translate-x-0'
                }`}
              />
            </button>
          </div>

          {/* Degrade to Local Ollama Toggle */}
          <div className="flex items-center justify-between py-3">
            <div>
              <div className="text-sm font-medium text-foreground">
                Automatic fallback to local Ollama
              </div>
              <div className="text-xs text-foreground-secondary mt-0.5">
                Switch seamlessly to local $0.00 models rather than aborting active work
              </div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={fallbackToLocal}
              aria-label="Automatic fallback to local Ollama"
              onClick={() => setFallbackToLocal(!fallbackToLocal)}
              className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full px-0.5 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus ${
                fallbackToLocal ? 'bg-action' : 'bg-surface-muted'
              }`}
            >
              <span
                className={`pointer-events-none inline-block size-4 transform rounded-full bg-surface shadow-sm transition-transform ${
                  fallbackToLocal ? 'translate-x-4' : 'translate-x-0'
                }`}
              />
            </button>
          </div>

          {/* Desktop Notifications Toggle */}
          <div className="flex items-center justify-between py-3">
            <div>
              <div className="text-sm font-medium text-foreground">Desktop budget alerts</div>
              <div className="text-xs text-foreground-secondary mt-0.5">
                Display native Windows notifications when spending reaches threshold
              </div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={desktopNotify}
              aria-label="Desktop budget alerts"
              onClick={() => setDesktopNotify(!desktopNotify)}
              className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full px-0.5 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus ${
                desktopNotify ? 'bg-action' : 'bg-surface-muted'
              }`}
            >
              <span
                className={`pointer-events-none inline-block size-4 transform rounded-full bg-surface shadow-sm transition-transform ${
                  desktopNotify ? 'translate-x-4' : 'translate-x-0'
                }`}
              />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
