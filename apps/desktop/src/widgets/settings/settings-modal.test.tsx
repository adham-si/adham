import * as React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { ThemeProvider } from '../../theme/theme-provider';
import '../../shared/i18n';
import { ShellLayoutProvider, useShellLayout } from '../shell/layout-context';
import { SettingsModal } from './settings-modal';

function TestSettingsWrapper({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <ShellLayoutProvider>
        {children}
        <SettingsModal />
      </ShellLayoutProvider>
    </ThemeProvider>
  );
}

describe('SettingsModal Widget', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('renders modal when openSettings is triggered and dismisses on close button', () => {
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

    // Modal is initially closed
    expect(screen.queryByRole('dialog')).toBeNull();

    // Trigger open
    fireEvent.click(screen.getByText('Open Settings Trigger'));

    // Modal is now open
    expect(screen.getByRole('dialog')).not.toBeNull();
    expect(screen.getAllByText('Appearance & Language').length).toBeGreaterThanOrEqual(1);

    // Close button dismisses modal
    const closeBtn = screen.getByRole('button', { name: 'Close settings' });
    fireEvent.click(closeBtn);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('switches tabs and displays tab content', () => {
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

    // Switch to Models tab
    const modelsTab = screen.getByRole('button', { name: /Models & Providers/i });
    fireEvent.click(modelsTab);
    expect(screen.getByText('Ollama Local Engine')).not.toBeNull();

    // Switch to Privacy tab
    const privacyTab = screen.getByRole('button', { name: /Privacy & Data/i });
    fireEvent.click(privacyTab);
    expect(screen.getByText('Strict Enforcement')).not.toBeNull();
  });

  it('filters tabs based on search input', () => {
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
