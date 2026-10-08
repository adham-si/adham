import { useTranslation } from 'react-i18next';
import { SidebarItem } from '@adham/ui';
import { GallerySection } from './gallery-section';

export function NavigationSection() {
  const { t } = useTranslation();

  return (
    <GallerySection title={t('gallery.navigation.title')}>
      <div className="flex w-64 max-w-full flex-col gap-1 rounded-lg border border-border-subtle bg-surface-subtle p-2">
        <SidebarItem selected>{t('gallery.navigation.inbox')}</SidebarItem>
        <SidebarItem>{t('gallery.navigation.drafts')}</SidebarItem>
        <SidebarItem disabled>{t('gallery.navigation.archive')}</SidebarItem>
        <SidebarItem href="#">{t('gallery.navigation.projects')}</SidebarItem>
      </div>
    </GallerySection>
  );
}
