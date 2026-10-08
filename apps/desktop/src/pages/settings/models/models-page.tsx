import * as React from 'react';
import { Button } from '@adham/ui';
import { HugeiconsIcon } from '@hugeicons/react';
import { Add01Icon } from '@hugeicons/core-free-icons';
import { useTheme } from '@/theme/use-theme';
import {
  DefaultModelSection,
  ModelFilterTabs,
  type ModelFilterTab,
  ModelsList,
  type ModelItem,
} from './components';

export function ModelsPage() {
  const { resolvedAppearance } = useTheme();
  const isDark = resolvedAppearance === 'dark';

  const [tab, setTab] = React.useState<ModelFilterTab>('all');
  const [defaultModelId, setDefaultModelId] = React.useState('claude-3-7-sonnet');
  const [fallbackModelId, setFallbackModelId] = React.useState('qwen2-5-coder-7b-local');
  const [strictLocalBoundary, setStrictLocalBoundary] = React.useState(true);

  const models: ModelItem[] = [
    {
      id: 'claude-3-7-sonnet',
      name: 'Claude 3.7 Sonnet',
      provider: 'Anthropic',
      providerId: 'anthropic',
      contextWindow: '200k context',
      desc: 'High-performance reasoning, coding synthesis, and autonomous harness tasks.',
      icon: (
        <img
          src={isDark ? '/media/provider/anthropic-def.svg' : '/media/provider/anthropic-light.svg'}
          alt="Anthropic"
          className="size-5 object-contain"
        />
      ),
      type: 'cloud',
      capabilities: ['Reasoning', 'Coding', '200k'],
    },
    {
      id: 'gpt-4o',
      name: 'GPT-4o',
      provider: 'OpenAI',
      providerId: 'openai',
      contextWindow: '128k context',
      desc: 'Multimodal flagship with high-throughput tool calling and structured outputs.',
      icon: (
        <img
          src={isDark ? '/media/provider/openai-def.svg' : '/media/provider/openai-light.svg'}
          alt="OpenAI"
          className="size-5 object-contain"
        />
      ),
      type: 'cloud',
      capabilities: ['Multimodal', 'Speed', '128k'],
    },
    {
      id: 'o3-mini',
      name: 'o3-mini',
      provider: 'OpenAI',
      providerId: 'openai',
      contextWindow: '200k context',
      desc: 'Cost-efficient STEM and code reasoning with configurable effort tiers.',
      icon: (
        <img
          src={isDark ? '/media/provider/openai-def.svg' : '/media/provider/openai-light.svg'}
          alt="OpenAI"
          className="size-5 object-contain"
        />
      ),
      type: 'cloud',
      capabilities: ['Reasoning', 'STEM', '200k'],
    },
    {
      id: 'gemini-2-0-flash',
      name: 'Gemini 2.0 Flash',
      provider: 'Google',
      providerId: 'google',
      contextWindow: '1M context',
      desc: 'Sub-second multimodal intelligence with expansive 1-million-token context.',
      icon: <img src="/media/provider/google.svg" alt="Google" className="size-5 object-contain" />,
      type: 'cloud',
      capabilities: ['1M Context', 'Speed', 'Vision'],
    },
    {
      id: 'deepseek-r1',
      name: 'DeepSeek-R1',
      provider: 'DeepSeek',
      providerId: 'deepseek',
      contextWindow: '64k context',
      desc: 'Open-weight reasoning model matching frontier performance on math and code.',
      icon: (
        <img src="/media/provider/deepseek.svg" alt="DeepSeek" className="size-5 object-contain" />
      ),
      type: 'cloud',
      capabilities: ['Reasoning', 'Math', '64k'],
    },
    {
      id: 'qwen-2-5-coder-32b',
      name: 'Qwen 2.5 Coder 32B',
      provider: 'Qwen',
      providerId: 'qwen',
      contextWindow: '32k context',
      desc: 'Specialized full-repo coding model optimized for terminal agent execution.',
      icon: (
        <img
          src={isDark ? '/media/provider/qwen.svg' : '/media/provider/qwen-light.svg'}
          alt="Qwen"
          className="size-5 object-contain"
        />
      ),
      type: 'cloud',
      capabilities: ['Coding', 'Agents', '32k'],
    },
    {
      id: 'kimi-k1-5',
      name: 'Kimi k1.5',
      provider: 'Moonshot AI',
      providerId: 'moonshot',
      contextWindow: '128k context',
      desc: 'Long-context multimodal reasoning with deep document analysis and planning.',
      icon: (
        <img
          src="/media/provider/moonshot-mono.svg"
          alt="Moonshot AI"
          className="size-5 object-contain dark:brightness-0 dark:invert"
        />
      ),
      type: 'cloud',
      capabilities: ['Long Context', 'Reasoning', '128k'],
    },
    {
      id: 'codestral-2501',
      name: 'Codestral 2501',
      provider: 'Mistral AI',
      providerId: 'mistral',
      contextWindow: '256k context',
      desc: 'Fill-in-the-middle code synthesis engine supporting 80+ programming languages.',
      icon: (
        <img
          src="/media/provider/mistral-color.svg"
          alt="Mistral AI"
          className="size-5 object-contain"
        />
      ),
      type: 'cloud',
      capabilities: ['FIM', 'Coding', '256k'],
    },
    {
      id: 'llama-3-3-70b-local',
      name: 'Llama 3.3 70B',
      provider: 'Ollama Local',
      providerId: 'ollama',
      contextWindow: '128k context',
      desc: 'High-capability local weights running fully offline on localhost:11434.',
      icon: (
        <img
          src={isDark ? '/media/provider/ollama.svg' : '/media/provider/ollama-light.svg'}
          alt="Ollama"
          className="size-5 object-contain"
        />
      ),
      type: 'local',
      capabilities: ['Local', 'Offline', '128k'],
    },
    {
      id: 'deepseek-r1-14b-local',
      name: 'DeepSeek-R1 14B',
      provider: 'Ollama Local',
      providerId: 'ollama',
      contextWindow: '64k context',
      desc: 'Quantized reasoning engine with zero telemetry or network egress.',
      icon: (
        <img
          src={isDark ? '/media/provider/ollama.svg' : '/media/provider/ollama-light.svg'}
          alt="Ollama"
          className="size-5 object-contain"
        />
      ),
      type: 'local',
      capabilities: ['Local', 'Reasoning', 'Offline'],
    },
    {
      id: 'qwen2-5-coder-7b-local',
      name: 'Qwen 2.5 Coder 7B',
      provider: 'Ollama Local',
      providerId: 'ollama',
      contextWindow: '32k context',
      desc: 'Fast local coder for autocomplete, inline edits, and diff reviews.',
      icon: (
        <img
          src={isDark ? '/media/provider/ollama.svg' : '/media/provider/ollama-light.svg'}
          alt="Ollama"
          className="size-5 object-contain"
        />
      ),
      type: 'local',
      capabilities: ['Local', 'Fast', 'Coding'],
    },
    {
      id: 'nemotron-4-340b',
      name: 'Nemotron-4 340B',
      provider: 'NVIDIA AI',
      providerId: 'nvidia',
      contextWindow: '4k context',
      desc: 'Synthetic data generation and model-based verification pipeline.',
      icon: (
        <img
          src={
            isDark
              ? '/media/provider/nvidia-nemotron.svg'
              : '/media/provider/nvidia-nemotron-mono.svg'
          }
          alt="NVIDIA AI"
          className="size-5 object-contain"
        />
      ),
      type: 'cloud',
      capabilities: ['Synthetic', 'Eval', 'NIM'],
    },
  ];

  const filteredModels = models.filter((m) => {
    if (tab === 'local') return m.type === 'local';
    if (tab === 'cloud') return m.type === 'cloud';
    return true;
  });

  const counts = {
    all: models.length,
    local: models.filter((m) => m.type === 'local').length,
    cloud: models.filter((m) => m.type === 'cloud').length,
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div>
        <h2 className="text-xl font-bold tracking-tight text-foreground">AI Models</h2>
        <p className="text-xs text-foreground-secondary mt-1">
          Configure default intelligence runtimes, model parameters, and automatic fallback chains.
        </p>
      </div>

      {/* Workspace Defaults & Recovery Chain Section */}
      <DefaultModelSection
        models={models}
        defaultModelId={defaultModelId}
        fallbackModelId={fallbackModelId}
        strictLocalBoundary={strictLocalBoundary}
        onSelectDefault={setDefaultModelId}
        onSelectFallback={setFallbackModelId}
        onToggleLocalBoundary={setStrictLocalBoundary}
      />

      {/* Filter Tabs */}
      <ModelFilterTabs activeTab={tab} onTabChange={setTab} counts={counts} />

      {/* Section Header with Action and Notion-style separator line */}
      <section aria-labelledby="models-section-heading" className="space-y-4">
        <div className="flex items-center justify-between border-b border-border-subtle pb-2.5">
          <h3 id="models-section-heading" className="text-sm font-semibold text-foreground">
            Available Models
          </h3>
          <Button size="sm" variant="primary" className="[&_svg]:size-icon-sm">
            <HugeiconsIcon icon={Add01Icon} />
            <span>Add custom model</span>
          </Button>
        </div>

        {/* Dynamic Model Cards List */}
        <ModelsList
          models={filteredModels}
          defaultModelId={defaultModelId}
          fallbackModelId={fallbackModelId}
          onSetDefault={setDefaultModelId}
          onSetFallback={setFallbackModelId}
        />
      </section>

      {/* Local-first Policy Note */}
      <div className="pt-2 text-xs text-foreground-secondary">
        Local-first guarantee: When strict local boundary is enabled, requests with local models
        never cross to cloud providers without approval.
      </div>
    </div>
  );
}
