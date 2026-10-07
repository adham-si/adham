import * as React from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@adham/ui';
import { HugeiconsIcon } from '@hugeicons/react';
import {
  AiDrawingIcon,
  SourceCodeIcon,
  ShieldIcon,
  GlobalSearchIcon,
  Database01Icon,
  FileCodeIcon,
} from '@hugeicons/core-free-icons';

export function SkillsPage() {
  const { t } = useTranslation();
  const [tab, setTab] = React.useState<'active' | 'discover'>('active');

  const skills = [
    {
      id: 'refactor',
      name: 'Code Modernizer',
      desc: 'Automated syntax modernization and architectural pattern alignment.',
      icon: <HugeiconsIcon icon={SourceCodeIcon} />,
      status: 'active',
      buttonText: 'Active',
    },
    {
      id: 'test-gen',
      name: 'Test Generator',
      desc: 'Vitest and unit test generation strictly against design contracts.',
      icon: <HugeiconsIcon icon={FileCodeIcon} />,
      status: 'active',
      buttonText: 'Active',
    },
    {
      id: 'research',
      name: 'Web Research',
      desc: 'Contextual web exploration with verified documentation citations.',
      icon: <HugeiconsIcon icon={GlobalSearchIcon} />,
      status: 'active',
      buttonText: 'Active',
    },
    {
      id: 'sec-audit',
      name: 'Security Audit',
      desc: 'Leak prevention, secret vetting, and dependency vulnerability scans.',
      icon: <HugeiconsIcon icon={ShieldIcon} />,
      status: 'active',
      buttonText: 'Active',
    },
    {
      id: 'db-expert',
      name: 'SQL Optimization',
      desc: 'Schema indexing, query performance tuning, and schema migration.',
      icon: <HugeiconsIcon icon={Database01Icon} />,
      status: 'available',
      buttonText: 'Enable',
    },
    {
      id: 'skill-custom',
      name: 'Agent Customizer',
      desc: 'Instruction parser for .agents/skills and global playbook configs.',
      icon: <HugeiconsIcon icon={AiDrawingIcon} />,
      status: 'active',
      buttonText: 'Active',
    },
  ];

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div>
        <h2 className="text-xl font-bold tracking-tight text-foreground">
          {t('settings.extensions.skills', { defaultValue: 'Agent Skills' })}
        </h2>
        <p className="text-xs text-foreground-secondary mt-1">
          Configure agent workflow skills, instructional playbooks, and task capabilities.{' '}
          <span className="text-action cursor-pointer hover:underline">Learn more</span>
        </p>
      </div>

      {/* Pill sub-tabs */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setTab('active')}
          className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
            tab === 'active'
              ? 'bg-surface-muted text-foreground'
              : 'text-foreground-secondary hover:text-foreground hover:bg-surface-hover'
          }`}
        >
          Active skills
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
          Discover playbooks
        </button>
      </div>

      {/* Section Header with Action */}
      <div className="flex items-center justify-between pt-1">
        <h3 className="text-sm font-semibold text-foreground">Installed Playbooks</h3>
        <Button size="sm" variant="primary">
          + Add custom skill
        </Button>
      </div>

      {/* 2-Column Grid (Image 2 style) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
        {skills.map((skill) => (
          <div
            key={skill.id}
            className="flex items-center justify-between rounded-lg p-2.5 transition-colors hover:bg-surface-subtle"
          >
            <div className="flex items-center gap-3 min-w-0">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-surface-subtle text-foreground [&_svg]:size-icon-sm">
                {skill.icon}
              </div>
              <div className="min-w-0">
                <div className="text-sm font-semibold text-foreground truncate">{skill.name}</div>
                <div className="text-xs text-foreground-secondary truncate max-w-[180px] sm:max-w-[220px]">
                  {skill.desc}
                </div>
              </div>
            </div>
            <Button size="sm" variant="secondary" className="ms-3 shrink-0">
              {skill.buttonText}
            </Button>
          </div>
        ))}
      </div>

      {/* Footer notes */}
      <div className="pt-2 text-xs text-foreground-secondary">
        Skills load automatically from <span className="font-mono">.agents/skills/</span> and{' '}
        <span className="font-mono">~/.gemini/config/skills/</span>.{' '}
        <span className="text-action cursor-pointer hover:underline">Skill authoring guide →</span>
      </div>
    </div>
  );
}
