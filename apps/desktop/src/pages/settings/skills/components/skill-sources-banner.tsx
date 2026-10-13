import { useTranslation } from 'react-i18next';

export function SkillSourcesBanner() {
  const { t } = useTranslation();
  return (
    <div className="rounded-lg border border-border-subtle bg-surface p-4 space-y-2.5">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-semibold text-foreground">
          {t('settings.skills.bannerTitle', 'Skill Discovery & Hierarchy')}
        </h4>
        <span className="rounded bg-brand/15 border border-brand/30 px-1.5 py-0.5 text-2xs font-semibold text-brand">
          {t('settings.skills.bannerBadge', 'Auto-Discovered')}
        </span>
      </div>
      <p className="text-xs text-foreground-secondary leading-relaxed">
        {t(
          'settings.skills.bannerLead',
          'Agent skills are discovered dynamically from your workspace',
        )}{' '}
        <code dir="ltr" className="font-mono text-foreground">
          .agents/skills/
        </code>{' '}
        {t('settings.skills.bannerMiddle', 'and global system configuration')}{' '}
        <code dir="ltr" className="font-mono text-foreground">
          ~/.gemini/config/skills/
        </code>
        .{' '}
        {t(
          'settings.skills.bannerTail',
          'Workspace definitions take precedence when naming collisions occur.',
        )}
      </p>
    </div>
  );
}
