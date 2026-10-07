import * as React from 'react';

export type ContextTab = 'plan' | 'activity' | 'graph' | 'agents' | 'context' | 'artifacts';
export type SettingsPageId =
  | 'preferences'
  | 'appearance'
  | 'general'
  | 'models'
  | 'providers'
  | 'routing'
  | 'mcp'
  | 'skills'
  | 'plugins'
  | 'data'
  | 'privacy'
  | 'security'
  | 'budget'
  | 'usage'
  | 'governance'
  | 'info'
  | 'storage'
  | 'extensions';
export type SettingsTab = SettingsPageId;

export const SHELL_DIMENSIONS = {
  navRailWidth: 40,
  headerHeight: 40,
  minSidebarWidth: 272,
  maxSidebarWidth: 600,
  defaultSidebarWidth: 272,
  minSecondarySidebarWidth: 272,
  maxSecondarySidebarWidth: 600,
  defaultSecondarySidebarWidth: 272,
  minPanelWidth: 272,
  maxPanelWidth: 960,
  defaultPanelWidth: 320,
} as const;

export interface ShellLayoutContextValue {
  // Navigation rail
  navRailOpen: boolean;
  toggleNavRail: () => void;
  setNavRailOpen: (open: boolean) => void;

  // Primary sidebar
  sidebarOpen: boolean;
  sidebarWidth: number;
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
  setSidebarWidth: (width: number) => void;

  // Secondary sidebar
  secondarySidebarOpen: boolean;
  secondarySidebarWidth: number;
  toggleSecondarySidebar: () => void;
  setSecondarySidebarOpen: (open: boolean) => void;
  setSecondarySidebarWidth: (width: number) => void;

  // Panel / Context panel
  panelOpen: boolean;
  panelWidth: number;
  contextPanelOpen: boolean;
  contextPanelTab: ContextTab;
  togglePanel: () => void;
  setPanelOpen: (open: boolean) => void;
  setPanelWidth: (width: number) => void;
  toggleContextPanel: () => void;
  setContextPanelOpen: (open: boolean) => void;
  setContextPanelTab: (tab: ContextTab) => void;

  // Global shell modes
  focusMode: boolean;
  toggleFocusMode: () => void;
  activeRailDestination: string;
  setActiveRailDestination: (dest: string) => void;

  // Settings
  settingsOpen: boolean;
  activeSettingsPage: SettingsPageId;
  activeSettingsTab: SettingsPageId;
  openSettings: (page?: SettingsPageId) => void;
  closeSettings: () => void;
  setActiveSettingsPage: (page: SettingsPageId) => void;
  setActiveSettingsTab: (page: SettingsPageId) => void;
}

const ShellLayoutContext = React.createContext<ShellLayoutContextValue | null>(null);

const STORAGE_KEYS = {
  navRailOpen: 'adham:nav-rail:open',
  sidebarOpen: 'adham:sidebar:open',
  sidebarWidth: 'adham:sidebar:width',
  secondarySidebarOpen: 'adham:secondary-sidebar:open',
  secondarySidebarWidth: 'adham:secondary-sidebar:width',
  panelWidth: 'adham:panel:width',
  contextPanelOpen: 'adham:context-panel:open',
} as const;

export const DEFAULT_SHELL_LAYOUT_VALUE: ShellLayoutContextValue = {
  navRailOpen: true,
  toggleNavRail: () => {},
  setNavRailOpen: () => {},
  sidebarOpen: true,
  sidebarWidth: SHELL_DIMENSIONS.defaultSidebarWidth,
  toggleSidebar: () => {},
  setSidebarOpen: () => {},
  setSidebarWidth: () => {},
  secondarySidebarOpen: true,
  secondarySidebarWidth: SHELL_DIMENSIONS.defaultSecondarySidebarWidth,
  toggleSecondarySidebar: () => {},
  setSecondarySidebarOpen: () => {},
  setSecondarySidebarWidth: () => {},
  panelOpen: true,
  panelWidth: SHELL_DIMENSIONS.defaultPanelWidth,
  contextPanelOpen: true,
  contextPanelTab: 'plan',
  togglePanel: () => {},
  setPanelOpen: () => {},
  setPanelWidth: () => {},
  toggleContextPanel: () => {},
  setContextPanelOpen: () => {},
  setContextPanelTab: () => {},
  focusMode: false,
  toggleFocusMode: () => {},
  activeRailDestination: 'compose',
  setActiveRailDestination: () => {},
  settingsOpen: false,
  activeSettingsPage: 'preferences',
  activeSettingsTab: 'preferences',
  openSettings: () => {},
  closeSettings: () => {},
  setActiveSettingsPage: () => {},
  setActiveSettingsTab: () => {},
};

export function useCreateShellLayoutState(): ShellLayoutContextValue {
  const [navRailOpen, setNavRailOpenState] = React.useState<boolean>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEYS.navRailOpen);
      return stored !== null ? stored === 'true' : true;
    } catch {
      return true;
    }
  });

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
          return Math.min(
            Math.max(parsed, SHELL_DIMENSIONS.minSidebarWidth),
            SHELL_DIMENSIONS.maxSidebarWidth,
          );
        }
      }
      return SHELL_DIMENSIONS.defaultSidebarWidth;
    } catch {
      return SHELL_DIMENSIONS.defaultSidebarWidth;
    }
  });

  const [secondarySidebarOpen, setSecondarySidebarOpenState] = React.useState<boolean>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEYS.secondarySidebarOpen);
      return stored !== null ? stored === 'true' : true;
    } catch {
      return true;
    }
  });

  const [secondarySidebarWidth, setSecondarySidebarWidthState] = React.useState<number>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEYS.secondarySidebarWidth);
      if (stored) {
        const parsed = Number.parseInt(stored, 10);
        if (!Number.isNaN(parsed)) {
          return Math.min(
            Math.max(parsed, SHELL_DIMENSIONS.minSecondarySidebarWidth),
            SHELL_DIMENSIONS.maxSecondarySidebarWidth,
          );
        }
      }
      return SHELL_DIMENSIONS.defaultSecondarySidebarWidth;
    } catch {
      return SHELL_DIMENSIONS.defaultSecondarySidebarWidth;
    }
  });

  const [contextPanelOpen, setContextPanelOpenState] = React.useState<boolean>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEYS.contextPanelOpen);
      return stored !== null ? stored === 'true' : true;
    } catch {
      return true;
    }
  });

  const [panelWidth, setPanelWidthState] = React.useState<number>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEYS.panelWidth);
      if (stored) {
        const parsed = Number.parseInt(stored, 10);
        if (!Number.isNaN(parsed)) {
          return Math.min(
            Math.max(parsed, SHELL_DIMENSIONS.minPanelWidth),
            SHELL_DIMENSIONS.maxPanelWidth,
          );
        }
      }
      return SHELL_DIMENSIONS.defaultPanelWidth;
    } catch {
      return SHELL_DIMENSIONS.defaultPanelWidth;
    }
  });

  const [contextPanelTab, setContextPanelTab] = React.useState<ContextTab>('plan');
  const [focusMode, setFocusMode] = React.useState<boolean>(false);
  const [activeRailDestination, setActiveRailDestination] = React.useState<string>('compose');

  const setNavRailOpen = React.useCallback((open: boolean) => {
    setNavRailOpenState(open);
    try {
      localStorage.setItem(STORAGE_KEYS.navRailOpen, String(open));
    } catch {
      // ignore
    }
  }, []);

  const toggleNavRail = React.useCallback(() => {
    setNavRailOpenState((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(STORAGE_KEYS.navRailOpen, String(next));
      } catch {
        // ignore
      }
      return next;
    });
  }, []);

  const setSidebarOpen = React.useCallback((open: boolean) => {
    setSidebarOpenState(open);
    try {
      localStorage.setItem(STORAGE_KEYS.sidebarOpen, String(open));
    } catch {
      // localStorage may fail in restricted contexts
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
    const clamped = Math.min(
      Math.max(width, SHELL_DIMENSIONS.minSidebarWidth),
      SHELL_DIMENSIONS.maxSidebarWidth,
    );
    setSidebarWidthState(clamped);
    try {
      localStorage.setItem(STORAGE_KEYS.sidebarWidth, String(clamped));
    } catch {
      // ignore
    }
  }, []);

  const setSecondarySidebarOpen = React.useCallback((open: boolean) => {
    setSecondarySidebarOpenState(open);
    try {
      localStorage.setItem(STORAGE_KEYS.secondarySidebarOpen, String(open));
    } catch {
      // ignore
    }
  }, []);

  const toggleSecondarySidebar = React.useCallback(() => {
    setSecondarySidebarOpenState((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(STORAGE_KEYS.secondarySidebarOpen, String(next));
      } catch {
        // ignore
      }
      return next;
    });
  }, []);

  const setSecondarySidebarWidth = React.useCallback((width: number) => {
    const clamped = Math.min(
      Math.max(width, SHELL_DIMENSIONS.minSecondarySidebarWidth),
      SHELL_DIMENSIONS.maxSecondarySidebarWidth,
    );
    setSecondarySidebarWidthState(clamped);
    try {
      localStorage.setItem(STORAGE_KEYS.secondarySidebarWidth, String(clamped));
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

  const setPanelWidth = React.useCallback((width: number) => {
    const clamped = Math.min(
      Math.max(width, SHELL_DIMENSIONS.minPanelWidth),
      SHELL_DIMENSIONS.maxPanelWidth,
    );
    setPanelWidthState(clamped);
    try {
      localStorage.setItem(STORAGE_KEYS.panelWidth, String(clamped));
    } catch {
      // ignore
    }
  }, []);

  const toggleFocusMode = React.useCallback(() => {
    setFocusMode((prev) => !prev);
  }, []);

  const [settingsOpen, setSettingsOpen] = React.useState<boolean>(false);
  const [activeSettingsPage, setActiveSettingsPage] = React.useState<SettingsPageId>('preferences');

  const openSettings = React.useCallback((page?: SettingsPageId) => {
    if (page) setActiveSettingsPage(page);
    setSettingsOpen(true);
  }, []);

  const closeSettings = React.useCallback(() => {
    setSettingsOpen(false);
  }, []);

  return React.useMemo<ShellLayoutContextValue>(
    () => ({
      navRailOpen,
      toggleNavRail,
      setNavRailOpen,
      sidebarOpen,
      sidebarWidth,
      secondarySidebarOpen,
      secondarySidebarWidth,
      panelOpen: contextPanelOpen,
      panelWidth,
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
      toggleSecondarySidebar,
      setSecondarySidebarOpen,
      setSecondarySidebarWidth,
      togglePanel: toggleContextPanel,
      setPanelOpen: setContextPanelOpen,
      setPanelWidth,
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
      navRailOpen,
      toggleNavRail,
      setNavRailOpen,
      sidebarOpen,
      sidebarWidth,
      secondarySidebarOpen,
      secondarySidebarWidth,
      contextPanelOpen,
      panelWidth,
      contextPanelTab,
      focusMode,
      activeRailDestination,
      settingsOpen,
      activeSettingsPage,
      toggleSidebar,
      setSidebarOpen,
      setSidebarWidth,
      toggleSecondarySidebar,
      setSecondarySidebarOpen,
      setSecondarySidebarWidth,
      toggleContextPanel,
      setContextPanelOpen,
      setPanelWidth,
      toggleFocusMode,
      openSettings,
      closeSettings,
    ],
  );
}

export function ShellLayoutProvider({ children }: { children?: React.ReactNode }) {
  const outer = React.use(ShellLayoutContext);
  const internal = useCreateShellLayoutState();
  const value = outer ?? internal;

  return <ShellLayoutContext value={value}>{children}</ShellLayoutContext>;
}

export function Context({ children }: { children?: React.ReactNode }) {
  const outer = React.use(ShellLayoutContext);
  const internal = useCreateShellLayoutState();
  const value = outer ?? internal;

  return (
    <ShellLayoutContext value={value}>
      <div
        data-testid="shell-context-holder"
        className="flex flex-1 flex-col rounded-xl overflow-hidden"
        style={{
          background: 'green',
          borderRadius: 'var(--radius-xl)',
          minHeight: 0,
        }}
      >
        {children}
      </div>
    </ShellLayoutContext>
  );
}

export function useShellLayout(): ShellLayoutContextValue {
  const ctx = React.use(ShellLayoutContext);
  return ctx ?? DEFAULT_SHELL_LAYOUT_VALUE;
}
