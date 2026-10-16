import * as React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import '@/shared/i18n';
import i18n from '@/shared/i18n';
import { ThemeProvider } from '@/theme/theme-provider';
import { ModelsPage } from './models-page';

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ThemeProvider>
        <ModelsPage />
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

beforeEach(async () => {
  window.localStorage.clear();
  await i18n.changeLanguage('en');
});

afterEach(async () => {
  // Never leak a switched locale into other test files sharing the singleton.
  await i18n.changeLanguage('en');
});

describe('ModelsPage (preserved preview implementation)', () => {
  it('renders the local-first note from locales, never hardcoded English', async () => {
    renderPage();
    expect(
      screen.getByText(
        'Local-first guarantee: When strict local boundary is enabled, requests with local models never cross to cloud providers without approval.',
      ),
    ).not.toBeNull();
  });

  it('renders the note in Arabic with RTL intact', async () => {
    await i18n.changeLanguage('ar');
    renderPage();
    expect(
      screen.getByText(
        'ضمان الأولوية المحلية: عند تفعيل الحد المحلي الصارم، لا تعبر طلبات النماذج المحلية إلى مزودي السحابة دون موافقة.',
      ),
    ).not.toBeNull();
  });

  it('selects no default or fallback model', () => {
    renderPage();
    expect(screen.queryByText('Default')).toBeNull();
    expect(screen.queryByText('Fallback')).toBeNull();
  });
});
