import * as React from 'react';
import { useTranslation } from 'react-i18next';
import { DispatchStrategySection, FallbackCascadesSection, TaskRoutingSection } from './components';

export function RoutingPage() {
  const { t } = useTranslation();

  // Dispatch policy state
  const [strategy, setStrategy] = React.useState('local-only');
  const [timeout, setTimeout] = React.useState('30s');
  const [autoRetry, setAutoRetry] = React.useState(true);
  const [streaming, setStreaming] = React.useState(true);

  // Fallback cascades state
  const [promptCloud, setPromptCloud] = React.useState(true);
  const [maxCascades, setMaxCascades] = React.useState('2');

  // Task-specific models state
  const [codingModel, setCodingModel] = React.useState('qwen-coder');
  const [reasoningModel, setReasoningModel] = React.useState('deepseek-r1');
  const [visionModel, setVisionModel] = React.useState('gemini-flash');
  const [summarizationModel, setSummarizationModel] = React.useState('default');

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div>
        <h2 className="text-xl font-bold tracking-tight text-foreground">
          {t('settings.routing.title', { defaultValue: 'Routing & Fallbacks' })}
        </h2>
        <p className="text-xs text-foreground-secondary mt-1">
          {t('settings.routing.desc', {
            defaultValue:
              'Configure model dispatch policies, latency optimization, and fallback cascades.',
          })}
        </p>
      </div>

      {/* Dispatch Policy Section */}
      <DispatchStrategySection
        strategy={strategy}
        timeout={timeout}
        autoRetry={autoRetry}
        streaming={streaming}
        onStrategyChange={setStrategy}
        onTimeoutChange={setTimeout}
        onAutoRetryChange={setAutoRetry}
        onStreamingChange={setStreaming}
      />

      {/* Fallback Cascades Section */}
      <FallbackCascadesSection
        promptCloud={promptCloud}
        maxCascades={maxCascades}
        onPromptCloudChange={setPromptCloud}
        onMaxCascadesChange={setMaxCascades}
      />

      {/* Task-Specific Routing Section */}
      <TaskRoutingSection
        codingModel={codingModel}
        reasoningModel={reasoningModel}
        visionModel={visionModel}
        summarizationModel={summarizationModel}
        onCodingModelChange={setCodingModel}
        onReasoningModelChange={setReasoningModel}
        onVisionModelChange={setVisionModel}
        onSummarizationModelChange={setSummarizationModel}
      />

      {/* Footer Note */}
      <div className="pt-2 text-xs text-foreground-secondary">
        Autonomous routing guarantee: Adham honors your workspace privacy baseline and never
        silently charges or escalates beyond configured boundaries.
      </div>
    </div>
  );
}
