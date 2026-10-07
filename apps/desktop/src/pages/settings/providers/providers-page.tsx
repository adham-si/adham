import * as React from 'react';
import { Button } from '@adham/ui';

export function ProvidersPage() {
  const providers = [
    {
      id: 'ollama',
      name: 'Ollama',
      type: 'Local Engine',
      endpoint: 'http://localhost:11434',
      status: 'Connected',
      active: true,
    },
    {
      id: 'anthropic',
      name: 'Anthropic',
      type: 'Cloud API',
      endpoint: 'https://api.anthropic.com',
      status: 'Not Configured',
      active: false,
    },
    {
      id: 'openai',
      name: 'OpenAI',
      type: 'Cloud API',
      endpoint: 'https://api.openai.com',
      status: 'Not Configured',
      active: false,
    },
    {
      id: 'openrouter',
      name: 'OpenRouter',
      type: 'Unified Cloud Gateway',
      endpoint: 'https://openrouter.ai/api',
      status: 'Not Configured',
      active: false,
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-base font-semibold text-foreground">AI Providers</h3>
        <p className="text-xs text-foreground-secondary">
          Configure model inference providers, local endpoints, and credential vaults.
        </p>
      </div>

      {/* Provider List */}
      <div className="space-y-3">
        {providers.map((p) => (
          <div
            key={p.id}
            className="flex items-center justify-between rounded-lg border border-border-subtle bg-surface-subtle p-4"
          >
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-foreground">{p.name}</span>
                <span className="text-[11px] text-foreground-secondary">({p.type})</span>
                {p.active && (
                  <span className="flex items-center gap-1 rounded bg-success-surface px-1.5 py-0.5 text-[10px] text-success-foreground font-medium">
                    <span className="size-1.5 rounded-full bg-success" />
                    {p.status}
                  </span>
                )}
              </div>
              <div className="font-mono text-[11px] text-foreground-muted">{p.endpoint}</div>
            </div>

            <div>
              <Button size="sm" variant={p.active ? 'secondary' : 'secondary'}>
                {p.active ? 'Configure' : 'Connect'}
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
