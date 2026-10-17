import { useTranslation } from 'react-i18next';
import { OllamaModels } from './components';

export function ModelsPage() {
  const { t } = useTranslation();

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div>
        <h2 className="text-xl font-bold tracking-tight text-foreground">
          {t('settings.models.pageTitle', 'AI Models')}
        </h2>
        <p className="text-xs text-foreground-secondary mt-1">{t('settings.models.desc')}</p>
      </div>

      {/* Registry-pinned Ollama models (Delivery A). No static catalog and no
          default/fallback chain are shown: supported models are exactly the
          ones pinned from a connected Ollama endpoint. */}
      <OllamaModels />

      {/* Implemented local-only wording (not a guarantee — see the delivery
          note in the locale resources). */}
      <div className="pt-2 text-xs text-foreground-secondary">
        {t('settings.models.localFirstNote')}
      </div>
    </div>
  );
}
