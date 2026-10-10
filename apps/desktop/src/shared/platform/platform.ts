import * as React from 'react';
import { adhamClient } from '@/shared/api/adham-client';
import type { PlatformInfo, PlatformLayoutConfig, PlatformOs, PlatformStatus } from './types';

let testPlatformOverride: PlatformOs | null = null;
let testArchOverride: string | null = null;
let testAmbientIsMacOverride: boolean | null = null;

/**
 * Configure ambient macOS detection override for tests.
 * Pass `null` to reset to browser/navigator ambient check.
 */
export function setAmbientForTesting(isMac: boolean | null): void {
  testAmbientIsMacOverride = isMac;
}

export function detectAmbientIsMac(): boolean {
  if (testAmbientIsMacOverride !== null) {
    return testAmbientIsMacOverride;
  }
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return false;
  }
  const navAny = navigator as unknown as { userAgentData?: { platform?: string } };
  const platformHint = navAny.userAgentData?.platform?.toLowerCase();
  if (platformHint && platformHint.includes('mac')) return true;

  const navPlatform = (navigator.platform || '').toLowerCase();
  if (navPlatform.includes('mac')) return true;

  const userAgent = (navigator.userAgent || '').toLowerCase();
  return userAgent.includes('macintosh') || userAgent.includes('mac os');
}

/**
 * Configure a test override for platform detection.
 * Pass `null` to reset to ambient/backend detection.
 */
export function setPlatformForTesting(override: PlatformOs | null, arch: string = 'x86_64'): void {
  testPlatformOverride = override;
  testArchOverride = override ? arch : null;
  cachedPlatformInfo = override ? createPlatformInfo(override, arch, 'resolved') : null;
}

export function getLayoutConfig(os: PlatformOs): PlatformLayoutConfig {
  const isMac = os === 'macos';
  const isWindows = os === 'windows';
  const isLinux = os === 'linux';

  return {
    // Explicitly false for 'unknown' or during initial loading: NO Windows captions by default!
    showCustomCaptionControls: isWindows || isLinux,
    hasNativeTitlebarControls: isMac,
    // 80px (pl-20) physical left clearance ensures macOS traffic lights never collide in either LTR or RTL
    trafficLightClearanceClass: isMac ? 'pl-20' : '',
    titlebarStartPaddingClass: 'ps-2',
    modifierKey: isMac ? 'meta' : 'ctrl',
    modifierSymbol: isMac ? '⌘' : 'Ctrl',
  };
}

export function createPlatformInfo(
  os: PlatformOs,
  arch: string = '',
  status: PlatformStatus = 'resolved',
  error?: Error | null,
): PlatformInfo {
  // Collision-safe clearance: When host is ambient macOS and platform is still loading
  // or in error/unknown state, ensure traffic-light clearance is preserved to prevent
  // toolbar items from colliding with native overlay controls.
  const isAmbientMac = testPlatformOverride === null && detectAmbientIsMac();
  const isMac = os === 'macos' || (os === 'unknown' && isAmbientMac);
  const isWindows = os === 'windows';
  const isLinux = os === 'linux';

  return {
    os,
    arch,
    status,
    isMac,
    isWindows,
    isLinux,
    layout: getLayoutConfig(isMac ? 'macos' : os),
    error: error ?? null,
  };
}

let cachedPlatformInfo: PlatformInfo | null = null;

/**
 * Resolve the current platform information synchronously.
 * If not yet resolved via IPC and no override is present, returns an 'unknown' loading state.
 */
export function resolvePlatform(override?: PlatformOs | null): PlatformInfo {
  if (override !== undefined && override !== null) {
    return createPlatformInfo(override, testArchOverride ?? 'x86_64', 'resolved');
  }
  if (testPlatformOverride) {
    return createPlatformInfo(testPlatformOverride, testArchOverride ?? 'x86_64', 'resolved');
  }
  if (cachedPlatformInfo) {
    return cachedPlatformInfo;
  }
  // Initial fallback before IPC resolution: 'unknown' in 'loading' state
  // Notice layout has showCustomCaptionControls: false — NO Windows-caption default!
  return createPlatformInfo('unknown', '', 'loading');
}

export function getPlatform(): PlatformInfo {
  return resolvePlatform();
}

export const PlatformContext = React.createContext<PlatformInfo | null>(null);

export function PlatformProvider({ children }: { children: React.ReactNode }) {
  const [platformState, setPlatformState] = React.useState<PlatformInfo>(() => {
    if (testPlatformOverride) {
      return createPlatformInfo(testPlatformOverride, testArchOverride ?? 'x86_64', 'resolved');
    }
    return cachedPlatformInfo ?? createPlatformInfo('unknown', '', 'loading');
  });

  React.useEffect(() => {
    if (testPlatformOverride) {
      const state = createPlatformInfo(
        testPlatformOverride,
        testArchOverride ?? 'x86_64',
        'resolved',
      );
      cachedPlatformInfo = state;
      setPlatformState(state);
      return;
    }

    let isMounted = true;

    async function loadPlatform() {
      try {
        const raw = await adhamClient.getPlatformInfo();
        if (!isMounted) return;

        const os: PlatformOs =
          raw.os === 'macos'
            ? 'macos'
            : raw.os === 'windows'
              ? 'windows'
              : raw.os === 'linux'
                ? 'linux'
                : 'unknown';

        const state = createPlatformInfo(os, raw.arch, 'resolved');
        cachedPlatformInfo = state;
        setPlatformState(state);
      } catch (err) {
        if (!isMounted) return;
        // In case of error, set error state with unknown platform
        // showCustomCaptionControls remains false!
        const state = createPlatformInfo(
          'unknown',
          '',
          'error',
          err instanceof Error ? err : new Error(String(err)),
        );
        cachedPlatformInfo = state;
        setPlatformState(state);
      }
    }

    loadPlatform();

    return () => {
      isMounted = false;
    };
  }, []);

  return React.createElement(PlatformContext.Provider, { value: platformState }, children);
}

export function usePlatform(): PlatformInfo {
  const context = React.useContext(PlatformContext);
  if (context) {
    return context;
  }
  return getPlatform();
}

export function isMac(): boolean {
  return getPlatform().isMac;
}

export function isWindows(): boolean {
  return getPlatform().isWindows;
}

export function isLinux(): boolean {
  return getPlatform().isLinux;
}
