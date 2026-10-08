import { createFileRoute } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { registerGalleryI18n } from '@/widgets/gallery/i18n';
import {
  ButtonSection,
  FormsSection,
  IconSection,
  MessageCardSection,
  NavigationSection,
  OverlaysSection,
} from '@/widgets/gallery';

registerGalleryI18n();

/**
 * Design-system quality surface (see docs/reports/design-system-verification.md).
 * Composits every @adham/ui component across variants, sizes and states. Not
 * linked from the navigation rail; reachable directly at /gallery.
 */
export function GalleryPage() {
  const { t } = useTranslation();

  return (
    <main className="h-full w-full overflow-y-auto bg-background">
      <div className="mx-auto max-w-4xl p-4 sm:p-6">
        <header className="mb-6">
          <h1 className="text-xl font-semibold">{t('gallery.title')}</h1>
          <p className="mt-1 text-sm text-foreground-secondary">{t('gallery.note')}</p>
        </header>
        <div className="flex flex-col gap-6">
          <ButtonSection />
          <FormsSection />
          <NavigationSection />
          <OverlaysSection />
          <MessageCardSection />
          <IconSection />
        </div>
      </div>
    </main>
  );
}

export const Route = createFileRoute('/gallery')({
  component: GalleryPage,
});
