import { useTranslation } from 'react-i18next';
import type { OnboardingStep } from '../model/use-onboarding';
import { HorseMascot } from './horse-mascot';

const STEP_ORDER: OnboardingStep[] = ['workspace', 'project', 'ready'];

/// Horizontal numbered progress rail: a filled numbered circle per step
/// with connecting lines between them, solid up to the current step, laid
/// out across the full guide column width. Doubles as the journey's list
/// landmark (`Setup steps`).
function StepStepper({ current }: { current: OnboardingStep }) {
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
    <ol aria-label={t('onboarding.stepsLabel', 'Setup steps')} className="flex w-full items-center">
      {STEP_ORDER.map((step, index) => {
        const status =
          index === currentIndex ? statuses[0] : index < currentIndex ? statuses[1] : statuses[2];
        const circle =
          index === currentIndex
            ? 'border-transparent bg-selection text-action font-semibold'
            : index < currentIndex
              ? 'border-border-subtle bg-surface-subtle text-foreground-secondary'
              : 'border-border-subtle text-foreground-muted';
        const label =
          index === currentIndex
            ? 'font-medium text-foreground'
            : index < currentIndex
              ? 'text-foreground-secondary'
              : 'text-foreground-muted';
        return (
          <li
            key={step}
            aria-current={index === currentIndex ? 'step' : undefined}
            className="flex min-w-0 flex-1 items-center gap-2.5"
          >
            <span
              className={`flex size-8 shrink-0 items-center justify-center rounded-full border text-xs ${circle}`}
            >
              {index + 1}
            </span>
            <span className={`truncate text-sm ${label}`}>
              {labels[step]}
              <span className="sr-only">{` — ${status}`}</span>
            </span>
            {index < STEP_ORDER.length - 1 && (
              <span
                aria-hidden="true"
                className={`h-px min-w-3 flex-1 ${
                  index < currentIndex ? 'bg-action' : 'bg-border-subtle'
                }`}
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}

/**
 * Guide column of the journey: the full-width numbered step rail above the
 * mascot stage, whose art fills the column. The form column owns all
 * actionable copy and inputs.
 */
export function GuideColumn({ step }: { step: OnboardingStep }) {
  return (
    <section className="flex flex-col gap-8 border-b border-border-subtle p-8 md:w-1/2 md:shrink-0 md:overflow-y-auto md:border-b-0 md:border-e">
      <StepStepper current={step} />
      <div className="flex min-h-0 flex-1 items-center justify-center">
        <HorseMascot />
      </div>
    </section>
  );
}
