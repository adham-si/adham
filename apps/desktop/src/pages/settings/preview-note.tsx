import { useTranslation } from 'react-i18next';

/**
 * Honest preview marker for capability pages whose controls are not
 * connected to any backend yet (models, providers, routing, extensions,
 * governance, budget, usage). The page stays as product direction, but no
 * control on it is usable: enforcement sections render inside a disabled
 * fieldset next to this note.
 */
export function PreviewNote() {
  const { t } = useTranslation();
  return (
    <p
      role="note"
      className="rounded-md bg-surface-subtle px-3 py-2 text-xs text-foreground-secondary"
    >
      <span className="font-semibold text-foreground">
        {t('settings.preview.title', 'Preview')}
      </span>
      <span>
        {' — '}
        {t(
          'settings.preview.note',
          'These controls are not connected yet. Nothing here changes the app.',
        )}
      </span>
    </p>
  );
}
