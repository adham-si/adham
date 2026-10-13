import * as React from 'react';
import { useTranslation } from 'react-i18next';
import { Select, type SelectOption } from '@adham/ui';
import { HugeiconsIcon } from '@hugeicons/react';
import { ArrowDown01Icon, ArrowUp01Icon } from '@hugeicons/core-free-icons';

interface TaskRoutingSectionProps {
  codingModel: string;
  reasoningModel: string;
  visionModel: string;
  summarizationModel: string;
  onCodingModelChange: (val: string) => void;
  onReasoningModelChange: (val: string) => void;
  onVisionModelChange: (val: string) => void;
  onSummarizationModelChange: (val: string) => void;
}

export function TaskRoutingSection({
  codingModel,
  reasoningModel,
  visionModel,
  summarizationModel,
  onCodingModelChange,
  onReasoningModelChange,
  onVisionModelChange,
  onSummarizationModelChange,
}: TaskRoutingSectionProps) {
  const { t } = useTranslation();
  // Model names are identifiers and stay untranslated in every locale;
  // only the parenthetical descriptors are localized.
  const modelOptions: SelectOption[] = [
    {
      value: 'default',
      label: t('settings.routing.modelInheritDefault', 'Inherit Default (Claude 3.7 Sonnet)'),
    },
    {
      value: 'qwen-coder',
      label: `Qwen 2.5 Coder 32B (${t('settings.routing.modelDescSpecialized', 'Specialized Code')})`,
    },
    {
      value: 'codestral',
      label: `Codestral 2501 (${t('settings.routing.modelDescFim', 'FIM Synthesis')})`,
    },
    {
      value: 'deepseek-r1',
      label: `DeepSeek-R1 (${t('settings.routing.modelDescMath', 'Math & Logic')})`,
    },
    {
      value: 'o3-mini',
      label: `o3-mini (${t('settings.routing.modelDescStem', 'STEM Reasoning')})`,
    },
    {
      value: 'gemini-flash',
      label: `Gemini 2.0 Flash (${t('settings.routing.modelDescFastMultimodal', 'Fast / Multimodal')})`,
    },
    {
      value: 'gpt-4o',
      label: `GPT-4o (${t('settings.routing.modelDescGeneralist', 'Generalist Multimodal')})`,
    },
    {
      value: 'llama-local',
      label: `Llama 3.3 70B (${t('settings.routing.modelDescLocalOllama', 'Local Ollama')})`,
    },
  ];
  return (
    <section aria-labelledby="task-routing-heading" className="space-y-4">
      <div className="border-b border-border-subtle pb-2.5">
        <h3 id="task-routing-heading" className="text-sm font-semibold text-foreground">
          {t('settings.routing.taskTitle', 'Task-specific model assignment')}
        </h3>
        <p className="text-xs text-foreground-secondary mt-0.5">
          {t(
            'settings.routing.taskHint',
            'Assign specialized inference engines to specific agent harness task types (§8).',
          )}
        </p>
      </div>

      <div className="space-y-4">
        {/* Coding */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <div className="text-sm font-medium text-foreground">
              {t('settings.routing.codingLabel', 'Coding & Repository Edits')}
            </div>
            <div className="text-xs text-foreground-secondary mt-0.5">
              {t(
                'settings.routing.codingHint',
                'Fill-in-the-middle synthesis, file generation, and terminal command execution',
              )}
            </div>
          </div>
          <div className="w-full sm:w-72 shrink-0">
            <Select
              id="coding-model-select"
              size="sm"
              value={codingModel}
              options={modelOptions}
              onValueChange={onCodingModelChange}
              indicator={<HugeiconsIcon icon={ArrowDown01Icon} />}
              indicatorOpen={<HugeiconsIcon icon={ArrowUp01Icon} />}
            />
          </div>
        </div>

        {/* Deep Reasoning */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <div className="text-sm font-medium text-foreground">
              {t('settings.routing.reasoningLabel', 'Planning & Deep Reasoning')}
            </div>
            <div className="text-xs text-foreground-secondary mt-0.5">
              {t(
                'settings.routing.reasoningHint',
                'Multi-step task breakdown, invariant checks, and architectural verification',
              )}
            </div>
          </div>
          <div className="w-full sm:w-72 shrink-0">
            <Select
              id="reasoning-model-select"
              size="sm"
              value={reasoningModel}
              options={modelOptions}
              onValueChange={onReasoningModelChange}
              indicator={<HugeiconsIcon icon={ArrowDown01Icon} />}
              indicatorOpen={<HugeiconsIcon icon={ArrowUp01Icon} />}
            />
          </div>
        </div>

        {/* Vision & Documents */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <div className="text-sm font-medium text-foreground">
              {t('settings.routing.visionLabel', 'Vision & Document Analysis')}
            </div>
            <div className="text-xs text-foreground-secondary mt-0.5">
              {t(
                'settings.routing.visionHint',
                'Screenshot inspection, diagram parsing, and image artifact evaluation',
              )}
            </div>
          </div>
          <div className="w-full sm:w-72 shrink-0">
            <Select
              id="vision-model-select"
              size="sm"
              value={visionModel}
              options={modelOptions}
              onValueChange={onVisionModelChange}
              indicator={<HugeiconsIcon icon={ArrowDown01Icon} />}
              indicatorOpen={<HugeiconsIcon icon={ArrowUp01Icon} />}
            />
          </div>
        </div>

        {/* Fast Summarization */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <div className="text-sm font-medium text-foreground">
              {t('settings.routing.summaryLabel', 'Quick Summaries & Triage')}
            </div>
            <div className="text-xs text-foreground-secondary mt-0.5">
              {t(
                'settings.routing.summaryHint',
                'Session title generation, conversation memory condensation, and intent classification',
              )}
            </div>
          </div>
          <div className="w-full sm:w-72 shrink-0">
            <Select
              id="summarization-model-select"
              size="sm"
              value={summarizationModel}
              options={modelOptions}
              onValueChange={onSummarizationModelChange}
              indicator={<HugeiconsIcon icon={ArrowDown01Icon} />}
              indicatorOpen={<HugeiconsIcon icon={ArrowUp01Icon} />}
            />
          </div>
        </div>
      </div>
    </section>
  );
}
