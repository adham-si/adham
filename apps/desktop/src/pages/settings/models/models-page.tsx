import { useTranslation } from 'react-i18next';
import { OllamaModels } from './components';
import { PreviewNote } from '../preview-note';

export function ModelsPage() {
  const { t } = useTranslation();

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div>
        <h2 className="text-xl font-bold tracking-tight text-foreground">
          {t('settings.models.pageTitle', 'AI Models')}
        </h2>
        <p className="text-xs text-foreground-secondary mt-1">
          {t(
            'settings.models.pageDesc',
            'Configure default intelligence runtimes, model parameters, and automatic fallback chains.',
          )}
        </p>
      </div>

      <PreviewNote />

      {/* Registry-pinned Ollama models (Delivery A). No static catalog and no
          default/fallback chain are shown: supported models are exactly the
          ones pinned from a connected Ollama endpoint. */}
      <OllamaModels />

      {/* Local-first Policy Note */}
      <div className="pt-2 text-xs text-foreground-secondary">
        {t(
          'settings.models.localFirstNote',
          'Local-first guarantee: When strict local boundary is enabled, requests with local models never cross to cloud providers without approval.',
        )}
      </div>
    </div>
  );
}
