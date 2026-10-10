export type PlatformOs = 'macos' | 'windows' | 'linux' | 'unknown';

export interface PlatformLayoutConfig {
  /**
   * Whether to show custom HTML window caption controls (minimize, maximize, close).
   * True on Windows/Linux; false on macOS where native traffic lights are used.
   */
  showCustomCaptionControls: boolean;
  /**
   * Whether the native window manager provides title-bar controls (e.g. macOS traffic lights).
   */
  hasNativeTitlebarControls: boolean;
  /**
   * Physical left clearance class for native macOS traffic lights (80px / pl-20).
   * Unlike logical start padding, traffic lights on macOS are physically fixed on the left in both LTR and RTL.
   */
  trafficLightClearanceClass: string;
  /**
   * CSS class applied to the start of the titlebar content.
   */
  titlebarStartPaddingClass: string;
  /**
   * Primary accelerator/modifier key on the host OS.
   */
  modifierKey: 'meta' | 'ctrl';
  modifierSymbol: '⌘' | 'Ctrl';
}

export interface PlatformInfo {
  os: PlatformOs;
  isMac: boolean;
  isWindows: boolean;
  isLinux: boolean;
  layout: PlatformLayoutConfig;
}
