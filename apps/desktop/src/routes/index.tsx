import { createFileRoute } from '@tanstack/react-router';
import { Shell, Context, Titlebar, NavRail, Sidebar, Panel } from '@/widgets/shell';
import { ConversationPanel } from '@/features/conversation/conversation-panel';
import { SettingsPage } from '@/pages/settings';

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
      overlays={<SettingsPage />}
    >
      <Context>
        <ConversationPanel />
      </Context>
    </Shell>
  );
}
