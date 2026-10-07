import * as React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { ThemeProvider } from '@/theme/theme-provider';
import '@/shared/i18n';
import { ShellLayoutProvider, useShellLayout } from '@/widgets/shell/layout-context';
import { SettingsPage } from './settings-page';

function TestSettingsWrapper({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <ShellLayoutProvider>
        {children}
        <SettingsPage />
      </ShellLayoutProvider>
    </ThemeProvider>
  );
}

describe('SettingsPage Component', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('renders settings dialog when openSettings is triggered and dismisses on close button', () => {
    function Trigger() {
      const { openSettings } = useShellLayout();
      return (
        <button type="button" onClick={() => openSettings()}>
          Open Settings Trigger
        </button>
      );
    }

    render(
      <TestSettingsWrapper>
        <Trigger />
      </TestSettingsWrapper>,
    );

    // Dialog is initially closed
    expect(screen.queryByRole('dialog')).toBeNull();

    // Trigger open
    fireEvent.click(screen.getByText('Open Settings Trigger'));

    // Dialog is now open
    expect(screen.getByRole('dialog')).not.toBeNull();
    expect(screen.getAllByText('Preferences').length).toBeGreaterThanOrEqual(1);

    // Close button dismisses dialog
    const closeBtn = screen.getByRole('button', { name: 'Close settings' });
    fireEvent.click(closeBtn);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('switches settings pages and displays page content', () => {
    function Trigger() {
      const { openSettings } = useShellLayout();
      return (
        <button type="button" onClick={() => openSettings('preferences')}>
          Open
        </button>
      );
    }

    render(
      <TestSettingsWrapper>
        <Trigger />
      </TestSettingsWrapper>,
    );

    fireEvent.click(screen.getByText('Open'));

    // Switch to AI Models page
    const modelsPageBtn = screen.getByRole('button', { name: /^AI Models/i });
    fireEvent.click(modelsPageBtn);
    expect(screen.getByText('Available Models')).not.toBeNull();

    // Switch to AI Providers page
    const providersPageBtn = screen.getByRole('button', { name: /^AI Providers/i });
    fireEvent.click(providersPageBtn);
    expect(screen.getByText('Anthropic')).not.toBeNull();

    // Switch to Security page
    const secPageBtn = screen.getByRole('button', { name: /^Security/i });
    fireEvent.click(secPageBtn);
    expect(screen.getByText('Security & Governance')).not.toBeNull();

    // Switch to MCP page
    const mcpPageBtn = screen.getByRole('button', { name: /^MCP/i });
    fireEvent.click(mcpPageBtn);
    expect(screen.getByText('Servers to use with Adham')).not.toBeNull();

    // Switch to Routing page
    const routingPageBtn = screen.getByRole('button', { name: /^Routing/i });
    fireEvent.click(routingPageBtn);
    expect(screen.getByText('Dispatch policy')).not.toBeNull();

    // Switch to Budget page
    const budgetPageBtn = screen.getByRole('button', { name: /^Budget/i });
    fireEvent.click(budgetPageBtn);
    expect(screen.getByText('Spend guardrails')).not.toBeNull();

    // Switch to Usage page
    const usagePageBtn = screen.getByRole('button', { name: /^Usage/i });
    fireEvent.click(usagePageBtn);
    expect(screen.getByText('Model utilization')).not.toBeNull();

    // Switch to About page
    const aboutPageBtn = screen.getByRole('button', { name: /^About/i });
    fireEvent.click(aboutPageBtn);
    expect(screen.getByText('Application details')).not.toBeNull();
  });

  it('filters settings pages list based on search input', () => {
    function Trigger() {
      const { openSettings } = useShellLayout();
      return (
        <button type="button" onClick={() => openSettings()}>
          Open
        </button>
      );
    }

    render(
      <TestSettingsWrapper>
        <Trigger />
      </TestSettingsWrapper>,
    );

    fireEvent.click(screen.getByText('Open'));

    const searchInput = screen.getByPlaceholderText('Search settings');
    fireEvent.change(searchInput, { target: { value: 'Budget' } });

    const categoriesAside = screen.getByLabelText('Settings Categories');
    expect(within(categoriesAside).getByText('Budget')).not.toBeNull();
    expect(within(categoriesAside).queryByText('Preferences')).toBeNull();
  });
});
