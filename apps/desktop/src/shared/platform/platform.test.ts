import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  resolvePlatform,
  getPlatform,
  isMac,
  isWindows,
  isLinux,
  setPlatformForTesting,
  getLayoutConfig,
} from './platform';

describe('Platform Abstraction Layer', () => {
  beforeEach(() => {
    setPlatformForTesting(null);
  });

  afterEach(() => {
    setPlatformForTesting(null);
  });

  describe('Explicit Platform Overrides', () => {
    it('correctly configures macOS platform', () => {
      setPlatformForTesting('macos');
      const info = getPlatform();

      expect(info.os).toBe('macos');
      expect(info.isMac).toBe(true);
      expect(info.isWindows).toBe(false);
      expect(info.isLinux).toBe(false);

      expect(isMac()).toBe(true);
      expect(isWindows()).toBe(false);
      expect(isLinux()).toBe(false);

      // macOS layout properties: native controls present, custom caption controls suppressed
      expect(info.layout.hasNativeTitlebarControls).toBe(true);
      expect(info.layout.showCustomCaptionControls).toBe(false);
      expect(info.layout.trafficLightClearanceClass).toBe('pl-20');
      expect(info.layout.titlebarStartPaddingClass).toBe('ps-2');
      expect(info.layout.modifierKey).toBe('meta');
      expect(info.layout.modifierSymbol).toBe('⌘');
    });

    it('correctly configures Windows platform', () => {
      setPlatformForTesting('windows');
      const info = getPlatform();

      expect(info.os).toBe('windows');
      expect(info.isMac).toBe(false);
      expect(info.isWindows).toBe(true);
      expect(info.isLinux).toBe(false);

      expect(isMac()).toBe(false);
      expect(isWindows()).toBe(true);
      expect(isLinux()).toBe(false);

      // Windows layout properties: custom caption controls enabled, native controls not assumed
      expect(info.layout.hasNativeTitlebarControls).toBe(false);
      expect(info.layout.showCustomCaptionControls).toBe(true);
      expect(info.layout.trafficLightClearanceClass).toBe('');
      expect(info.layout.titlebarStartPaddingClass).toBe('ps-2');
      expect(info.layout.modifierKey).toBe('ctrl');
      expect(info.layout.modifierSymbol).toBe('Ctrl');
    });

    it('correctly configures Linux platform', () => {
      setPlatformForTesting('linux');
      const info = getPlatform();

      expect(info.os).toBe('linux');
      expect(info.isMac).toBe(false);
      expect(info.isWindows).toBe(false);
      expect(info.isLinux).toBe(true);

      expect(info.layout.hasNativeTitlebarControls).toBe(false);
      expect(info.layout.showCustomCaptionControls).toBe(true);
      expect(info.layout.trafficLightClearanceClass).toBe('');
      expect(info.layout.titlebarStartPaddingClass).toBe('ps-2');
      expect(info.layout.modifierKey).toBe('ctrl');
      expect(info.layout.modifierSymbol).toBe('Ctrl');
    });
  });

  describe('resolvePlatform override parameter', () => {
    it('accepts explicit parameter without modifying global state', () => {
      const macInfo = resolvePlatform('macos');
      expect(macInfo.isMac).toBe(true);
      expect(macInfo.layout.showCustomCaptionControls).toBe(false);

      const winInfo = resolvePlatform('windows');
      expect(winInfo.isWindows).toBe(true);
      expect(winInfo.layout.showCustomCaptionControls).toBe(true);
    });
  });

  describe('getLayoutConfig', () => {
    it('suppresses custom window controls on macOS', () => {
      const config = getLayoutConfig('macos');
      expect(config.showCustomCaptionControls).toBe(false);
      expect(config.hasNativeTitlebarControls).toBe(true);
      expect(config.trafficLightClearanceClass).toBe('pl-20');
      expect(config.titlebarStartPaddingClass).toBe('ps-2');
    });

    it('preserves custom window controls on Windows', () => {
      const config = getLayoutConfig('windows');
      expect(config.showCustomCaptionControls).toBe(true);
      expect(config.hasNativeTitlebarControls).toBe(false);
      expect(config.trafficLightClearanceClass).toBe('');
      expect(config.titlebarStartPaddingClass).toBe('ps-2');
    });
  });
});
