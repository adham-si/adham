import { useTranslation } from 'react-i18next';
import type { OnboardingStep } from '../model/use-onboarding';

const STEP_ORDER: OnboardingStep[] = ['workspace', 'project', 'ready'];

/// Vertical numbered progress stepper: a filled numbered circle per step
/// with connecting lines between them, solid up to the current step.
/// Doubles as the journey's list landmark (`Setup steps`).
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
    <ol aria-label={t('onboarding.stepsLabel', 'Setup steps')} className="flex flex-col gap-2.5">
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
            className="relative flex items-center gap-3"
          >
            {index < STEP_ORDER.length - 1 && (
              <span
                aria-hidden="true"
                className={`absolute start-[15px] top-8 h-2.5 w-px ${
                  index < currentIndex ? 'bg-selection' : 'bg-border-subtle'
                }`}
              />
            )}
            <span
              className={`flex size-8 shrink-0 items-center justify-center rounded-full border text-xs ${circle}`}
            >
              {index + 1}
            </span>
            <span className={`text-sm ${label}`}>
              {labels[step]}
              <span className="sr-only">{` — ${status}`}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/// Per-step showcase art: geometry only, no text, so it needs no
/// translation and cannot be mistaken for real data. Motion uses built-in
/// Tailwind animations, disabled under reduced-motion preferences.
function ShowcaseArt({ step }: { step: OnboardingStep }) {
  const card = 'fill-surface stroke-border-subtle';
  const inner = 'fill-surface-subtle stroke-border-subtle';
  const bar = 'fill-foreground-muted/50';
  const motion = 'motion-reduce:animate-none';
  return (
    <svg
      viewBox="0 0 200 132"
      aria-hidden="true"
      className="w-full max-w-[260px] overflow-visible text-border-subtle"
    >
      {step === 'workspace' && (
        <>
          <circle cx="100" cy="66" r="56" fill="none" stroke="currentColor" strokeDasharray="3 7" />
          <g className={`animate-spin [animation-duration:16s] ${motion}`}>
            <circle cx="100" cy="10" r="3" className="fill-selection" />
          </g>
          <rect x="52" y="34" width="96" height="64" rx="10" className={card} strokeWidth="1.5" />
          <rect x="64" y="46" width="30" height="5" rx="2.5" className={bar} />
          <rect x="64" y="60" width="72" height="14" rx="4" className={inner} strokeWidth="1" />
          <rect x="64" y="80" width="72" height="10" rx="4" className={inner} strokeWidth="1" />
        </>
      )}
      {step === 'project' && (
        <>
          <rect x="26" y="30" width="68" height="72" rx="10" className={card} strokeWidth="1.5" />
          <rect x="106" y="30" width="68" height="72" rx="10" className={card} strokeWidth="1.5" />
          <line
            x1="100"
            y1="22"
            x2="100"
            y2="110"
            stroke="currentColor"
            className={`stroke-selection animate-pulse [animation-duration:3.5s] ${motion}`}
            strokeWidth="1.5"
            strokeDasharray="4 7"
          />
          <rect x="38" y="44" width="26" height="5" rx="2.5" className={bar} />
          <rect x="38" y="58" width="44" height="8" rx="3" className={inner} strokeWidth="1" />
          <rect x="38" y="72" width="36" height="8" rx="3" className={inner} strokeWidth="1" />
          <rect x="118" y="44" width="26" height="5" rx="2.5" className={bar} />
          <rect x="118" y="58" width="44" height="8" rx="3" className={inner} strokeWidth="1" />
        </>
      )}
      {step === 'ready' && (
        <>
          <circle
            cx="100"
            cy="66"
            r="40"
            className={`fill-selection/10 animate-pulse [animation-duration:3.5s] ${motion}`}
          />
          <circle
            cx="100"
            cy="66"
            r="26"
            className="fill-selection/25 stroke-selection"
            strokeWidth="1.5"
          />
          <path
            d="M89 66 l8 8 16-18"
            fill="none"
            className="stroke-action"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </>
      )}
    </svg>
  );
}

/**
 * Guide column of the journey: the numbered step stepper plus the current
 * step's showcase (short complementary copy and animated art). The form
 * column owns the actionable copy and inputs.
 */
export function GuideColumn({ step }: { step: OnboardingStep }) {
  const { t } = useTranslation();
  const copy = {
    workspace: {
      title: t('onboarding.guideWorkspaceTitle', 'One workspace for everything'),
      body: t(
        'onboarding.guideWorkspaceBody',
        'Projects and settings live together here. Rename this one, or add more any time.',
      ),
    },
    project: {
      title: t('onboarding.guideProjectTitle', 'A home for each project'),
      body: t(
        'onboarding.guideProjectBody',
        'Each one keeps its own storage, isolated from the rest.',
      ),
    },
    ready: {
      title: t('onboarding.guideReadyTitle', "You're set to start"),
      body: t(
        'onboarding.guideReadyBody',
        'Your workspace and first project are selected. Sessions start with your first message.',
      ),
    },
  }[step];
  return (
    <section className="flex flex-col gap-8 border-b border-border-subtle p-8 md:w-1/2 md:shrink-0 md:overflow-y-auto md:border-b-0 md:border-e">
      <StepStepper current={step} />
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-1.5">
          <p className="text-base font-semibold text-foreground">{copy.title}</p>
          <p className="text-sm leading-relaxed text-foreground-secondary">{copy.body}</p>
        </div>
        <ShowcaseArt step={step} />
      </div>
    </section>
  );
}
