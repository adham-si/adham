import * as React from 'react';

export type ContextTab = 'plan' | 'activity' | 'graph' | 'agents' | 'context' | 'artifacts';
export type SettingsPageId =
  | 'appearance'
  | 'general'
  | 'models'
  | 'mcp'
  | 'skills'
  | 'plugins'
  | 'data'
  | 'privacy'
  | 'storage'
  | 'extensions';
export type SettingsTab = SettingsPageId;

export interface ShellLayoutContextValue {
  sidebarOpen: boolean;
  sidebarWidth: number;
  contextPanelOpen: boolean;
  contextPanelTab: ContextTab;
  focusMode: boolean;
  activeRailDestination: string;
  settingsOpen: boolean;
  activeSettingsPage: SettingsPageId;
  activeSettingsTab: SettingsPageId;
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
  setSidebarWidth: (width: number) => void;
  toggleContextPanel: () => void;
  setContextPanelOpen: (open: boolean) => void;
  setContextPanelTab: (tab: ContextTab) => void;
  toggleFocusMode: () => void;
  setActiveRailDestination: (dest: string) => void;
  openSettings: (page?: SettingsPageId) => void;
  closeSettings: () => void;
  setActiveSettingsPage: (page: SettingsPageId) => void;
  setActiveSettingsTab: (page: SettingsPageId) => void;
}

const ShellLayoutContext = React.createContext<ShellLayoutContextValue | null>(null);

const STORAGE_KEYS = {
  sidebarOpen: 'adham:sidebar:open',
  sidebarWidth: 'adham:sidebar:width',
  contextPanelOpen: 'adham:context-panel:open',
} as const;

const MIN_SIDEBAR_WIDTH = 247;
const MAX_SIDEBAR_WIDTH = 600;
const DEFAULT_SIDEBAR_WIDTH = 260;

export function ShellLayoutProvider({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpenState] = React.useState<boolean>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEYS.sidebarOpen);
      return stored !== null ? stored === 'true' : true;
    } catch {
      return true;
    }
  });

  const [sidebarWidth, setSidebarWidthState] = React.useState<number>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEYS.sidebarWidth);
      if (stored) {
        const parsed = Number.parseInt(stored, 10);
        if (!Number.isNaN(parsed)) {
          return Math.min(Math.max(parsed, MIN_SIDEBAR_WIDTH), MAX_SIDEBAR_WIDTH);
        }
      }
      return DEFAULT_SIDEBAR_WIDTH;
    } catch {
      return DEFAULT_SIDEBAR_WIDTH;
    }
  });

  const [contextPanelOpen, setContextPanelOpenState] = React.useState<boolean>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEYS.contextPanelOpen);
      return stored !== null ? stored === 'true' : false;
    } catch {
      return false;
    }
  });

  const [contextPanelTab, setContextPanelTab] = React.useState<ContextTab>('plan');
  const [focusMode, setFocusMode] = React.useState<boolean>(false);
  const [activeRailDestination, setActiveRailDestination] = React.useState<string>('compose');

  const setSidebarOpen = React.useCallback((open: boolean) => {
    setSidebarOpenState(open);
    try {
      localStorage.setItem(STORAGE_KEYS.sidebarOpen, String(open));
    } catch {
      // localStorage may fail in restricted test contexts
    }
  }, []);

  const toggleSidebar = React.useCallback(() => {
    setSidebarOpenState((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(STORAGE_KEYS.sidebarOpen, String(next));
      } catch {
        // ignore
      }
      return next;
    });
  }, []);

  const setSidebarWidth = React.useCallback((width: number) => {
    const clamped = Math.min(Math.max(width, MIN_SIDEBAR_WIDTH), MAX_SIDEBAR_WIDTH);
    setSidebarWidthState(clamped);
    try {
      localStorage.setItem(STORAGE_KEYS.sidebarWidth, String(clamped));
    } catch {
      // ignore
    }
  }, []);

  const setContextPanelOpen = React.useCallback((open: boolean) => {
    setContextPanelOpenState(open);
    try {
      localStorage.setItem(STORAGE_KEYS.contextPanelOpen, String(open));
    } catch {
      // ignore
    }
  }, []);

  const toggleContextPanel = React.useCallback(() => {
    setContextPanelOpenState((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(STORAGE_KEYS.contextPanelOpen, String(next));
      } catch {
        // ignore
      }
      return next;
    });
  }, []);

  const toggleFocusMode = React.useCallback(() => {
    setFocusMode((prev) => !prev);
  }, []);

  const [settingsOpen, setSettingsOpen] = React.useState<boolean>(false);
  const [activeSettingsPage, setActiveSettingsPage] = React.useState<SettingsPageId>('appearance');

  const openSettings = React.useCallback((page?: SettingsPageId) => {
    if (page) setActiveSettingsPage(page);
    setSettingsOpen(true);
  }, []);

  const closeSettings = React.useCallback(() => {
    setSettingsOpen(false);
  }, []);

  const value = React.useMemo<ShellLayoutContextValue>(
    () => ({
      sidebarOpen,
      sidebarWidth,
      contextPanelOpen,
      contextPanelTab,
      focusMode,
      activeRailDestination,
      settingsOpen,
      activeSettingsPage,
      activeSettingsTab: activeSettingsPage,
      toggleSidebar,
      setSidebarOpen,
      setSidebarWidth,
      toggleContextPanel,
      setContextPanelOpen,
      setContextPanelTab,
      toggleFocusMode,
      setActiveRailDestination,
      openSettings,
      closeSettings,
      setActiveSettingsPage,
      setActiveSettingsTab: setActiveSettingsPage,
    }),
    [
      sidebarOpen,
      sidebarWidth,
      contextPanelOpen,
      contextPanelTab,
      focusMode,
      activeRailDestination,
      settingsOpen,
      activeSettingsPage,
      toggleSidebar,
      setSidebarOpen,
      setSidebarWidth,
      toggleContextPanel,
      setContextPanelOpen,
      toggleFocusMode,
      openSettings,
      closeSettings,
    ],
  );

  return <ShellLayoutContext value={value}>{children}</ShellLayoutContext>;
}

export function useShellLayout(): ShellLayoutContextValue {
  const ctx = React.use(ShellLayoutContext);
  if (!ctx) {
    throw new Error('useShellLayout must be used within a ShellLayoutProvider');
  }
  return ctx;
}
