import { useTranslation } from 'react-i18next';
import { Button } from '@adham/ui';
import type { OnboardingJourneyApi } from '../model/use-onboarding';
import { LanguageSelect } from './language-select';

/**
 * Ready step: confirms the backend-confirmed scope, offers the compact
 * language selector, and acknowledges entry into the app for this session.
 */
export function ReadyStep({ api }: { api: OnboardingJourneyApi }) {
  const { t } = useTranslation();
  return (
    <div className="flex w-full max-w-md flex-col gap-6">
      <h1 className="text-lg font-semibold text-foreground">
        {t('onboarding.readyHeading', 'Your workspace is ready')}
      </h1>

      <dl className="flex flex-col gap-1.5 rounded-md border border-border-subtle bg-surface-subtle p-2.5 text-xs">
        <div className="flex items-center justify-between gap-2">
          <dt className="font-semibold uppercase tracking-wider text-[10px] text-foreground-muted">
            {t('onboarding.readyWorkspaceLabel', 'Workspace')}
          </dt>
          <dd className="font-medium text-foreground">{api.readyWorkspace}</dd>
        </div>
        <div className="flex items-center justify-between gap-2">
          <dt className="font-semibold uppercase tracking-wider text-[10px] text-foreground-muted">
            {t('onboarding.readyProjectLabel', 'Project')}
          </dt>
          <dd className="font-medium text-foreground">{api.readyProject}</dd>
        </div>
      </dl>

      <LanguageSelect />

      <Button type="button" onClick={api.enter}>
        {t('onboarding.openAdham', 'Open Adham')}
      </Button>
    </div>
  );
}
