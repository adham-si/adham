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
    expect(screen.getAllByText('Appearance & Language').length).toBeGreaterThanOrEqual(1);

    // Close button dismisses dialog
    const closeBtn = screen.getByRole('button', { name: 'Close settings' });
    fireEvent.click(closeBtn);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('switches settings pages and displays page content', () => {
    function Trigger() {
      const { openSettings } = useShellLayout();
      return (
        <button type="button" onClick={() => openSettings('appearance')}>
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

    // Switch to Models page
    const modelsPageBtn = screen.getByRole('button', { name: /Models & Providers/i });
    fireEvent.click(modelsPageBtn);
    expect(screen.getByText('Ollama Local Engine')).not.toBeNull();

    // Switch to Privacy page
    const privacyPageBtn = screen.getByRole('button', { name: /Privacy & Data/i });
    fireEvent.click(privacyPageBtn);
    expect(screen.getByText('Strict Enforcement')).not.toBeNull();

    // Switch to MCP page
    const mcpPageBtn = screen.getByRole('button', { name: /Model Context Protocol/i });
    fireEvent.click(mcpPageBtn);
    expect(screen.getByText('P0-13 Governed')).not.toBeNull();

    // Switch to Routing page
    const routingPageBtn = screen.getByRole('button', { name: /Routing & Fallbacks/i });
    fireEvent.click(routingPageBtn);
    expect(screen.getByText('Deterministic Fallback Chain')).not.toBeNull();

    // Switch to Governance page
    const govPageBtn = screen.getByRole('button', { name: /Policies & Governance/i });
    fireEvent.click(govPageBtn);
    expect(screen.getByText('Mandatory Security Guardrails')).not.toBeNull();

    // Switch to Budget page
    const budgetPageBtn = screen.getByRole('button', { name: /Budget & Limits/i });
    fireEvent.click(budgetPageBtn);
    expect(screen.getByText('Token Allowances')).not.toBeNull();

    // Switch to Usage page
    const usagePageBtn = screen.getByRole('button', { name: /Usage & Analytics/i });
    fireEvent.click(usagePageBtn);
    expect(screen.getByText('Model Utilization')).not.toBeNull();

    // Switch to Info page
    const infoPageBtn = screen.getByRole('button', { name: /System Info & Diagnostics/i });
    fireEvent.click(infoPageBtn);
    expect(screen.getByText('Environment & Engine')).not.toBeNull();
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

    const searchInput = screen.getByPlaceholderText('Search settings...');
    fireEvent.change(searchInput, { target: { value: 'Storage' } });

    const categoriesAside = screen.getByLabelText('Settings Categories');
    expect(within(categoriesAside).getByText('Storage & Backup')).not.toBeNull();
    expect(within(categoriesAside).queryByText('Appearance & Language')).toBeNull();
  });
});
