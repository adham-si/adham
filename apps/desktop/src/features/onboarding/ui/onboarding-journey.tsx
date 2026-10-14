import * as React from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@adham/ui';
import type { OnboardingJourneyApi, OnboardingStep } from '../model/use-onboarding';
import { WorkspaceStep } from './workspace-step';
import { ProjectStep } from './project-step';
import { ReadyStep } from './ready-step';
import { LanguageSelect } from './language-select';

const STEP_ORDER: OnboardingStep[] = ['workspace', 'project', 'ready'];

/// Compact progress rail: vertical in the guide column on desktop widths,
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
      className="flex flex-row gap-1.5 md:flex-col md:items-start md:gap-2"
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

/// Static, decorative preview of the current step's concept. Deliberately
/// non-textual so it needs no translation and cannot be mistaken for data.
function ShowcaseMock({ step }: { step: OnboardingStep }) {
  const card = 'rounded-md border border-border-subtle bg-surface';
  const bar = 'h-2 rounded bg-border-subtle';
  return (
    <div
      aria-hidden="true"
      className={`flex flex-col gap-3 p-4 opacity-70 ${'rounded-lg border border-border-subtle bg-surface-subtle'}`}
    >
      {step === 'workspace' && (
        <>
          <div className={`px-3 py-2 ${card}`}>
            <div className={`mb-2 w-1/3 ${bar}`} />
            <div className="flex flex-col gap-1.5">
              <div className={`w-2/3 ${bar}`} />
              <div className={`w-1/2 ${bar}`} />
            </div>
          </div>
          <div className={`px-3 py-2 ${card}`}>
            <div className={`mb-2 w-1/4 ${bar}`} />
            <div className={`w-2/3 ${bar}`} />
          </div>
        </>
      )}
      {step === 'project' && (
        <div className="flex gap-3">
          <div className={`flex-1 px-3 py-2 ${card}`}>
            <div className={`mb-2 w-1/2 ${bar}`} />
            <div className={`w-2/3 ${bar}`} />
          </div>
          <div className={`flex-1 px-3 py-2 ${card}`}>
            <div className={`mb-2 w-1/2 ${bar}`} />
            <div className={`w-2/3 ${bar}`} />
          </div>
        </div>
      )}
      {step === 'ready' && (
        <div className={`px-3 py-2 ${card}`}>
          <div className="mb-2 flex items-center gap-2">
            <span className="inline-block size-2 rounded-full bg-selection" />
            <div className={`w-1/3 ${bar}`} />
          </div>
          <div className={`mb-1.5 w-2/3 ${bar}`} />
          <div className={`w-1/2 ${bar}`} />
        </div>
      )}
    </div>
  );
}

/// Guide-column showcase: short complementary copy for the current step
/// plus a decorative preview. The form column keeps the actionable copy.
function StepShowcase({ step }: { step: OnboardingStep }) {
  const { t } = useTranslation();
  const copy = {
    workspace: {
      title: t('onboarding.guideWorkspaceTitle', 'One workspace for everything'),
      body: t(
        'onboarding.guideWorkspaceBody',
        'A workspace groups your projects and their settings. You can rename it or add more workspaces later.',
      ),
    },
    project: {
      title: t('onboarding.guideProjectTitle', 'Projects keep their own storage'),
      body: t(
        'onboarding.guideProjectBody',
        "Each project stores its data in Adham's own storage, isolated from other projects. You can add more projects at any time.",
      ),
    },
    ready: {
      title: t('onboarding.guideReadyTitle', "You're set to start"),
      body: t(
        'onboarding.guideReadyBody',
        'Your workspace and first project are selected. Sessions start the first time you send a message.',
      ),
    },
  }[step];
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <p className="text-base font-semibold text-foreground">{copy.title}</p>
        <p className="text-sm leading-relaxed text-foreground-secondary">{copy.body}</p>
      </div>
      <ShowcaseMock step={step} />
    </div>
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
 * First-run journey surface, rendered inside the app's default Context
 * card as a full-context page: a guide column (step rail + per-step
 * showcase) beside a form column with the inputs. Composition only — the
 * phase/step model lives in the model hook, each step is its own
 * component, and a storage blocker or load failure replaces the form
 * content until an explicit retry succeeds. The language selector sits in
 * the page header, available before anything is created. Narrow windows
 * stack the columns; the guide column keeps the rail above the form.
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
      <div className="flex shrink-0 items-center justify-end border-b border-border-subtle px-6 py-3">
        <LanguageSelect />
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto md:flex-row md:overflow-hidden">
        {/* Guide column: progress rail + showcase for the current step. */}
        <section className="flex flex-col gap-8 border-b border-border-subtle p-8 md:w-1/2 md:shrink-0 md:overflow-y-auto md:border-b-0 md:border-e">
          <StepRail current={api.step} />
          <StepShowcase step={api.step} />
        </section>
        {/* Form column: the inputs and actions for the current step. */}
        <section className="flex flex-1 flex-col justify-center p-8 md:overflow-y-auto">
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
        </section>
      </div>
    </div>
  );
}
