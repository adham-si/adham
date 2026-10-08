import * as React from 'react';
import { SkillCard, type SkillItem } from './skill-card';

interface SkillsListProps {
  skills: SkillItem[];
  activeIds: Set<string>;
  onToggle: (id: string) => void;
}

export function SkillsList({ skills, activeIds, onToggle }: SkillsListProps) {
  if (skills.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border-subtle p-8 text-center">
        <p className="text-sm font-medium text-foreground">No agent skills match filter</p>
        <p className="text-xs text-foreground-secondary mt-1">
          Switch to another tab or add a new skill to your workspace.
        </p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
      {skills.map((skill) => (
        <SkillCard
          key={skill.id}
          skill={skill}
          isActive={activeIds.has(skill.id)}
          onToggle={onToggle}
        />
      ))}
    </div>
  );
}
