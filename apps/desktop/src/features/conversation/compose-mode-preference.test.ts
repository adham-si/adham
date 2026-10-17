import { beforeEach, describe, expect, it } from 'vitest';
import { readComposeModePreference, writeComposeModePreference } from './compose-mode-preference';

const MODE_KEY = 'adham:compose:mode';

beforeEach(() => {
  localStorage.clear();
});

describe('compose mode preference', () => {
  it('round-trips a restorable mode', () => {
    expect(readComposeModePreference()).toBeNull();
    writeComposeModePreference('code');
    expect(readComposeModePreference()).toBe('code');
  });

  it('never restores execute and ignores junk values', () => {
    localStorage.setItem(MODE_KEY, 'execute');
    expect(readComposeModePreference()).toBeNull();
    localStorage.setItem(MODE_KEY, 'yolo');
    expect(readComposeModePreference()).toBeNull();
  });

  it('refuses to persist execute', () => {
    writeComposeModePreference('execute');
    expect(localStorage.getItem(MODE_KEY)).toBeNull();
  });
});
