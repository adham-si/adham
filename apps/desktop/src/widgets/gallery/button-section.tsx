import { useTranslation } from 'react-i18next';
import { AdhamIcon, Button } from '@adham/ui';
import { GalleryRow, GallerySection } from './gallery-section';

const VARIANT_LABELS = [
  { variant: 'primary' as const, key: 'gallery.buttons.primary' },
  { variant: 'secondary' as const, key: 'gallery.buttons.secondary' },
  { variant: 'ghost' as const, key: 'gallery.buttons.ghost' },
  { variant: 'danger' as const, key: 'gallery.buttons.danger' },
  { variant: 'link' as const, key: 'gallery.buttons.link' },
];

const SIZES = ['sm', 'md', 'lg'] as const;

export function ButtonSection() {
  const { t } = useTranslation();

  return (
    <GallerySection title={t('gallery.buttons.title')}>
      {SIZES.map((size) => (
        <GalleryRow key={size} label={size}>
          {VARIANT_LABELS.map(({ variant, key }) => (
            <Button key={key} variant={variant} size={size}>
              {t(key)}
            </Button>
          ))}
        </GalleryRow>
      ))}
      <GalleryRow>
        <Button disabled>{t('gallery.buttons.disabled')}</Button>
        <Button loading>{t('gallery.buttons.loading')}</Button>
        <Button variant="secondary">
          <AdhamIcon size="sm">
            <path d="M12 5v14M5 12h14" />
          </AdhamIcon>
          {t('gallery.buttons.fullWidth')}
        </Button>
      </GalleryRow>
      <GalleryRow label={t('gallery.buttons.iconOnly')}>
        {SIZES.map((size) => (
          <Button key={size} iconOnly size={size} aria-label={t('gallery.buttons.iconCopy')}>
            <AdhamIcon size={size}>
              <path d="M9 9h10v10H9z" />
              <path d="M15 9V5H5v10h4" />
            </AdhamIcon>
          </Button>
        ))}
        <Button iconOnly variant="secondary" aria-label={t('gallery.buttons.iconCopy')}>
          <AdhamIcon size="md">
            <path d="M9 9h10v10H9z" />
            <path d="M15 9V5H5v10h4" />
          </AdhamIcon>
        </Button>
        <Button iconOnly variant="danger" aria-label={t('gallery.buttons.iconDelete')}>
          <AdhamIcon size="md">
            <path d="M6 6l12 12M18 6L6 18" />
          </AdhamIcon>
        </Button>
        <Button iconOnly loading aria-label={t('gallery.buttons.iconSaving')}>
          <AdhamIcon size="md">
            <path d="M9 9h10v10H9z" />
          </AdhamIcon>
        </Button>
      </GalleryRow>
    </GallerySection>
  );
}
