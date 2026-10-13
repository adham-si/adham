import { useTranslation } from 'react-i18next';
import { ProviderCard, type ProviderItem } from './provider-card';

interface ProvidersListProps {
  providers: ProviderItem[];
  connectedIds: Set<string>;
  onToggleConnect: (id: string) => void;
}

export function ProvidersList({ providers, connectedIds, onToggleConnect }: ProvidersListProps) {
  const { t } = useTranslation();
  if (providers.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-lg border border-border-subtle bg-surface-subtle/30 py-10 text-center">
        <p className="text-sm font-medium text-foreground">
          {t('settings.providers.emptyTitle', 'No providers configured')}
        </p>
        <p className="text-xs text-foreground-secondary mt-1">
          {t('settings.providers.emptyHint', {
            tab: t('settings.providers.allTab', 'All providers'),
          })}
        </p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
      {providers.map((p) => (
        <ProviderCard
          key={p.id}
          provider={p}
          isConnected={connectedIds.has(p.id)}
          onToggleConnect={onToggleConnect}
        />
      ))}
    </div>
  );
}
