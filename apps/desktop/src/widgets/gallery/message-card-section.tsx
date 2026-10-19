import { useTranslation } from 'react-i18next';
import { HugeiconsIcon } from '@hugeicons/react';
import {
  BotMessageSquareIcon,
  CopyIcon,
  MoreVerticalIcon,
  PencilLineIcon,
  RefreshCcwIcon,
  ThumbsDownIcon,
  ThumbsUpIcon,
  UserIcon,
} from '@hugeicons/core-free-icons';
import { contentFromText, MessageCard, type MessageActionIcons } from '@adham/ui';
import { GallerySection } from './gallery-section';

const DEMO_TIMESTAMP = '10:00 AM';
const DEMO_ISO = '2026-10-07T10:00:00Z';

/** Demo glyphs: the app supplies these nodes to the icon-set-free card. */
const DEMO_ICONS: MessageActionIcons = {
  copy: <HugeiconsIcon icon={CopyIcon} className="size-4" />,
  edit: <HugeiconsIcon icon={PencilLineIcon} className="size-4" />,
  regenerate: <HugeiconsIcon icon={RefreshCcwIcon} className="size-4" />,
  like: <HugeiconsIcon icon={ThumbsUpIcon} className="size-4" />,
  dislike: <HugeiconsIcon icon={ThumbsDownIcon} className="size-4 -scale-x-100" />,
  more: <HugeiconsIcon icon={MoreVerticalIcon} className="size-4" />,
};

export function MessageCardSection() {
  const { t } = useTranslation();

  return (
    <GallerySection title={t('gallery.messages.title')}>
      <MessageCard
        role="user"
        avatar={<HugeiconsIcon icon={UserIcon} className="size-5" />}
        icons={DEMO_ICONS}
        content={contentFromText(t('gallery.messages.user'))}
        timestamp={DEMO_TIMESTAMP}
        dateTime={DEMO_ISO}
        onReply={() => {}}
        onEdit={() => {}}
      />
      <MessageCard
        role="assistant"
        name="qwen2.5:latest"
        avatar={<HugeiconsIcon icon={BotMessageSquareIcon} className="size-5" />}
        icons={DEMO_ICONS}
        content={contentFromText(t('gallery.messages.assistant'))}
        timestamp={DEMO_TIMESTAMP}
        dateTime={DEMO_ISO}
        feedback={{ verdict: 'like', reason: null }}
        onFeedback={() => {}}
        onRegenerate={() => {}}
        onReply={() => {}}
      />
      <MessageCard
        role="assistant"
        name="qwen2.5:latest"
        avatar={<HugeiconsIcon icon={BotMessageSquareIcon} className="size-5" />}
        icons={DEMO_ICONS}
        streaming
        content={contentFromText(t('gallery.messages.assistant'))}
        timestamp={DEMO_TIMESTAMP}
        dateTime={DEMO_ISO}
      />
      <MessageCard
        role="system"
        icons={DEMO_ICONS}
        content={contentFromText(t('gallery.messages.system'))}
        timestamp={DEMO_TIMESTAMP}
        dateTime={DEMO_ISO}
      />
      <MessageCard
        role="user"
        icons={DEMO_ICONS}
        content={contentFromText(t('gallery.messages.selected'))}
        timestamp={DEMO_TIMESTAMP}
        dateTime={DEMO_ISO}
        selected
      />
      <MessageCard
        role="assistant"
        icons={DEMO_ICONS}
        content={contentFromText(t('gallery.messages.editable'))}
        timestamp={DEMO_TIMESTAMP}
        dateTime={DEMO_ISO}
        editable
      />
    </GallerySection>
  );
}
