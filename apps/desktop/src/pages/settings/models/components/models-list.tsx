import { useTranslation } from 'react-i18next';
import { ModelCard, type ModelItem } from './model-card';

interface ModelsListProps {
  models: ModelItem[];
  defaultModelId: string;
  fallbackModelId: string;
  onSetDefault: (id: string) => void;
  onSetFallback: (id: string) => void;
}

export function ModelsList({
  models,
  defaultModelId,
  fallbackModelId,
  onSetDefault,
  onSetFallback,
}: ModelsListProps) {
  const { t } = useTranslation();
  if (models.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border-subtle p-8 text-center">
        <p className="text-sm font-medium text-foreground">
          {t('settings.models.emptyTitle', 'No models found')}
        </p>
        <p className="text-xs text-foreground-secondary mt-1">
          {t('settings.models.emptyHint', 'Try selecting another filter or pull a local model.')}
        </p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      {models.map((model) => (
        <ModelCard
          key={model.id}
          model={model}
          isDefault={model.id === defaultModelId}
          isFallback={model.id === fallbackModelId}
          onSetDefault={onSetDefault}
          onSetFallback={onSetFallback}
        />
      ))}
    </div>
  );
}
