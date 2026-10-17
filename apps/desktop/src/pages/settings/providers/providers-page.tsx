import { useTranslation } from 'react-i18next';
import { OllamaConnect } from './components';

export function ProvidersPage() {
  const { t } = useTranslation();

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div>
        <h2 className="text-xl font-bold tracking-tight text-foreground">
          {t('settings.providers.title', 'AI Providers')}
        </h2>
        <p className="text-xs text-foreground-secondary mt-1">{t('settings.providers.desc')}</p>
      </div>

      {/* Working Ollama row (Delivery A). No static provider catalog is shown:
          supported providers are exactly the working connections below. */}
      <OllamaConnect />
    </div>
  );
}
