import * as React from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@adham/ui';
import { HugeiconsIcon } from '@hugeicons/react';
import {
  AiMagicIcon,
  CpuIcon,
  ServerStack03Icon,
  CloudIcon,
  ZapIcon,
  SparklesIcon,
} from '@hugeicons/core-free-icons';

export function ModelsPage() {
  const { t } = useTranslation();
  const [tab, setTab] = React.useState<'all' | 'local' | 'cloud'>('all');
  const [selectedModel, setSelectedModel] = React.useState('qwen2.5-coder:7b');

  const models = [
    {
      id: 'qwen2.5-coder:7b',
      name: 'qwen2.5-coder:7b',
      provider: 'Ollama Local',
      desc: '32k context • Code generation, editing, and terminal tasks.',
      icon: <HugeiconsIcon icon={ServerStack03Icon} />,
      type: 'local',
    },
    {
      id: 'llama3.2:3b',
      name: 'llama3.2:3b',
      provider: 'Ollama Local',
      desc: '8k context • Ultra-fast summaries, classification, and triage.',
      icon: <HugeiconsIcon icon={ZapIcon} />,
      type: 'local',
    },
    {
      id: 'deepseek-r1:14b',
      name: 'deepseek-r1:14b',
      provider: 'Ollama Local',
      desc: '64k context • Deep reasoning and architecture verification.',
      icon: <HugeiconsIcon icon={CpuIcon} />,
      type: 'local',
    },
    {
      id: 'claude-3-5-sonnet',
      name: 'claude-3-5-sonnet',
      provider: 'Anthropic Cloud',
      desc: '200k context • High-precision reasoning and planning.',
      icon: <HugeiconsIcon icon={SparklesIcon} />,
      type: 'cloud',
    },
    {
      id: 'gpt-4o',
      name: 'gpt-4o',
      provider: 'OpenAI Cloud',
      desc: '128k context • Multimodal intelligence and fast tool use.',
      icon: <HugeiconsIcon icon={CloudIcon} />,
      type: 'cloud',
    },
    {
      id: 'codestral',
      name: 'codestral-2501',
      provider: 'Mistral Cloud',
      desc: '256k context • Fill-in-the-middle code synthesis engine.',
      icon: <HugeiconsIcon icon={AiMagicIcon} />,
      type: 'cloud',
    },
  ];

  const filtered = models.filter((m) => {
    if (tab === 'local') return m.type === 'local';
    if (tab === 'cloud') return m.type === 'cloud';
    return true;
  });

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div>
        <h2 className="text-xl font-bold tracking-tight text-foreground">
          {t('settings.tabs.models', { defaultValue: 'AI Models' })}
        </h2>
        <p className="text-xs text-foreground-secondary mt-1">
          Configure local and remote models available for agent execution.{' '}
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
          All models
        </button>
        <button
          type="button"
          onClick={() => setTab('local')}
          className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
            tab === 'local'
              ? 'bg-surface-muted text-foreground'
              : 'text-foreground-secondary hover:text-foreground hover:bg-surface-hover'
          }`}
        >
          Local models
        </button>
        <button
          type="button"
          onClick={() => setTab('cloud')}
          className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
            tab === 'cloud'
              ? 'bg-surface-muted text-foreground'
              : 'text-foreground-secondary hover:text-foreground hover:bg-surface-hover'
          }`}
        >
          Cloud models
        </button>
      </div>

      {/* Section Header with Action */}
      <div className="flex items-center justify-between pt-1">
        <h3 className="text-sm font-semibold text-foreground">Available Models</h3>
        <Button size="sm" variant="primary">
          + Pull Ollama model
        </Button>
      </div>

      {/* 2-Column Grid (Image 2 style) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
        {filtered.map((m) => {
          const isSelected = selectedModel === m.id;
          return (
            <div
              key={m.id}
              className="flex items-center justify-between rounded-lg p-2.5 transition-colors hover:bg-surface-subtle"
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-surface-subtle text-foreground [&_svg]:size-icon-sm">
                  {m.icon}
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-foreground truncate">{m.name}</span>
                    {isSelected && (
                      <span className="rounded bg-selection px-1.5 py-0.2 text-xs font-medium text-action">
                        Active
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-foreground-secondary truncate max-w-[180px] sm:max-w-[220px]">
                    {m.desc}
                  </div>
                </div>
              </div>
              <Button
                size="sm"
                variant={isSelected ? 'secondary' : 'secondary'}
                onClick={() => setSelectedModel(m.id)}
                className="ms-3 shrink-0"
              >
                {isSelected ? 'Default' : 'Select'}
              </Button>
            </div>
          );
        })}
      </div>

      {/* Footer policy note */}
      <div className="pt-2 text-xs text-foreground-secondary">
        Local-first guarantee: Unapproved cloud crossing is strictly blocked.{' '}
        <span className="text-action cursor-pointer hover:underline">
          Routing & fallback policies →
        </span>
      </div>
    </div>
  );
}
