import * as React from 'react';
import { createRootRoute, Outlet } from '@tanstack/react-router';
import { ThemeProvider } from '@/theme/theme-provider';

export const Route = createRootRoute({
  component: RootComponent,
});

function RootComponent() {
  return (
    <ThemeProvider>
      <div className="flex min-h-screen flex-col bg-background text-foreground">
        <Outlet />
      </div>
    </ThemeProvider>
  );
}
