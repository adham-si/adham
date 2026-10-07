import * as React from 'react';
import { useTheme } from '@/theme/use-theme';

export function AppearanceSection() {
  const { appearance, setAppearance } = useTheme();
  const [highContrast, setHighContrast] = React.useState('system');

  const [fontFamily, setFontFamily] = React.useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('adham.font-family') || 'default';
    }
    return 'default';
  });

  const [fontSize, setFontSize] = React.useState<'sm' | 'md' | 'lg'>(() => {
    if (typeof window !== 'undefined') {
      return (localStorage.getItem('adham.font-size') as 'sm' | 'md' | 'lg') || 'md';
    }
    return 'md';
  });

  const handleFontFamilyChange = (font: string) => {
    setFontFamily(font);
    localStorage.setItem('adham.font-family', font);
    document.documentElement.dataset.fontFamily = font;
  };

  const handleFontSizeChange = (size: 'sm' | 'md' | 'lg') => {
    setFontSize(size);
    localStorage.setItem('adham.font-size', size);
    document.documentElement.dataset.fontSize = size;
  };

  React.useEffect(() => {
    document.documentElement.dataset.fontFamily = fontFamily;
    document.documentElement.dataset.fontSize = fontSize;
  }, [fontFamily, fontSize]);

  return (
    <section aria-labelledby="appearance-section-heading" className="space-y-4">
      {/* Section Header with Notion-style separator line */}
      <div className="border-b border-border-subtle pb-2.5">
        <h3 id="appearance-section-heading" className="text-sm font-semibold text-foreground">
          Appearance
        </h3>
      </div>

      <div className="space-y-4">
        {/* Theme Row */}
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-medium text-foreground">Theme</div>
            <div className="text-xs text-foreground-secondary mt-0.5">
              Switch between light and dark modes, or sync with your operating system.
            </div>
          </div>
          <select
            value={appearance}
            onChange={(e) => setAppearance(e.target.value as 'light' | 'dark' | 'system')}
            className="min-h-control-sm rounded-md border border-border-subtle bg-surface px-3 py-1 text-xs text-foreground cursor-pointer hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-focus"
          >
            <option value="system">System default</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </div>

        {/* High Contrast Row */}
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-medium text-foreground">High contrast</div>
            <div className="text-xs text-foreground-secondary mt-0.5">
              Enhance contrast across borders, text, and surfaces for improved readability.
            </div>
          </div>
          <select
            value={highContrast}
            onChange={(e) => setHighContrast(e.target.value)}
            className="min-h-control-sm rounded-md border border-border-subtle bg-surface px-3 py-1 text-xs text-foreground cursor-pointer hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-focus"
          >
            <option value="system">System default</option>
            <option value="enabled">Enabled</option>
            <option value="disabled">Disabled</option>
          </select>
        </div>

        {/* Font Family Selection Row */}
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-medium text-foreground">Font family</div>
            <div className="text-xs text-foreground-secondary mt-0.5">
              Choose the primary typography typeface for the interface.
            </div>
          </div>
          <select
            value={fontFamily}
            onChange={(e) => handleFontFamilyChange(e.target.value)}
            className="min-h-control-sm rounded-md border border-border-subtle bg-surface px-3 py-1 text-xs text-foreground cursor-pointer hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-focus"
          >
            <option value="default">Default (Inter)</option>
            <option value="system">System UI</option>
            <option value="serif">Serif</option>
            <option value="mono">Monospace</option>
          </select>
        </div>

        {/* Font Size Control Row */}
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-medium text-foreground">Font size</div>
            <div className="text-xs text-foreground-secondary mt-0.5">
              Adjust the baseline text scale across workspace dialogs and views.
            </div>
          </div>
          <select
            value={fontSize}
            onChange={(e) => handleFontSizeChange(e.target.value as 'sm' | 'md' | 'lg')}
            className="min-h-control-sm rounded-md border border-border-subtle bg-surface px-3 py-1 text-xs text-foreground cursor-pointer hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-focus"
          >
            <option value="sm">Small</option>
            <option value="md">Medium (default)</option>
            <option value="lg">Large</option>
          </select>
        </div>
      </div>
    </section>
  );
}
