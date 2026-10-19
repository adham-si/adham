import * as React from 'react';
import { render, screen, fireEvent, within, cleanup } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@/theme/theme-provider';
import '@/shared/i18n';
import { ShellLayoutProvider, useShellLayout } from '@/widgets/shell';
import { SettingsPage } from './settings-page';

function TestSettingsWrapper({ children }: { children: React.ReactNode }) {
  // Mirrors the production tree (QueryProvider → ThemeProvider): preference
  // controls read the backend-authoritative snapshot through react-query.
  const [client] = React.useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
      }),
  );
  return (
    <QueryClientProvider client={client}>
      <ThemeProvider>
        <ShellLayoutProvider>
          {children}
          <SettingsPage />
        </ShellLayoutProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

describe('SettingsPage Component', () => {
  beforeEach(() => {
    cleanup();
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

  it('shows only supported pages and falls back for hidden ids', () => {
    function Trigger() {
      const { openSettings } = useShellLayout();
      return (
        <button type="button" onClick={() => openSettings('models')}>
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

    // Visible surface: Preferences, Data, About — and the Delivery A
    // provider pages (Models + Providers) now have a real backend.
    const categoriesAside = screen.getByLabelText('Settings Categories');
    expect(within(categoriesAside).getByText('Preferences')).not.toBeNull();
    expect(within(categoriesAside).getByText('Data')).not.toBeNull();
    expect(within(categoriesAside).getByText('About')).not.toBeNull();
    expect(within(categoriesAside).getByText('AI Models')).not.toBeNull();
    expect(within(categoriesAside).getByText('AI Providers')).not.toBeNull();
    for (const hidden of ['Routing', 'MCP', 'Skills', 'Plugins', 'Security', 'Budget', 'Usage']) {
      expect(within(categoriesAside).queryByText(hidden)).toBeNull();
    }

    // A visible id renders its page: the working Ollama section is here.
    expect(
      screen.getByText(
        'Manage models discovered from your connected providers. Enable or favorite models to make them available in chat.',
      ),
    ).not.toBeNull();
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

    // Hidden pages are excluded from search: nothing usable-looking remains.
    const categoriesAside = screen.getByLabelText('Settings Categories');
    expect(within(categoriesAside).queryByText('Budget')).toBeNull();
    expect(within(categoriesAside).queryByText('Preferences')).toBeNull();

    fireEvent.change(searchInput, { target: { value: 'Data' } });
    expect(within(categoriesAside).getByText('Data')).not.toBeNull();

    fireEvent.change(searchInput, { target: { value: 'providers' } });
    expect(within(categoriesAside).getByText('AI Providers')).not.toBeNull();
  });
});
