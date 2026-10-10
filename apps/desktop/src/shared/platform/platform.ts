import * as React from 'react';
import type { PlatformInfo, PlatformLayoutConfig, PlatformOs } from './types';

let testPlatformOverride: PlatformOs | null = null;

/**
 * Configure a test override for platform detection.
 * Pass `null` to reset to ambient environment detection.
 */
export function setPlatformForTesting(override: PlatformOs | null): void {
  testPlatformOverride = override;
}

/**
 * Detect host OS platform from ambient runtime environment (navigator/environment).
 * This is the centralized location where ambient platform properties are evaluated.
 */
function detectHostOs(): PlatformOs {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return 'unknown';
  }

  // Modern Client Hints platform if available
  const navAny = navigator as unknown as { userAgentData?: { platform?: string } };
  const platformHint = navAny.userAgentData?.platform?.toLowerCase();
  if (platformHint) {
    if (platformHint.includes('mac')) return 'macos';
    if (platformHint.includes('win')) return 'windows';
    if (platformHint.includes('linux')) return 'linux';
  }

  // Fallback to navigator.platform / navigator.userAgent
  const navPlatform = (navigator.platform || '').toLowerCase();
  if (navPlatform.includes('mac')) return 'macos';
  if (navPlatform.includes('win')) return 'windows';
  if (navPlatform.includes('linux')) return 'linux';

  const userAgent = (navigator.userAgent || '').toLowerCase();
  if (userAgent.includes('macintosh') || userAgent.includes('mac os')) return 'macos';
  if (userAgent.includes('windows')) return 'windows';
  if (userAgent.includes('linux')) return 'linux';

  return 'unknown';
}

export function getLayoutConfig(os: PlatformOs): PlatformLayoutConfig {
  const isMac = os === 'macos';
  return {
    showCustomCaptionControls: !isMac,
    hasNativeTitlebarControls: isMac,
    // 80px (pl-20) physical left clearance ensures macOS traffic lights never collide in either LTR or RTL
    trafficLightClearanceClass: isMac ? 'pl-20' : '',
    titlebarStartPaddingClass: 'ps-2',
    modifierKey: isMac ? 'meta' : 'ctrl',
    modifierSymbol: isMac ? '⌘' : 'Ctrl',
  };
}

/**
 * Resolve the current platform information.
 */
export function resolvePlatform(override?: PlatformOs | null): PlatformInfo {
  const os = override ?? testPlatformOverride ?? detectHostOs();
  return {
    os,
    isMac: os === 'macos',
    isWindows: os === 'windows',
    isLinux: os === 'linux',
    layout: getLayoutConfig(os),
  };
}

export function getPlatform(): PlatformInfo {
  return resolvePlatform();
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

/**
 * React hook for consuming platform configuration.
 */
export function usePlatform(): PlatformInfo {
  return React.useMemo(() => getPlatform(), []);
}
