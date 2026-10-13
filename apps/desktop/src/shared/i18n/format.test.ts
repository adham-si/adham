import { describe, expect, it } from 'vitest';
import { formatNumber, formatRelativeTime, formatTime } from './format';

describe('locale-aware formatting helpers', () => {
  it('formats integers with locale digits', () => {
    expect(formatNumber(100000, 'en')).toBe('100,000');
    // Arabic uses Arabic-Indic digits with locale grouping.
    expect(formatNumber(100000, 'ar')).toBe('١٠٠٬٠٠٠');
    expect(formatNumber(100000, 'zh-CN')).toBe('100,000');
    expect(formatNumber(100000, 'ru')).toContain('100');
  });

  it('formats clock times without throwing in every language', () => {
    const stamp = new Date('2026-10-12T16:28:00Z').getTime();
    for (const lng of ['en', 'ar', 'zh-CN', 'ru'] as const) {
      const value = formatTime(stamp, lng);
      expect(typeof value).toBe('string');
      expect(value.trim()).not.toBe('');
    }
  });

  it('renders relative "now" in English and Arabic', () => {
    const now = Date.now();
    expect(formatRelativeTime(now, now, 'en')).toMatch(/now/i);
    expect(formatRelativeTime(now, now, 'ar')).toBe('الآن');
  });

  it('renders singular/plural minutes grammatically per locale', () => {
    const now = Date.now();
    const minute = 60 * 1000;
    expect(formatRelativeTime(now - minute, now, 'en')).toBe('1 minute ago');
    // Arabic dual form is produced by the platform, not resource strings.
    expect(formatRelativeTime(now - 2 * minute, now, 'ar')).toBe('قبل دقيقتين');
    expect(formatRelativeTime(now - 5 * minute, now, 'ru')).toContain('5');
  });
});
