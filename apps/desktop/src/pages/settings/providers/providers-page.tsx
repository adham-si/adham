import { useTranslation } from 'react-i18next';
import { OllamaConnect } from './components';
import { PreviewNote } from '../preview-note';

export function ProvidersPage() {
  const { t } = useTranslation();

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div>
        <h2 className="text-xl font-bold tracking-tight text-foreground">
          {t('settings.providers.title', 'AI Providers')}
        </h2>
        <p className="text-xs text-foreground-secondary mt-1">
          {t(
            'settings.providers.desc',
            'Connect local runtimes and cloud model providers to use across your workspace.',
          )}
        </p>
      </div>

      {/* Working Ollama row (Delivery A). No static provider catalog is shown:
          supported providers are exactly the working connections below. */}
      <OllamaConnect />

      <PreviewNote />
    </div>
  );
}
