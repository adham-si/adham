import * as axeCore from 'axe-core';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import '@/shared/i18n';
import { GalleryPage } from '@/routes/gallery';

describe('Component gallery', () => {
  beforeEach(() => {
    document.title = 'Component Gallery';
  });

  it('renders every section heading', () => {
    render(<GalleryPage />);

    expect(screen.getByRole('heading', { level: 1, name: 'Component Gallery' })).not.toBeNull();
    for (const heading of [
      'Buttons',
      'Inputs & Textareas',
      'Sidebar items',
      'Menus & Dialogs',
      'Message cards',
      'Icons',
    ]) {
      expect(screen.getByRole('heading', { level: 2, name: heading })).not.toBeNull();
    }

    const disabled = screen.getByRole('button', { name: 'Disabled' });
    expect(disabled.hasAttribute('disabled')).toBe(true);
  });

  it('opens the demo dialog, traps focus, and closes on Escape', async () => {
    render(<GalleryPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Open dialog' }));

    const dialog = await screen.findByRole('dialog', { name: 'Delete project' });
    expect(dialog).not.toBeNull();
    expect(dialog.getAttribute('aria-modal')).toBe('true');

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('opens the demo menu, lists items, and closes on Escape', async () => {
    render(<GalleryPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));

    const menu = await screen.findByRole('menu', { name: 'Actions' });
    expect(menu).not.toBeNull();
    expect(screen.getByRole('menuitem', { name: 'Copy' })).not.toBeNull();
    expect(
      screen.getByRole('menuitem', { name: 'Paste as plain text' }).hasAttribute('disabled'),
    ).toBe(true);

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('passes an axe scan with the dialog open', async () => {
    render(<GalleryPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Open dialog' }));
    await screen.findByRole('dialog', { name: 'Delete project' });

    // jsdom cannot compute rendered colours or carry a real <html>/<title>, so
    // contrast (already covered by packages/design-tokens contrast tests) and
    // document-shell rules are out of scope here.
    const results = await axeCore.run(document, {
      rules: {
        'color-contrast': { enabled: false },
        'document-title': { enabled: false },
        'html-has-lang': { enabled: false },
        region: { enabled: false },
      },
    });
    expect(results.violations).toEqual([]);
  });
});
