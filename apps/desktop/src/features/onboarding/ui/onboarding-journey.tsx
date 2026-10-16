import { useTranslation } from 'react-i18next';
import { Button } from '@adham/ui';
import type { OnboardingJourneyApi } from '../model/use-onboarding';
import { GuideColumn } from './guide-column';
import { WorkspaceStep } from './workspace-step';
import { ProjectStep } from './project-step';
import { ReadyStep } from './ready-step';
import { LanguageSelect } from './language-select';

function StorageBlocker({ api }: { api: OnboardingJourneyApi }) {
  const { t } = useTranslation();
  const message =
    api.blocker === 'storage-degraded'
      ? t(
          'onboarding.storageDegraded',
          'Local storage is unavailable. Setup cannot continue until it recovers.',
        )
      : t(
          'onboarding.storageUnavailable',
          'Setup availability could not be confirmed. Retry until local storage is ready.',
        );
  return (
    <div className="flex flex-col gap-3">
      <p role="alert" className="text-sm text-danger-foreground">
        {message}
      </p>
      <div>
        <Button type="button" variant="secondary" onClick={api.retry}>
          {t('common.retry', 'Retry')}
        </Button>
      </div>
    </div>
  );
}

/**
 * First-run journey surface, rendered inside the app's default Context
 * card as a full-context page: a guide column (full-width numbered step
 * rail + mascot stage) beside a form column — the display-language
 * selector pins to the form column's top-end corner, and the step block
 * centers below it, titles centered with fields and buttons aligned to
 * the start. Composition only — the phase/step model lives in the model
 * hook, each step is its own component, and a storage blocker or load
 * failure replaces the form content until an explicit retry succeeds.
 * Narrow windows stack the columns; the guide column keeps the rail
 * above the mascot.
 */
export function OnboardingJourney({ api }: { api: OnboardingJourneyApi }) {
  const { t } = useTranslation();

  if (api.phase === 'checking') {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-foreground-secondary">
        <p aria-busy="true">{t('onboarding.checking', 'Checking your setup…')}</p>
      </div>
    );
  }

  if (api.phase === 'error') {
    const message =
      api.error ?? api.listError ?? t('onboarding.loadFailed', 'Setup state could not be loaded.');
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3">
        <p role="alert" className="text-sm text-danger-foreground">
          {message}
        </p>
        <Button type="button" variant="secondary" onClick={api.retry}>
          {t('common.retry', 'Retry')}
        </Button>
      </div>
    );
  }

  if (api.phase === 'complete') return null;

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col overflow-hidden">
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto md:flex-row md:overflow-hidden">
        <GuideColumn step={api.step} />
        {/* Form column: the language selector pins to the top-end corner;
            the step block centers in the remaining space and owns its own
            heading, fields, and actions (incl. the Back row). */}
        <section className="flex flex-1 flex-col gap-6 p-8 md:overflow-y-auto">
          <div className="flex shrink-0 justify-end">
            <LanguageSelect />
          </div>
          <div className="flex flex-1 flex-col items-center justify-center">
            <div className="flex w-full max-w-md flex-col gap-8">
              {api.blocker ? (
                <StorageBlocker api={api} />
              ) : (
                <>
                  {api.step === 'workspace' && <WorkspaceStep api={api} />}
                  {api.step === 'project' && <ProjectStep api={api} />}
                  {api.step === 'ready' && <ReadyStep api={api} />}
                  {api.error && (
                    <p role="alert" className="text-xs text-danger-foreground">
                      {api.error}
                    </p>
                  )}
                </>
              )}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
