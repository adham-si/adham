import * as React from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@adham/ui';
import { HugeiconsIcon } from '@hugeicons/react';
import {
  PuzzleIcon,
  GitBranchIcon,
  SourceCodeIcon,
  TerminalIcon,
  ShieldIcon,
  ComputerIcon,
} from '@hugeicons/core-free-icons';

export function PluginsPage() {
  const { t } = useTranslation();
  const [tab, setTab] = React.useState<'installed' | 'discover'>('installed');

  const plugins = [
    {
      id: 'core-tools',
      name: 'Adham Core Tools',
      desc: 'Foundational workspace bridge and execution primitives.',
      icon: <HugeiconsIcon icon={PuzzleIcon} />,
      status: 'active',
      buttonText: 'Installed',
    },
    {
      id: 'git-bridge',
      name: 'Git Automation',
      desc: 'Commit graph inspection, branch switching, and safe staging.',
      icon: <HugeiconsIcon icon={GitBranchIcon} />,
      status: 'available',
      buttonText: 'Enable',
    },
    {
      id: 'linter-sync',
      name: 'Diagnostic Bridge',
      desc: 'Live Oxlint and Biome compiler diagnostic synchronization.',
      icon: <HugeiconsIcon icon={SourceCodeIcon} />,
      status: 'active',
      buttonText: 'Installed',
    },
    {
      id: 'terminal-runner',
      name: 'Terminal Sandbox',
      desc: 'Isolated shell execution with strict parameter vetting.',
      icon: <HugeiconsIcon icon={TerminalIcon} />,
      status: 'available',
      buttonText: 'Enable',
    },
    {
      id: 'docker-env',
      name: 'Container Bridge',
      desc: 'Ephemeral Docker test environment orchestration.',
      icon: <HugeiconsIcon icon={ComputerIcon} />,
      status: 'available',
      buttonText: 'Enable',
    },
    {
      id: 'security-guard',
      name: 'Signature Verifier',
      desc: 'Cryptographic package verification and trust enforcement.',
      icon: <HugeiconsIcon icon={ShieldIcon} />,
      status: 'active',
      buttonText: 'Active',
    },
  ];

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div>
        <h2 className="text-xl font-bold tracking-tight text-foreground">
          {t('settings.extensions.plugins', { defaultValue: 'Plugins' })}
        </h2>
        <p className="text-xs text-foreground-secondary mt-1">
          Manage isolated plugin packages, verified digital signatures, and process sandboxing.{' '}
          <span className="text-action cursor-pointer hover:underline">Learn more</span>
        </p>
      </div>

      {/* Pill sub-tabs */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setTab('installed')}
          className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
            tab === 'installed'
              ? 'bg-surface-muted text-foreground'
              : 'text-foreground-secondary hover:text-foreground hover:bg-surface-hover'
          }`}
        >
          Installed plugins
        </button>
        <button
          type="button"
          onClick={() => setTab('discover')}
          className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
            tab === 'discover'
              ? 'bg-surface-muted text-foreground'
              : 'text-foreground-secondary hover:text-foreground hover:bg-surface-hover'
          }`}
        >
          Discover plugins
        </button>
      </div>

      {/* Section Header with Action */}
      <div className="flex items-center justify-between pt-1">
        <h3 className="text-sm font-semibold text-foreground">Verified extensions</h3>
        <Button size="sm" variant="primary">
          + Install plugin
        </Button>
      </div>

      {/* 2-Column Grid (Image 2 style) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
        {plugins.map((plugin) => (
          <div
            key={plugin.id}
            className="flex items-center justify-between rounded-lg p-2.5 transition-colors hover:bg-surface-subtle"
          >
            <div className="flex items-center gap-3 min-w-0">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-surface-subtle text-foreground [&_svg]:size-icon-sm">
                {plugin.icon}
              </div>
              <div className="min-w-0">
                <div className="text-sm font-semibold text-foreground truncate">{plugin.name}</div>
                <div className="text-xs text-foreground-secondary truncate max-w-[180px] sm:max-w-[220px]">
                  {plugin.desc}
                </div>
              </div>
            </div>
            <Button size="sm" variant="secondary" className="ms-3 shrink-0">
              {plugin.buttonText}
            </Button>
          </div>
        ))}
      </div>

      {/* Footer security note */}
      <div className="pt-2 text-xs text-foreground-secondary">
        All plugins execute in separate OS processes with isolated IPC channels.{' '}
        <span className="text-action cursor-pointer hover:underline">
          Security architecture guide →
        </span>
      </div>
    </div>
  );
}
