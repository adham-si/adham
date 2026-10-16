import { describe, expect, it, vi } from 'vitest';
import {
  AppPreferencesSchema,
  GetPreferencesResponseSchema,
  RebuildProjectionsResponseSchema,
  UpdatePreferencesResponseSchema,
} from './schemas';
import { queryKeys } from './query-keys';
import { invoke } from '@tauri-apps/api/core';
import { AdhamApiClient, DEFAULT_PREFERENCES } from './adham-client';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));

const VALID_PREFS = {
  appearance: 'dark',
  language: 'ar',
  fontFamily: 'serif',
  fontSize: 'lg',
  highContrast: 'enabled',
  reducedMotion: 'reduce',
  enterToSend: false,
} as const;

describe('SETTINGS-01 preference IPC contracts', () => {
  it('exposes a stable preferences query key', () => {
    expect(queryKeys.preferences).toEqual(['app-preferences']);
  });

  it('parses valid preference documents and rejects out-of-allowlist values', () => {
    expect(AppPreferencesSchema.parse(VALID_PREFS).language).toBe('ar');
    expect(() => AppPreferencesSchema.parse({ ...VALID_PREFS, appearance: 'neon' })).toThrow();
    expect(() => AppPreferencesSchema.parse({ ...VALID_PREFS, language: 'xx' })).toThrow();
    expect(() => AppPreferencesSchema.parse({ ...VALID_PREFS, enterToSend: 'yes' })).toThrow();
  });

  it('ships compiled defaults matching the backend contract', () => {
    expect(AppPreferencesSchema.parse(DEFAULT_PREFERENCES).appearance).toBe('system');
    expect(DEFAULT_PREFERENCES.enterToSend).toBe(true);
  });

  it('getAppPreferences invokes the typed command and validates the response', async () => {
    vi.mocked(invoke).mockResolvedValueOnce({ preferences: VALID_PREFS, revision: 3 });
    const client = new AdhamApiClient();
    const res = await client.getAppPreferences();
    expect(invoke).toHaveBeenCalledWith('get_app_preferences');
    expect(GetPreferencesResponseSchema.parse(res).revision).toBe(3);
  });

  it('updateAppPreferences sends the document with its base revision', async () => {
    vi.mocked(invoke).mockResolvedValueOnce({ preferences: VALID_PREFS, revision: 4 });
    const client = new AdhamApiClient();
    const res = await client.updateAppPreferences({ ...VALID_PREFS }, 3);
    expect(invoke).toHaveBeenCalledWith('update_app_preferences', {
      payload: { preferences: { ...VALID_PREFS }, baseRevision: 3 },
    });
    expect(UpdatePreferencesResponseSchema.parse(res).revision).toBe(4);
  });

  it('adminRebuildProjections invokes the existing backend operation', async () => {
    vi.mocked(invoke).mockResolvedValueOnce({ replayedCount: 7 });
    const client = new AdhamApiClient();
    const res = await client.adminRebuildProjections();
    expect(invoke).toHaveBeenCalledWith('admin_rebuild_projections');
    expect(RebuildProjectionsResponseSchema.parse(res).replayedCount).toBe(7);
  });
});
