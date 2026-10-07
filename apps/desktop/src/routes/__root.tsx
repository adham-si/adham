import * as React from 'react';
import { createRootRoute, Outlet } from '@tanstack/react-router';

export const Route = createRootRoute({
  component: RootComponent,
});

function RootComponent() {
  return (
    <div className="min-h-screen bg-[var(--color-bg-canvas,#FAFAFA)] text-[var(--color-text-primary,#121214)] flex flex-col">
      <Outlet />
    </div>
  );
}
