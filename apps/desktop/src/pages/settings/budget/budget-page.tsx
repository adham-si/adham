import * as React from 'react';
import { useTranslation } from 'react-i18next';
import { formatNumber } from '@/shared/i18n/format';
import { PreviewNote } from '../preview-note';

export function BudgetPage() {
  const { t } = useTranslation();
  // Preview only: no metering or budget runtime reads these (P0-07/P0-08),
  // so the sections below are disabled. The structure stays as direction.
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

      <PreviewNote />

      {/* Spend guardrails and enforcement (not enforced: disabled preview) */}
      <fieldset disabled className="min-w-0 border-0 p-0 m-0 space-y-6">
        {/* Spend Guardrails Section */}
        <div className="space-y-4">
          <div className="border-b border-border-subtle/40 pb-2">
            <h3 className="text-sm font-semibold text-foreground">
              {t('settings.budget.spendTitle', 'Spend guardrails')}
            </h3>
          </div>
          <div className="space-y-4">
            {/* Monthly Spend Limit */}
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-medium text-foreground">
                  {t('settings.budget.monthlyLabel', 'Monthly API spend limit')}
                </div>
                <div className="text-xs text-foreground-secondary mt-0.5">
                  {t(
                    'settings.budget.monthlyHint',
                    'Maximum dollar allowance across all connected cloud model providers',
                  )}
                </div>
              </div>
              <select
                value={monthlySpend}
                onChange={(e) => setMonthlySpend(e.target.value)}
                className="min-h-control-sm rounded-md border border-border-subtle bg-surface px-3 py-1 text-xs text-foreground cursor-pointer hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-focus"
              >
                <option value="20">{t('settings.budget.perMonth', { amount: '$20.00' })}</option>
                <option value="50">{t('settings.budget.perMonth', { amount: '$50.00' })}</option>
                <option value="100">{t('settings.budget.perMonth', { amount: '$100.00' })}</option>
                <option value="250">{t('settings.budget.perMonth', { amount: '$250.00' })}</option>
                <option value="unlimited">
                  {t('settings.budget.unlimitedNoCap', 'Unlimited (No cap)')}
                </option>
              </select>
            </div>

            {/* Daily Token Allowance */}
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-medium text-foreground">
                  {t('settings.budget.dailyLabel', 'Daily token allowance')}
                </div>
                <div className="text-xs text-foreground-secondary mt-0.5">
                  {t(
                    'settings.budget.dailyHint',
                    'Target ceiling for total prompt and completion tokens per 24 hours',
                  )}
                </div>
              </div>
              <select
                value={dailyTokens}
                onChange={(e) => setDailyTokens(e.target.value)}
                className="min-h-control-sm rounded-md border border-border-subtle bg-surface px-3 py-1 text-xs text-foreground cursor-pointer hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-focus"
              >
                <option value="100k">
                  {t('settings.budget.tokensAllowed', {
                    count: 100000,
                    formatted: formatNumber(100000),
                  })}
                </option>
                <option value="500k">
                  {t('settings.budget.tokensAllowed', {
                    count: 500000,
                    formatted: formatNumber(500000),
                  })}
                </option>
                <option value="1m">
                  {t('settings.budget.tokensAllowed', {
                    count: 1000000,
                    formatted: formatNumber(1000000),
                  })}
                </option>
                <option value="unlimited">{t('settings.budget.unlimited', 'Unlimited')}</option>
              </select>
            </div>

            {/* Alert Threshold */}
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-medium text-foreground">
                  {t('settings.budget.thresholdLabel', 'Warning threshold')}
                </div>
                <div className="text-xs text-foreground-secondary mt-0.5">
                  {t(
                    'settings.budget.thresholdHint',
                    'Trigger in-app notification before reaching hard cap',
                  )}
                </div>
              </div>
              <select
                value={alertThreshold}
                onChange={(e) => setAlertThreshold(e.target.value)}
                className="min-h-control-sm rounded-md border border-border-subtle bg-surface px-3 py-1 text-xs text-foreground cursor-pointer hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-focus"
              >
                <option value="75">{t('settings.budget.thresholdAt', { percent: 75 })}</option>
                <option value="80">{t('settings.budget.thresholdAt', { percent: 80 })}</option>
                <option value="90">{t('settings.budget.thresholdAt', { percent: 90 })}</option>
              </select>
            </div>
          </div>
        </div>

        {/* Enforcement Actions Section */}
        <div className="space-y-4">
          <div className="border-b border-border-subtle/40 pb-2">
            <h3 className="text-sm font-semibold text-foreground">
              {t('settings.budget.enforcementTitle', 'Enforcement actions')}
            </h3>
          </div>
          <div className="space-y-4">
            {/* Hard Stop Toggle */}
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-medium text-foreground">
                  {t('settings.budget.hardStopLabel', 'Hard stop at limit')}
                </div>
                <div className="text-xs text-foreground-secondary mt-0.5">
                  {t(
                    'settings.budget.hardStopHint',
                    'Halt agent invocations immediately when monthly limit is reached',
                  )}
                </div>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={hardStop}
                aria-label={t('settings.budget.hardStopLabel', 'Hard stop at limit')}
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
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-medium text-foreground">
                  {t('settings.budget.fallbackLabel', 'Automatic fallback to local Ollama')}
                </div>
                <div className="text-xs text-foreground-secondary mt-0.5">
                  {t(
                    'settings.budget.fallbackHint',
                    'Switch seamlessly to local $0.00 models rather than aborting active work',
                  )}
                </div>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={fallbackToLocal}
                aria-label={t(
                  'settings.budget.fallbackLabel',
                  'Automatic fallback to local Ollama',
                )}
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
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-medium text-foreground">
                  {t('settings.budget.alertsLabel', 'Desktop budget alerts')}
                </div>
                <div className="text-xs text-foreground-secondary mt-0.5">
                  {t(
                    'settings.budget.alertsHint',
                    'Display native Windows notifications when spending reaches threshold',
                  )}
                </div>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={desktopNotify}
                aria-label={t('settings.budget.alertsLabel', 'Desktop budget alerts')}
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
      </fieldset>
    </div>
  );
}
