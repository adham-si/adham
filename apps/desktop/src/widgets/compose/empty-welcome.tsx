import * as React from 'react';

export interface EmptyWelcomeProps {
  onSelectPrompt?: ((prompt: string) => void) | undefined;
  className?: string | undefined;
}

export function EmptyWelcome({ className = '' }: EmptyWelcomeProps) {
  return (
    <div className={`flex flex-col items-center justify-center p-8 select-none ${className}`}>
      <div className="flex size-16 items-center justify-center rounded-2xl bg-selection shadow-xs transition-transform hover:scale-105">
        <span className="text-3xl font-bold text-accent" role="img" aria-label="Adham logo">
          🐎
        </span>
      </div>
    </div>
  );
}
