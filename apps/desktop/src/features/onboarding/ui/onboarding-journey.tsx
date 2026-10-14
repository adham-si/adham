import * as React from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@adham/ui';
import type { OnboardingJourneyApi, OnboardingStep } from '../model/use-onboarding';
import { WorkspaceStep } from './workspace-step';
import { ProjectStep } from './project-step';
import { ReadyStep } from './ready-step';

const STEP_ORDER: OnboardingStep[] = ['workspace', 'project', 'ready'];

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
    <ol aria-label={t('onboarding.stepsLabel', 'Setup steps')} className="flex gap-1.5">
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

/**
 * First-run journey surface. Composition only: the phase/step model lives in
 * the model hook, each step is its own component, and the storage blocker or
 * load failure replaces the step content until an explicit retry succeeds.
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

  const showBack = api.step !== 'workspace';

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-8 overflow-y-auto p-6">
      <div className="flex w-full max-w-md flex-col items-stretch gap-8">
        <StepRail current={api.step} />
        {api.blocker === 'storage' ? (
          <div className="flex flex-col gap-3">
            <p role="alert" className="text-sm text-danger-foreground">
              {t(
                'onboarding.storageDegraded',
                'Local storage is unavailable. Setup cannot continue until it recovers.',
              )}
            </p>
            <Button type="button" variant="secondary" onClick={api.retry}>
              {t('common.retry', 'Retry')}
            </Button>
          </div>
        ) : (
          <>
            {api.step === 'workspace' && <WorkspaceStep api={api} />}
            {api.step === 'project' && <ProjectStep api={api} />}
            {api.step === 'ready' && <ReadyStep api={api} />}
            {api.step !== 'workspace' && api.error && (
              <p role="alert" className="text-xs text-danger-foreground">
                {api.error}
              </p>
            )}
            {showBack && api.step !== 'ready' && (
              <div className="flex">
                <Button type="button" variant="secondary" onClick={api.back} disabled={api.working}>
                  {t('onboarding.back', 'Back')}
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </main>
  );
}
