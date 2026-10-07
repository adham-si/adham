import * as React from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { MessageCard } from '@adham/ui';
import { Shell, Context, Titlebar, NavRail, Sidebar, Panel } from '@/widgets/shell';

export const Route = createFileRoute('/')({
  component: IndexComponent,
});

function IndexComponent() {
  return (
    <Shell
      titlebar={<Titlebar />}
      navRail={<NavRail />}
      sidebar={<Sidebar />}
      panel={<Panel />}
    >
      <Context />
    </Shell>
  );
}
