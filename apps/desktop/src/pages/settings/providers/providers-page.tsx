import * as React from 'react';
import { Button } from '@adham/ui';
import { HugeiconsIcon } from '@hugeicons/react';
import {
  AiArtIcon,
  ServerStack03Icon,
  CloudIcon,
  GlobalSearchIcon,
  CpuIcon,
  Database01Icon,
} from '@hugeicons/core-free-icons';

export function ProvidersPage() {
  const [tab, setTab] = React.useState<'all' | 'configured'>('all');

  const providers = [
    {
      id: 'ollama',
      name: 'Ollama',
      desc: 'Local daemon on localhost:11434 with zero network telemetry.',
      icon: <HugeiconsIcon icon={ServerStack03Icon} />,
      status: 'active',
      buttonText: 'Connected',
    },
    {
      id: 'anthropic',
      name: 'Anthropic',
      desc: 'Claude 3.5 Sonnet and Haiku with prompt caching.',
      icon: <HugeiconsIcon icon={AiArtIcon} />,
      status: 'available',
      buttonText: 'Connect',
    },
    {
      id: 'openai',
      name: 'OpenAI',
      desc: 'GPT-4o, o3-mini, and advanced reasoning models.',
      icon: <HugeiconsIcon icon={CloudIcon} />,
      status: 'available',
      buttonText: 'Connect',
    },
    {
      id: 'openrouter',
      name: 'OpenRouter',
      desc: 'Unified gateway routing across 200+ global models.',
      icon: <HugeiconsIcon icon={GlobalSearchIcon} />,
      status: 'available',
      buttonText: 'Connect',
    },
    {
      id: 'groq',
      name: 'Groq',
      desc: 'Ultra-low latency LPU inference for fast code completions.',
      icon: <HugeiconsIcon icon={CpuIcon} />,
      status: 'available',
      buttonText: 'Connect',
    },
    {
      id: 'vllm',
      name: 'vLLM / LM Studio',
      desc: 'Custom local OpenAI-compatible inference server.',
      icon: <HugeiconsIcon icon={Database01Icon} />,
      status: 'available',
      buttonText: 'Connect',
    },
  ];

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div>
        <h2 className="text-xl font-bold tracking-tight text-foreground">AI Providers</h2>
        <p className="text-xs text-foreground-secondary mt-1">
          Configure model inference engines, local endpoints, and credential vaults.{' '}
          <span className="text-action cursor-pointer hover:underline">Learn more</span>
        </p>
      </div>

      {/* Pill sub-tabs */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setTab('all')}
          className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
            tab === 'all'
              ? 'bg-surface-muted text-foreground'
              : 'text-foreground-secondary hover:text-foreground hover:bg-surface-hover'
          }`}
        >
          All providers
        </button>
        <button
          type="button"
          onClick={() => setTab('configured')}
          className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
            tab === 'configured'
              ? 'bg-surface-muted text-foreground'
              : 'text-foreground-secondary hover:text-foreground hover:bg-surface-hover'
          }`}
        >
          Configured
        </button>
      </div>

      {/* Section Header with Action */}
      <div className="flex items-center justify-between pt-1">
        <h3 className="text-sm font-semibold text-foreground">Inference backends</h3>
        <Button size="sm" variant="primary">
          + Add custom endpoint
        </Button>
      </div>

      {/* 2-Column Grid (Image 2 style) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
        {providers.map((p) => {
          const isConnected = p.status === 'active';
          return (
            <div
              key={p.id}
              className="flex items-center justify-between rounded-lg p-2.5 transition-colors hover:bg-surface-subtle"
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-surface-subtle text-foreground [&_svg]:size-icon-sm">
                  {p.icon}
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-foreground truncate">{p.name}</div>
                  <div className="text-xs text-foreground-secondary truncate max-w-[180px] sm:max-w-[220px]">
                    {p.desc}
                  </div>
                </div>
              </div>
              <Button
                size="sm"
                variant={isConnected ? 'secondary' : 'secondary'}
                className="ms-3 shrink-0"
              >
                {p.buttonText}
              </Button>
            </div>
          );
        })}
      </div>

      {/* Footer security note */}
      <div className="pt-2 text-xs text-foreground-secondary">
        API credentials are encrypted locally with Windows DPAPI / Keychain.{' '}
        <span className="text-action cursor-pointer hover:underline">
          Credential management policy →
        </span>
      </div>
    </div>
  );
}
