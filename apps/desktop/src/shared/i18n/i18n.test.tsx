import { describe, it, expect, afterEach } from 'vitest';
import * as React from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import i18n from './index';
import { Composer } from '@/widgets/compose';

/**
 * Runtime i18n & RTL integration verification:
 * - Confirms that switching language to 'ar' updates the active i18n instance,
 *   document.documentElement.lang ('ar'), and document.documentElement.dir ('rtl').
 * - Validates that React UI components receive Arabic localized strings.
 * - Confirms clean restoration of 'en' and 'ltr' direction without state pollution.
 */
describe('i18n live runtime integration', () => {
  afterEach(async () => {
    cleanup();
    await i18n.changeLanguage('en');
  });

  it('activates Arabic, updates language, document lang, and document dir', async () => {
    await i18n.changeLanguage('ar');

    expect(i18n.language).toBe('ar');
    expect(document.documentElement.lang).toBe('ar');
    expect(document.documentElement.dir).toBe('rtl');
    expect(i18n.t('appName')).toBe('أدهم');
    expect(i18n.t('compose.placeholder')).toBe('اكتب رسالة أو تعليمة...');
    expect(i18n.t('rail.compose')).toBe('إنشاء');
  });

  it('renders localized Arabic text and updates html dir to rtl in DOM', async () => {
    await i18n.changeLanguage('ar');

    expect(i18n.language).toBe('ar');
    expect(document.documentElement.lang).toBe('ar');
    expect(document.documentElement.dir).toBe('rtl');

    render(<Composer inputText="" onChangeInput={() => {}} onSubmit={() => {}} status="idle" />);

    // Verify Arabic placeholder from messages.json
    expect(screen.getByPlaceholderText('اكتب رسالة أو تعليمة...')).not.toBeNull();
    // Verify Arabic mode labels
    expect(screen.getByText('سؤال')).not.toBeNull();
    expect(screen.getByText('خطة')).not.toBeNull();
    expect(screen.getByText('تنفيذ')).not.toBeNull();
    expect(screen.getByText('برمجة')).not.toBeNull();
  });

  it('restores English LTR properly', async () => {
    await i18n.changeLanguage('en');

    expect(i18n.language).toBe('en');
    expect(document.documentElement.lang).toBe('en');
    expect(document.documentElement.dir).toBe('ltr');
    expect(i18n.t('appName')).toBe('Adham');
    expect(i18n.t('compose.placeholder')).toBe('Type a message or instruction...');
  });
});
