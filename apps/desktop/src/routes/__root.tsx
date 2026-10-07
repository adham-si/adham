import * as React from 'react';
import { createRootRoute, Outlet } from '@tanstack/react-router';
import { ThemeProvider } from '@/theme/theme-provider';
import { ShellLayoutProvider } from '@/widgets/shell/layout-context';
import { SettingsModal } from '@/widgets/settings';

export const Route = createRootRoute({
  component: RootComponent,
});

function RootComponent() {
  return (
    <ThemeProvider>
      <ShellLayoutProvider>
        <div className="flex h-screen w-screen overflow-hidden bg-background text-foreground">
          <Outlet />
          <SettingsModal />
        </div>
      </ShellLayoutProvider>
    </ThemeProvider>
  );
}
