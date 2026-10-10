import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  resolvePlatform,
  getPlatform,
  isMac,
  isWindows,
  isLinux,
  setPlatformForTesting,
  setAmbientForTesting,
  getLayoutConfig,
  createPlatformInfo,
} from './platform';

describe('Platform Abstraction Layer', () => {
  beforeEach(() => {
    setPlatformForTesting(null);
    setAmbientForTesting(null);
  });

  afterEach(() => {
    setPlatformForTesting(null);
    setAmbientForTesting(null);
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

    it('correctly configures unknown platform without defaulting to Windows captions', () => {
      setPlatformForTesting('unknown');
      const info = getPlatform();

      expect(info.os).toBe('unknown');
      expect(info.isMac).toBe(false);
      expect(info.isWindows).toBe(false);
      expect(info.isLinux).toBe(false);

      // Unknown platform must NOT show custom caption controls
      expect(info.layout.hasNativeTitlebarControls).toBe(false);
      expect(info.layout.showCustomCaptionControls).toBe(false);
      expect(info.layout.trafficLightClearanceClass).toBe('');
      expect(info.layout.titlebarStartPaddingClass).toBe('ps-2');
    });

    it('retains backend architecture when set', () => {
      setPlatformForTesting('macos', 'aarch64');
      const info = getPlatform();

      expect(info.os).toBe('macos');
      expect(info.arch).toBe('aarch64');
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

      const unknownInfo = resolvePlatform('unknown');
      expect(unknownInfo.layout.showCustomCaptionControls).toBe(false);
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

    it('suppresses custom window controls for unknown platform', () => {
      const config = getLayoutConfig('unknown');
      expect(config.showCustomCaptionControls).toBe(false);
      expect(config.hasNativeTitlebarControls).toBe(false);
      expect(config.trafficLightClearanceClass).toBe('');
    });
  });

  describe('Collision-Safe Toolbar Loading and Error States', () => {
    it('applies collision-safe traffic-light clearance during loading state on macOS host', () => {
      setAmbientForTesting(true);
      const info = resolvePlatform();

      expect(info.status).toBe('loading');
      expect(info.isMac).toBe(true);
      expect(info.layout.hasNativeTitlebarControls).toBe(true);
      expect(info.layout.trafficLightClearanceClass).toBe('pl-20');
      expect(info.layout.showCustomCaptionControls).toBe(false);
    });

    it('maintains collision-safe traffic-light clearance during error state on macOS host', () => {
      setAmbientForTesting(true);
      const testError = new Error('IPC timeout');
      const info = createPlatformInfo('unknown', '', 'error', testError);

      expect(info.status).toBe('error');
      expect(info.error).toBe(testError);
      expect(info.isMac).toBe(true);
      expect(info.layout.hasNativeTitlebarControls).toBe(true);
      expect(info.layout.trafficLightClearanceClass).toBe('pl-20');
      expect(info.layout.showCustomCaptionControls).toBe(false);
    });

    it('suppresses both traffic-light clearance and custom captions during loading state on non-macOS host', () => {
      setAmbientForTesting(false);
      const info = resolvePlatform();

      expect(info.status).toBe('loading');
      expect(info.isMac).toBe(false);
      expect(info.layout.hasNativeTitlebarControls).toBe(false);
      expect(info.layout.trafficLightClearanceClass).toBe('');
      expect(info.layout.showCustomCaptionControls).toBe(false);
    });
  });
});
