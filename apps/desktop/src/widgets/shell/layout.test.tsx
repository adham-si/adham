import * as React from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { ThemeProvider } from '../../theme/theme-provider';
import '../../shared/i18n';
import { ShellLayoutProvider, useShellLayout } from './layout-context';
import { NavigationRail } from './navigation-rail';
import { PrimarySidebar } from './primary-sidebar';
import { ContextPanel } from './context-panel';

function TestShellWrapper({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <ShellLayoutProvider>{children}</ShellLayoutProvider>
    </ThemeProvider>
  );
}

describe('Shell Layout Components', () => {
  beforeEach(() => {
    cleanup();
    localStorage.clear();
  });
  it('NavigationRail renders destinations and responds to toggle sidebar', () => {
    function TestConsumer() {
      const { sidebarOpen } = useShellLayout();
      return (
        <div>
          <NavigationRail showIcons />
          <div data-testid="sidebar-state">{sidebarOpen ? 'open' : 'closed'}</div>
        </div>
      );
    }

    render(
      <TestShellWrapper>
        <TestConsumer />
      </TestShellWrapper>,
    );

    expect(screen.getByLabelText('Navigation Rail')).not.toBeNull();
    expect(screen.getByTestId('sidebar-state').textContent).toBe('open');

    const toggleBtn = screen.getByLabelText('Collapse sidebar');
    fireEvent.click(toggleBtn);

    expect(screen.getByTestId('sidebar-state').textContent).toBe('closed');
  });

  it('PrimarySidebar renders session list and triggers session selection', () => {
    let selectedId = '';
    const sessions = [
      { id: 'sess-1', title: 'First Session' },
      { id: 'sess-2', title: 'Second Session' },
    ];

    render(
      <TestShellWrapper>
        <PrimarySidebar
          sessions={sessions}
          activeSessionId="sess-1"
          onSelectSession={(id) => {
            selectedId = id;
          }}
        />
      </TestShellWrapper>,
    );

    expect(screen.getByText('First Session')).not.toBeNull();
    expect(screen.getByText('Second Session')).not.toBeNull();

    fireEvent.click(screen.getByText('Second Session'));
    expect(selectedId).toBe('sess-2');
  });

  it('ContextPanel switches active tab when clicked', () => {
    function TestConsumer() {
      const { setContextPanelOpen } = useShellLayout();
      React.useEffect(() => {
        setContextPanelOpen(true);
      }, [setContextPanelOpen]);

      return <ContextPanel />;
    }

    render(
      <TestShellWrapper>
        <TestConsumer />
      </TestShellWrapper>,
    );

    expect(screen.getByLabelText('Context Panel')).not.toBeNull();
    expect(screen.getByText('Execution Plan')).not.toBeNull();

    const activityTab = screen.getByRole('button', { name: /Activity/i });
    fireEvent.click(activityTab);

    expect(screen.getByText('Recent Activity')).not.toBeNull();
  });
});
