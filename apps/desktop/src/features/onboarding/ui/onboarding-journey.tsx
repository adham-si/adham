import * as React from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@adham/ui';
import type { OnboardingJourneyApi, OnboardingStep } from '../model/use-onboarding';
import { WorkspaceStep } from './workspace-step';
import { ProjectStep } from './project-step';
import { ReadyStep } from './ready-step';
import { LanguageSelect } from './language-select';

const STEP_ORDER: OnboardingStep[] = ['workspace', 'project', 'ready'];

/// Compact progress rail: vertical beside the content on desktop widths,
/// collapsed to a horizontal row above it in narrow windows.
function StepRail({ current }: { current: OnboardingStep }) {
  const { t } = useTranslation();
  const currentIndex = STEP_ORDER.indexOf(current);
  const labels: Record<OnboardingStep, string> = {
    workspace: t('onboarding.stepWorkspace', 'Workspace'),
    project: t('onboarding.stepProject', 'Project'),
    ready: t('onboarding.stepReady', 'Ready'),
  };
  const statuses = [
    t('onboarding.stepCurrent', 'Current step'),
    t('onboarding.stepCompleted', 'Completed'),
    t('onboarding.stepUpcoming', 'Upcoming'),
  ];
  return (
    <ol
      aria-label={t('onboarding.stepsLabel', 'Setup steps')}
      className="flex flex-row gap-1.5 md:w-40 md:shrink-0 md:flex-col md:items-start md:gap-2"
    >
      {STEP_ORDER.map((step, index) => {
        const status =
          index === currentIndex ? statuses[0] : index < currentIndex ? statuses[1] : statuses[2];
        return (
          <li
            key={step}
            aria-current={index === currentIndex ? 'step' : undefined}
            className={`rounded-full px-2.5 py-0.5 text-xs ${
              index === currentIndex
                ? 'bg-selection text-action font-medium'
                : index < currentIndex
                  ? 'text-foreground-secondary'
                  : 'text-foreground-muted'
            }`}
          >
            {labels[step]}
            <span className="sr-only">{` — ${status}`}</span>
          </li>
        );
      })}
    </ol>
  );
}

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
 * First-run journey surface. Composition only: the phase/step model lives in
 * the model hook, each step is its own component, and a storage blocker or
 * load failure replaces the step content until an explicit retry succeeds.
 * The compact language selector sits in the header so the journey can be
 * read in the user's language before anything is created.
 */
export function OnboardingJourney({ api }: { api: OnboardingJourneyApi }) {
  const { t } = useTranslation();

  if (api.phase === 'checking') {
    return (
      <main className="flex flex-1 items-center justify-center text-sm text-foreground-secondary">
        <p aria-busy="true">{t('onboarding.checking', 'Checking your setup…')}</p>
      </main>
    );
  }

  if (api.phase === 'error') {
    const message =
      api.error ?? api.listError ?? t('onboarding.loadFailed', 'Setup state could not be loaded.');
    return (
      <main className="flex flex-1 flex-col items-center justify-center gap-3">
        <p role="alert" className="text-sm text-danger-foreground">
          {message}
        </p>
        <Button type="button" variant="secondary" onClick={api.retry}>
          {t('common.retry', 'Retry')}
        </Button>
      </main>
    );
  }

  if (api.phase === 'complete') return null;

  return (
    <main className="flex flex-1 flex-col items-center overflow-y-auto p-6">
      <div className="flex w-full max-w-xl flex-col gap-8">
        <div className="flex justify-end">
          <LanguageSelect />
        </div>
        <div className="flex flex-col gap-8 md:flex-row md:items-start md:gap-10">
          <StepRail current={api.step} />
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
                {api.step !== 'workspace' && api.step !== 'ready' && (
                  <div className="flex">
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={api.back}
                      disabled={api.working}
                    >
                      {t('onboarding.back', 'Back')}
                    </Button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
