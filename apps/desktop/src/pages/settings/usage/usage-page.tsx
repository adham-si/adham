import { useTranslation } from 'react-i18next';
import { PreviewNote } from '../preview-note';

export function UsagePage() {
  const { t } = useTranslation();

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div>
        <h2 className="text-xl font-bold tracking-tight text-foreground">
          {t('settings.usage.title', { defaultValue: 'Usage & Analytics' })}
        </h2>
        <p className="text-xs text-foreground-secondary mt-1">
          {t('settings.usage.desc', {
            defaultValue:
              'Local resource consumption metrics, token counts, and invocation breakdowns.',
          })}
        </p>
      </div>

      <PreviewNote />

      {/*
        No usage metering exists in this build, so there are no totals,
        model rows or reporting controls to show. Previously displayed
        figures were static placeholders, now removed. Metering arrives
        with the provider gateway and budgets (P0-07/P0-08).
      */}
      <section aria-labelledby="model-utilization-heading" className="space-y-4">
        <div className="border-b border-border-subtle pb-2.5">
          <h3 id="model-utilization-heading" className="text-sm font-semibold text-foreground">
            {t('settings.usage.utilizationTitle', 'Model utilization')}
          </h3>
        </div>
        <div className="space-y-1">
          <p className="text-sm font-medium text-foreground">
            {t('settings.usage.emptyTitle', 'No usage data')}
          </p>
          <p className="text-xs text-foreground-secondary">
            {t('settings.usage.emptyHint', 'Usage metering is not collected in this build.')}
          </p>
        </div>
      </section>
    </div>
  );
}
