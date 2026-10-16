import * as React from 'react';
import { useTranslation } from 'react-i18next';
import { PreviewNote } from '../preview-note';
import { HugeiconsIcon } from '@hugeicons/react';
import {
  AiDrawingIcon,
  SourceCodeIcon,
  ShieldIcon,
  GlobalSearchIcon,
  Database01Icon,
  FileCodeIcon,
  ComputerIcon,
} from '@hugeicons/core-free-icons';
import { SkillFilterTabs, type SkillFilterTab, SkillsList, type SkillItem } from './components';

export function SkillsPage() {
  const { t } = useTranslation();
  const [tab, setTab] = React.useState<SkillFilterTab>('all');
  // No skill is active in this build: lazy skill discovery (P0-13) does not
  // exist yet, so nothing may claim to be active.
  const [activeIds, setActiveIds] = React.useState<Set<string>>(() => new Set());

  const skills: SkillItem[] = [
    {
      id: 'refactor',
      name: 'Code Modernizer',
      desc: t(
        'settings.skills.descRefactor',
        'Automate syntax upgrades, architectural refactoring, and code styling.',
      ),
      icon: <HugeiconsIcon icon={SourceCodeIcon} />,
      source: 'workspace',
      category: 'coding',
    },
    {
      id: 'test-gen',
      name: 'Test Generator',
      desc: t(
        'settings.skills.descTestGen',
        'Generate Vitest unit and integration suites against component contracts.',
      ),
      icon: <HugeiconsIcon icon={FileCodeIcon} />,
      source: 'workspace',
      category: 'testing',
    },
    {
      id: 'research',
      name: 'Web Research',
      desc: t(
        'settings.skills.descResearch',
        'Browse verified documentation, developer guides, and upstream APIs.',
      ),
      icon: <HugeiconsIcon icon={GlobalSearchIcon} />,
      source: 'global',
      category: 'research',
    },
    {
      id: 'sec-audit',
      name: 'Security Audit',
      desc: t(
        'settings.skills.descSecAudit',
        'Inspect dependencies, detect credential leaks, and enforce boundaries.',
      ),
      icon: <HugeiconsIcon icon={ShieldIcon} />,
      source: 'global',
      category: 'security',
    },
    {
      id: 'db-expert',
      name: 'SQL Optimization',
      desc: t(
        'settings.skills.descDbExpert',
        'Analyze queries, optimize database indices, and validate schemas.',
      ),
      icon: <HugeiconsIcon icon={Database01Icon} />,
      source: 'builtin',
      category: 'data',
    },
    {
      id: 'skill-custom',
      name: 'Agent Customizer',
      desc: t(
        'settings.skills.descCustom',
        'Configure custom agent behaviors, workspace rules, and prompt personas.',
      ),
      icon: <HugeiconsIcon icon={AiDrawingIcon} />,
      source: 'workspace',
      category: 'agent',
    },
    {
      id: 'data-loss',
      name: 'Data Guard',
      desc: t(
        'settings.skills.descDataLoss',
        'Prevent accidental file deletions, broad drops, and unsafe shell operations.',
      ),
      icon: <HugeiconsIcon icon={ShieldIcon} />,
      source: 'global',
      category: 'safety',
    },
    {
      id: 'data-apps',
      name: 'App Builder',
      desc: t(
        'settings.skills.descDataApps',
        'Scaffold interactive interfaces, dashboards, and UI prototypes.',
      ),
      icon: <HugeiconsIcon icon={ComputerIcon} />,
      source: 'builtin',
      category: 'frontend',
    },
  ];

  const handleToggle = (id: string) => {
    setActiveIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const filteredSkills = skills.filter((s) => {
    if (tab === 'active') return activeIds.has(s.id);
    if (tab === 'available') return !activeIds.has(s.id);
    return true;
  });

  const counts = {
    all: skills.length,
    active: activeIds.size,
    available: skills.length - activeIds.size,
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div>
        <h2 className="text-xl font-bold tracking-tight text-foreground">
          {t('settings.extensions.skills', { defaultValue: 'Agent Skills' })}
        </h2>
        <p className="text-xs text-foreground-secondary mt-1">
          {t(
            'settings.skills.desc',
            'Manage specialized workflows, instructional playbooks, and task capabilities.',
          )}
        </p>
      </div>

      <PreviewNote />

      {/* Branded Filter Tabs */}
      <SkillFilterTabs activeTab={tab} onTabChange={setTab} counts={counts} />

      {/* Section Header with Action and Notion-style separator line */}
      <section aria-labelledby="skills-heading" className="space-y-4">
        <div className="flex items-center justify-between border-b border-border-subtle pb-2.5">
          <h3 id="skills-heading" className="text-sm font-semibold text-foreground">
            {t('settings.skills.listTitle', 'Installed Playbooks')}
          </h3>
        </div>

        {/* Dynamic Skills List Grid (not connected: disabled preview) */}
        <fieldset disabled className="min-w-0 border-0 p-0 m-0">
          <SkillsList skills={filteredSkills} activeIds={activeIds} onToggle={handleToggle} />
        </fieldset>
      </section>

      {/* Footer Notes */}
      <div className="pt-2 text-xs text-foreground-secondary">
        {t('settings.skills.footerLead', { workspacePath: '.agents/skills/' })}{' '}
        <span className="text-action cursor-pointer hover:underline">
          {t('settings.skills.footerLink', 'Authoring guide →')}
        </span>
      </div>
    </div>
  );
}
