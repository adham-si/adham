import { useTranslation } from 'react-i18next';
import { AdhamIcon } from '@adham/ui';
import { GalleryRow, GallerySection } from './gallery-section';

const PLUS_PATH = <path d="M12 5v14M5 12h14" />;

export function IconSection() {
  const { t } = useTranslation();

  return (
    <GallerySection title={t('gallery.icons.title')}>
      <GalleryRow label="sm / md / lg">
        <AdhamIcon size="sm">{PLUS_PATH}</AdhamIcon>
        <AdhamIcon size="md">{PLUS_PATH}</AdhamIcon>
        <AdhamIcon size="lg">{PLUS_PATH}</AdhamIcon>
      </GalleryRow>
      <GalleryRow>
        <div className="flex items-center gap-2 text-foreground-secondary">
          <AdhamIcon size="md" label={t('gallery.icons.labelled')}>
            {PLUS_PATH}
          </AdhamIcon>
          <span className="text-sm">{t('gallery.icons.labelled')}</span>
        </div>
        <div className="flex items-center gap-2 text-foreground-secondary">
          <AdhamIcon size="md" mirrored>
            {PLUS_PATH}
          </AdhamIcon>
          <span className="text-sm">{t('gallery.icons.mirrored')}</span>
        </div>
      </GalleryRow>
    </GallerySection>
  );
}
