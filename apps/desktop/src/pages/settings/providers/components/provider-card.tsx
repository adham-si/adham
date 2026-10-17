import { useTranslation } from 'react-i18next';
import { Button } from '@adham/ui';

export type ProviderId = 'ollama' | 'google';

export interface ProviderCatalogEntry {
  id: ProviderId;
  /// Brand name shown on the card and as the modal title (not a model name).
  name: string;
  logo: string;
  descKey: string;
}

/** Card status truth: an explicit connectivity outcome, never a guess from a config row. */
export type ProviderStatus = 'not-connected' | 'checking' | 'connected' | 'issue';

const BADGE_STYLES: Record<ProviderStatus, string> = {
  'not-connected': 'bg-surface-subtle text-foreground-secondary',
  checking: 'bg-surface-subtle text-foreground-secondary',
  connected: 'bg-success-surface text-success-foreground',
  issue: 'bg-danger-surface text-danger-foreground',
};

export function ProviderCard({
  provider,
  status,
  onOpen,
}: {
  provider: ProviderCatalogEntry;
  status: ProviderStatus;
  onOpen: () => void;
}) {
  const { t } = useTranslation();
  const statusLabel =
    status === 'connected'
      ? t('settings.providers.badgeConnected')
      : status === 'checking'
        ? t('settings.providers.statusChecking')
        : status === 'issue'
          ? t('settings.providers.statusIssue')
          : t('settings.providers.statusNotConnected');

  return (
    <section
      aria-label={provider.name}
      className="flex items-center justify-between rounded-lg border border-border-subtle bg-surface p-3.5"
    >
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border-subtle bg-surface-raised p-2">
          <img src={provider.logo} alt="" className="size-6 object-contain" />
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-semibold text-foreground">{provider.name}</span>
            <span
              className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium leading-none ${BADGE_STYLES[status]}`}
            >
              {statusLabel}
            </span>
          </div>
          <p className="mt-0.5 line-clamp-2 text-xs text-foreground-secondary">
            {t(provider.descKey)}
          </p>
        </div>
      </div>
      <Button size="sm" variant="secondary" onClick={onOpen} className="ml-3 shrink-0">
        {status === 'not-connected'
          ? t('settings.providers.connect')
          : t('settings.providers.cardManage')}
      </Button>
    </section>
  );
}
