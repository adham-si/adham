import * as React from 'react';
import { Button } from '@adham/ui';
import { HugeiconsIcon } from '@hugeicons/react';
import { Add01Icon } from '@hugeicons/core-free-icons';
import { useTheme } from '@/theme/use-theme';
import {
  ProviderFilterTabs,
  type ProviderFilterTab,
  ProvidersList,
  type ProviderItem,
} from './components';

export function ProvidersPage() {
  const { resolvedAppearance } = useTheme();
  const isDark = resolvedAppearance === 'dark';

  const [tab, setTab] = React.useState<ProviderFilterTab>('all');
  const [connectedIds, setConnectedIds] = React.useState<Set<string>>(() => new Set(['ollama']));

  // Provider company entities using provider logos from public/media/provider/
  const providers: ProviderItem[] = [
    {
      id: 'ollama',
      name: 'Ollama',
      desc: 'Local Llama 3.3, DeepSeek-R1, and Qwen 2.5 with zero network egress.',
      icon: (
        <img
          src={isDark ? '/media/provider/ollama.svg' : '/media/provider/ollama-light.svg'}
          alt="Ollama"
          className="size-5 object-contain"
        />
      ),
      category: 'local',
    },
    {
      id: 'openai',
      name: 'OpenAI',
      desc: 'GPT-4o, o1, o3-mini, and Realtime API.',
      icon: (
        <img
          src={isDark ? '/media/provider/openai-def.svg' : '/media/provider/openai-light.svg'}
          alt="OpenAI"
          className="size-5 object-contain"
        />
      ),
      category: 'cloud',
    },
    {
      id: 'anthropic',
      name: 'Anthropic',
      desc: 'Claude 3.7 Sonnet, Claude 3.5 Sonnet, and Claude 3.5 Haiku.',
      icon: (
        <img
          src={isDark ? '/media/provider/anthropic-def.svg' : '/media/provider/anthropic-light.svg'}
          alt="Anthropic"
          className="size-5 object-contain"
        />
      ),
      category: 'cloud',
    },
    {
      id: 'google',
      name: 'Google',
      desc: 'Gemini 2.0 Flash, Gemini 2.0 Pro, and Gemini 1.5 Pro.',
      icon: <img src="/media/provider/google.svg" alt="Google" className="size-5 object-contain" />,
      category: 'cloud',
    },
    {
      id: 'deepseek',
      name: 'DeepSeek',
      desc: 'DeepSeek-R1, DeepSeek-V3, and DeepSeek Coder.',
      icon: (
        <img src="/media/provider/deepseek.svg" alt="DeepSeek" className="size-5 object-contain" />
      ),
      category: 'cloud',
    },
    {
      id: 'moonshot',
      name: 'Moonshot AI',
      desc: 'Kimi k1.5, Kimi k0-math, and Moonshot long-context reasoning.',
      icon: (
        <img
          src="/media/provider/moonshot-mono.svg"
          alt="Moonshot AI"
          className="size-5 object-contain dark:brightness-0 dark:invert"
        />
      ),
      category: 'cloud',
    },
    {
      id: 'qwen',
      name: 'Qwen',
      desc: 'Qwen 2.5-Max, Qwen 2.5-Coder 32B, and QwQ-32B.',
      icon: (
        <img
          src={isDark ? '/media/provider/qwen.svg' : '/media/provider/qwen-light.svg'}
          alt="Qwen"
          className="size-5 object-contain"
        />
      ),
      category: 'cloud',
    },
    {
      id: 'nvidia',
      name: 'NVIDIA AI',
      desc: 'Nemotron-4 340B, Llama 3.1 Nemotron-70B, and NIM microservices.',
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
      category: 'cloud',
    },
    {
      id: 'opencode',
      name: 'OpenCode',
      desc: 'Local and remote coding agent engine with ACP protocols.',
      icon: (
        <img
          src="/media/provider/opencode.svg"
          alt="OpenCode"
          className="size-5 object-contain dark:brightness-0 dark:invert"
        />
      ),
      category: 'local',
    },
    {
      id: 'mistral',
      name: 'Mistral AI',
      desc: 'Mistral Large 2, Codestral 2501, and Pixtral 12B.',
      icon: (
        <img
          src="/media/provider/mistral-color.svg"
          alt="Mistral AI"
          className="size-5 object-contain"
        />
      ),
      category: 'cloud',
    },
    {
      id: 'xai',
      name: 'xAI',
      desc: 'Grok 2, Grok 3, and real-time reasoning completions.',
      icon: (
        <img
          src={isDark ? '/media/provider/xai-grok.svg' : '/media/provider/xai-grok-light.svg'}
          alt="xAI"
          className="size-5 object-contain"
        />
      ),
      category: 'cloud',
    },
    {
      id: 'aws-bedrock',
      name: 'AWS Bedrock',
      desc: 'Claude 3.7 Sonnet, Amazon Nova Pro, and Llama 3.3 via AWS IAM.',
      icon: (
        <img
          src="/media/provider/bedrock-aws.svg"
          alt="AWS Bedrock"
          className="size-5 object-contain"
        />
      ),
      category: 'cloud',
    },
    {
      id: 'cloudflare',
      name: 'Cloudflare Workers AI',
      desc: 'Cloudflare Workers AI running Llama 3.3, Mistral, and Whisper.',
      icon: (
        <img
          src={isDark ? '/media/provider/cloudflare.svg' : '/media/provider/cloudflare-mono.svg'}
          alt="Cloudflare Workers AI"
          className="size-5 object-contain"
        />
      ),
      category: 'cloud',
    },
    {
      id: 'vercel',
      name: 'Vercel AI',
      desc: 'Vercel AI SDK, AI Gateway routing, and edge inference.',
      icon: (
        <img
          src="/media/provider/vercel.svg"
          alt="Vercel AI"
          className="size-5 object-contain invert dark:invert-0"
        />
      ),
      category: 'cloud',
    },
    {
      id: 'openrouter',
      name: 'OpenRouter',
      desc: 'Unified multi-model gateway routing across 200+ global models.',
      icon: (
        <img
          src="/media/provider/openrouter.svg"
          alt="OpenRouter"
          className="size-5 object-contain invert dark:invert-0"
        />
      ),
      category: 'cloud',
    },
    {
      id: 'minimax',
      name: 'MiniMax',
      desc: 'MiniMax-01, Hailuo, and text-to-video multimodal models.',
      icon: (
        <img
          src={isDark ? '/media/provider/minimax.svg' : '/media/provider/minimax-mono.svg'}
          alt="MiniMax"
          className="size-5 object-contain"
        />
      ),
      category: 'cloud',
    },
    {
      id: 'vllm',
      name: 'vLLM / Self-Hosted',
      desc: 'Private self-hosted OpenAI-compatible inference servers.',
      icon: <img src="/media/provider/vllm.svg" alt="vLLM" className="size-5 object-contain" />,
      category: 'local',
    },
  ];

  const handleToggleConnect = (id: string) => {
    setConnectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const filteredProviders = providers.filter((p) => {
    if (tab === 'configured') return connectedIds.has(p.id);
    return true;
  });

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div>
        <h2 className="text-xl font-bold tracking-tight text-foreground">AI Providers</h2>
        <p className="text-xs text-foreground-secondary mt-1">
          Connect local runtimes and cloud model providers to use across your workspace.
        </p>
      </div>

      {/* Filter Tabs */}
      <ProviderFilterTabs
        activeTab={tab}
        onTabChange={setTab}
        configuredCount={connectedIds.size}
        totalCount={providers.length}
      />

      {/* Section Header with Action and Notion-style separator line */}
      <section aria-labelledby="providers-section-heading" className="space-y-4">
        <div className="flex items-center justify-between border-b border-border-subtle pb-2.5">
          <h3 id="providers-section-heading" className="text-sm font-semibold text-foreground">
            Providers
          </h3>
          <Button size="sm" variant="primary" className="[&_svg]:size-icon-sm">
            <HugeiconsIcon icon={Add01Icon} />
            <span>Add provider</span>
          </Button>
        </div>

        {/* Dynamic Provider Cards List */}
        <ProvidersList
          providers={filteredProviders}
          connectedIds={connectedIds}
          onToggleConnect={handleToggleConnect}
        />
      </section>
    </div>
  );
}
