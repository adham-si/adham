import * as React from 'react';
import { createRootRoute, Outlet } from '@tanstack/react-router';
import { ThemeProvider } from '@/theme/theme-provider';
import { PlatformProvider } from '@/shared/platform';

export const Route = createRootRoute({
  component: RootComponent,
});

function RootComponent() {
  return (
    <ThemeProvider>
      <PlatformProvider>
        <Outlet />
      </PlatformProvider>
    </ThemeProvider>
  );
}
