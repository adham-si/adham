import { useTranslation } from 'react-i18next';
import {
  Button,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogRoot,
  DialogTitle,
  DialogTrigger,
  MenuContent,
  MenuGroup,
  MenuItem,
  MenuRoot,
  MenuSeparator,
  MenuTrigger,
} from '@adham/ui';
import { galleryTriggerClasses, GallerySection } from './gallery-section';

function MenuDemo() {
  const { t } = useTranslation();

  return (
    <div className="relative self-start">
      <MenuRoot>
        <MenuTrigger className={galleryTriggerClasses}>
          {t('gallery.overlays.menuOpen')}
        </MenuTrigger>
        <MenuContent className="start-0 top-full mt-1" label={t('gallery.overlays.menuLabel')}>
          <MenuGroup label={t('gallery.overlays.file')}>
            <MenuItem value="new">{t('gallery.overlays.menuNew')}</MenuItem>
            <MenuItem value="open">{t('gallery.overlays.menuOpenFile')}</MenuItem>
            <MenuItem value="save">{t('gallery.overlays.menuSave')}</MenuItem>
          </MenuGroup>
          <MenuSeparator />
          <MenuGroup label={t('gallery.overlays.edit')}>
            <MenuItem value="cut">{t('gallery.overlays.menuCut')}</MenuItem>
            <MenuItem value="copy" active>
              {t('gallery.overlays.menuCopy')}
            </MenuItem>
            <MenuItem value="plain" disabled>
              {t('gallery.overlays.menuDisabled')}
            </MenuItem>
          </MenuGroup>
        </MenuContent>
      </MenuRoot>
    </div>
  );
}

function DialogDemo() {
  const { t } = useTranslation();

  return (
    <div className="self-start">
      <DialogRoot>
        <DialogTrigger className={galleryTriggerClasses}>
          {t('gallery.overlays.dialogOpen')}
        </DialogTrigger>
        <DialogContent size="md" label={t('gallery.overlays.dialogTitle')}>
          <DialogTitle>{t('gallery.overlays.dialogTitle')}</DialogTitle>
          <DialogDescription>{t('gallery.overlays.dialogDesc')}</DialogDescription>
          <div className="flex justify-end gap-2">
            <DialogClose className={galleryTriggerClasses}>
              {t('gallery.overlays.dialogCancel')}
            </DialogClose>
            <Button variant="danger">{t('gallery.overlays.dialogConfirm')}</Button>
          </div>
        </DialogContent>
      </DialogRoot>
    </div>
  );
}

export function OverlaysSection() {
  const { t } = useTranslation();

  return (
    <GallerySection title={t('gallery.overlays.title')}>
      <MenuDemo />
      <DialogDemo />
    </GallerySection>
  );
}
