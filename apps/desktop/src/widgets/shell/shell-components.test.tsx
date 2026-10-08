import * as React from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { ThemeProvider } from '@/theme/theme-provider';
import '@/shared/i18n';
import {
  ShellLayoutProvider,
  useShellLayout,
  SHELL_DIMENSIONS,
} from './context';
import { NavRail } from './nav-rail';
import { Titlebar } from './titlebar';
import { Sidebar } from './sidebar';
import { PrimarySidebar } from './primary-sidebar';
import { SecondarySidebar } from './secondary-sidebar';
import { Panel } from './panel';
import { AppLayout, ShellWrapper, Shell } from './shell-wrapper';

function TestWrapper({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <ShellLayoutProvider>{children}</ShellLayoutProvider>
    </ThemeProvider>
  );
}

describe('Shell Layout Modular Components', () => {
  beforeEach(() => {
    cleanup();
    localStorage.clear();
  });

  describe('Shell Dimensions Constants', () => {
    it('defines expected dimension constraints', () => {
      expect(SHELL_DIMENSIONS.navRailWidth).toBe(40);
      expect(SHELL_DIMENSIONS.headerHeight).toBe(40);
      expect(SHELL_DIMENSIONS.minSidebarWidth).toBe(272);
      expect(SHELL_DIMENSIONS.maxSidebarWidth).toBe(600);
      expect(SHELL_DIMENSIONS.minSecondarySidebarWidth).toBe(272);
      expect(SHELL_DIMENSIONS.maxSecondarySidebarWidth).toBe(600);
      expect(SHELL_DIMENSIONS.minPanelWidth).toBe(272);
      expect(SHELL_DIMENSIONS.maxPanelWidth).toBe(960);
    });
  });

  describe('NavRail Component', () => {
    it('renders 40px width rail and responds to actions', () => {
      render(
        <TestWrapper>
          <NavRail />
        </TestWrapper>,
      );

      const rail = screen.getByLabelText('Navigation Rail');
      expect(rail).not.toBeNull();
      expect(rail.style.width).toBe('40px');
      expect(screen.getByRole('button', { name: 'Workspace' })).not.toBeNull();
      expect(screen.getByRole('button', { name: 'Settings' })).not.toBeNull();
    });
  });

  describe('Sidebar & SecondarySidebar Components', () => {
    it('renders base Sidebar within min 272px and max 600px', () => {
      render(
        <Sidebar ariaLabel="Test Sidebar">
          <div>Sidebar Body</div>
        </Sidebar>,
      );

      const aside = screen.getByLabelText('Test Sidebar');
      expect(aside).not.toBeNull();
      expect(aside.style.minWidth).toBe('272px');
      expect(aside.style.maxWidth).toBe('600px');
      expect(screen.getByText('Sidebar Body')).not.toBeNull();
    });

    it('renders SecondarySidebar within min 272px and max 600px', () => {
      function Consumer() {
        const { setSecondarySidebarOpen } = useShellLayout();
        React.useEffect(() => {
          setSecondarySidebarOpen(true);
        }, [setSecondarySidebarOpen]);

        return (
          <SecondarySidebar title="Files Explorer">
            <div>Files content</div>
          </SecondarySidebar>
        );
      }

      render(
        <TestWrapper>
          <Consumer />
        </TestWrapper>,
      );

      const secAside = screen.getByLabelText('Secondary Sidebar');
      expect(secAside).not.toBeNull();
      expect(secAside.style.minWidth).toBe('272px');
      expect(secAside.style.maxWidth).toBe('600px');
      expect(screen.getByText('Files Explorer')).not.toBeNull();
      expect(screen.getByText('Files content')).not.toBeNull();
    });

    it('exposes and coordinates both PrimarySidebar and SecondarySidebar via composite Sidebar', () => {
      render(
        <TestWrapper>
          <Sidebar />
        </TestWrapper>,
      );

      const primary = screen.getByLabelText('Primary Sidebar');
      const secondary = screen.getByLabelText('Secondary Sidebar');
      expect(primary).not.toBeNull();
      expect(secondary).not.toBeNull();
      expect(primary.style.minWidth).toBe('272px');
      expect(primary.style.maxWidth).toBe('600px');
      expect(secondary.style.minWidth).toBe('272px');
      expect(secondary.style.maxWidth).toBe('600px');
    });
  });

  describe('Panel Component', () => {
    it('renders Panel within min 272px and max 600px', () => {
      function Consumer() {
        const { setContextPanelOpen } = useShellLayout();
        React.useEffect(() => {
          setContextPanelOpen(true);
        }, [setContextPanelOpen]);

        return <Panel title="Inspector Panel" />;
      }

      render(
        <TestWrapper>
          <Consumer />
        </TestWrapper>,
      );

      const panel = screen.getByLabelText('Context Panel');
      expect(panel).not.toBeNull();
      expect(panel.style.minWidth).toBe('272px');
      expect(panel.style.maxWidth).toBe('960px');
      expect(screen.getByText('Inspector Panel')).not.toBeNull();
    });
  });

  describe('Shell & AppLayout Wrapper', () => {
    it('renders cleanly with default main header configuration', () => {
      render(
        <AppLayout
          data-testid="app-shell"
          navRail={<div data-testid="slot-rail" />}
          primarySidebar={<div data-testid="slot-primary" />}
          secondarySidebar={<div data-testid="slot-secondary" />}
          header={<div data-testid="slot-header" />}
          panel={<div data-testid="slot-panel" />}
          overlays={<div data-testid="slot-overlays" />}
        >
          <div data-testid="slot-main">Main View</div>
        </AppLayout>,
      );

      expect(screen.getByTestId('app-shell')).not.toBeNull();
      expect(screen.getByTestId('slot-rail')).not.toBeNull();
      expect(screen.getByTestId('slot-primary')).not.toBeNull();
      expect(screen.getByTestId('slot-secondary')).not.toBeNull();
      expect(screen.getByTestId('slot-header')).not.toBeNull();
      expect(screen.getByTestId('slot-panel')).not.toBeNull();
      expect(screen.getByTestId('slot-overlays')).not.toBeNull();
      expect(screen.getByTestId('slot-main').textContent).toBe('Main View');
    });

    it('renders only provided slots and supports full-width header', () => {
      render(
        <AppLayout
          data-testid="app-shell-custom"
          config={{
            headerPosition: 'full-width',
          }}
          header={<div data-testid="slot-header" />}
        >
          <div>Isolated Main</div>
        </AppLayout>,
      );

      expect(screen.getByTestId('app-shell-custom')).not.toBeNull();
      expect(screen.getByTestId('slot-header')).not.toBeNull();
      expect(screen.queryByTestId('slot-rail')).toBeNull();
      expect(screen.queryByTestId('slot-primary')).toBeNull();
      expect(screen.queryByTestId('slot-panel')).toBeNull();
      expect(screen.getByText('Isolated Main')).not.toBeNull();
    });

    it('toggles navigation rail visibility via Titlebar nav rail toggle button', () => {
      render(
        <TestWrapper>
          <Shell
            data-testid="app-shell"
            titlebar={<Titlebar />}
            navRail={<div data-testid="slot-rail">Rail Content</div>}
          >
            <div>Main View</div>
          </Shell>
        </TestWrapper>,
      );

      // Initially open
      expect(screen.getByTestId('slot-rail')).not.toBeNull();
      const toggleButton = screen.getByRole('button', { name: 'Hide navigation rail' });
      expect(toggleButton).not.toBeNull();

      // Click to hide
      fireEvent.click(toggleButton);
      expect(screen.queryByTestId('slot-rail')).toBeNull();
      expect(screen.getByRole('button', { name: 'Show navigation rail' })).not.toBeNull();

      // Click to open again
      fireEvent.click(screen.getByRole('button', { name: 'Show navigation rail' }));
      expect(screen.getByTestId('slot-rail')).not.toBeNull();
      expect(screen.getByRole('button', { name: 'Hide navigation rail' })).not.toBeNull();
    });

    it('toggles primary sidebar, panel, and secondary sidebar via Titlebar layout buttons', () => {
      render(
        <TestWrapper>
          <Shell
            data-testid="app-shell"
            titlebar={<Titlebar />}
            primarySidebar={<div data-testid="slot-primary">Primary Content</div>}
            secondarySidebar={<div data-testid="slot-secondary">Secondary Content</div>}
            panel={<div data-testid="slot-panel">Panel Content</div>}
          >
            <div>Main View</div>
          </Shell>
        </TestWrapper>,
      );

      // Verify toggles and separator rendered
      const primaryBtn = screen.getByRole('button', { name: 'Hide primary sidebar' });
      const panelBtn = screen.getByRole('button', { name: 'Hide panel' });
      const secondaryBtn = screen.getByRole('button', { name: 'Hide secondary sidebar' });
      expect(primaryBtn).not.toBeNull();
      expect(panelBtn).not.toBeNull();
      expect(secondaryBtn).not.toBeNull();

      // Toggle primary sidebar
      fireEvent.click(primaryBtn);
      expect(screen.queryByTestId('slot-primary')).toBeNull();
      expect(screen.getByRole('button', { name: 'Show primary sidebar' })).not.toBeNull();

      // Toggle panel
      fireEvent.click(panelBtn);
      expect(screen.queryByTestId('slot-panel')).toBeNull();
      expect(screen.getByRole('button', { name: 'Show panel' })).not.toBeNull();

      // Toggle secondary sidebar
      fireEvent.click(secondaryBtn);
      expect(screen.queryByTestId('slot-secondary')).toBeNull();
      expect(screen.getByRole('button', { name: 'Show secondary sidebar' })).not.toBeNull();
    });
  });
});

