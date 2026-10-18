import { useTranslation } from 'react-i18next';
import { contentFromText, MessageCard } from '@adham/ui';
import { GallerySection } from './gallery-section';

const DEMO_TIMESTAMP = '10:00 AM';
const DEMO_ISO = '2026-10-07T10:00:00Z';

export function MessageCardSection() {
  const { t } = useTranslation();

  return (
    <GallerySection title={t('gallery.messages.title')}>
      <MessageCard
        role="user"
        content={contentFromText(t('gallery.messages.user'))}
        timestamp={DEMO_TIMESTAMP}
        dateTime={DEMO_ISO}
      />
      <MessageCard
        role="assistant"
        content={contentFromText(t('gallery.messages.assistant'))}
        timestamp={DEMO_TIMESTAMP}
        dateTime={DEMO_ISO}
      />
      <MessageCard
        role="system"
        content={contentFromText(t('gallery.messages.system'))}
        timestamp={DEMO_TIMESTAMP}
        dateTime={DEMO_ISO}
      />
      <MessageCard
        role="user"
        content={contentFromText(t('gallery.messages.selected'))}
        timestamp={DEMO_TIMESTAMP}
        dateTime={DEMO_ISO}
        selected
      />
      <MessageCard
        role="assistant"
        content={contentFromText(t('gallery.messages.editable'))}
        timestamp={DEMO_TIMESTAMP}
        dateTime={DEMO_ISO}
        editable
      />
    </GallerySection>
  );
}
