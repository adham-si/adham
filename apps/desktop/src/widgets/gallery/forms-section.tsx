import * as React from 'react';
import { useTranslation } from 'react-i18next';
import { Input, Select, Textarea, type SelectOption } from '@adham/ui';
import { HugeiconsIcon } from '@hugeicons/react';
import { ArrowDown01Icon, ArrowUp01Icon } from '@hugeicons/core-free-icons';
import { GalleryRow, GallerySection } from './gallery-section';

const SIZES = ['sm', 'md', 'lg'] as const;

export function FormsSection() {
  const { t } = useTranslation();
  const fieldIds = React.useId();
  const selectOptions: SelectOption[] = [
    { value: 'personal', label: t('gallery.forms.optionPersonal') },
    { value: 'team', label: t('gallery.forms.optionTeam') },
  ];

  return (
    <GallerySection title={t('gallery.forms.title')}>
      {SIZES.map((size, index) => (
        <GalleryRow key={size} label={size}>
          <label className="flex flex-col gap-1 text-sm text-foreground-secondary">
            {t('gallery.forms.label')}
            <Input
              id={`${fieldIds}-input-${index}`}
              size={size}
              placeholder={t('gallery.forms.placeholder')}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-foreground-secondary">
            {t('gallery.forms.label')}
            <Textarea rows={2} size={size} placeholder={t('gallery.forms.placeholder')} />
          </label>
          <label className="flex flex-col gap-1 text-sm text-foreground-secondary">
            {t('gallery.forms.selectLabel')}
            <Select
              id={`${fieldIds}-select-${index}`}
              size={size}
              options={selectOptions}
              placeholder={t('gallery.forms.selectPlaceholder')}
              indicator={<HugeiconsIcon icon={ArrowDown01Icon} />}
              indicatorOpen={<HugeiconsIcon icon={ArrowUp01Icon} />}
            />
          </label>
        </GalleryRow>
      ))}
      <GalleryRow>
        <label className="flex w-full max-w-sm flex-col gap-1 text-sm text-foreground-secondary">
          {t('gallery.forms.invalidLabel')}
          <Input
            invalid
            errorMessage={t('gallery.forms.error')}
            placeholder={t('gallery.forms.placeholder')}
          />
        </label>
        <label className="flex w-full max-w-sm flex-col gap-1 text-sm text-foreground-secondary">
          {t('gallery.forms.label')}
          <Input disabled placeholder={t('gallery.forms.disabled')} />
        </label>
        <label className="flex w-full max-w-sm flex-col gap-1 text-sm text-foreground-secondary">
          {t('gallery.forms.label')}
          <Textarea rows={2} readOnly value={t('gallery.forms.readOnly')} />
        </label>
        <label className="flex w-full max-w-sm flex-col gap-1 text-sm text-foreground-secondary">
          {t('gallery.forms.selectLabel')}
          <Select
            invalid
            errorMessage={t('gallery.forms.error')}
            options={selectOptions}
            placeholder={t('gallery.forms.selectPlaceholder')}
            indicator={<HugeiconsIcon icon={ArrowDown01Icon} />}
            indicatorOpen={<HugeiconsIcon icon={ArrowUp01Icon} />}
          />
        </label>
        <label className="flex w-full max-w-sm flex-col gap-1 text-sm text-foreground-secondary">
          {t('gallery.forms.selectLabel')}
          <Select
            disabled
            options={selectOptions}
            placeholder={t('gallery.forms.selectPlaceholder')}
            indicator={<HugeiconsIcon icon={ArrowDown01Icon} />}
            indicatorOpen={<HugeiconsIcon icon={ArrowUp01Icon} />}
          />
        </label>
      </GalleryRow>
    </GallerySection>
  );
}
