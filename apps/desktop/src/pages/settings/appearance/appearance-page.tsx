import * as React from 'react';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/theme/use-theme';

export function AppearancePage() {
  const { i18n } = useTranslation();
  const { appearance, setAppearance } = useTheme();

  const [enterToSend, setEnterToSend] = React.useState(true);
  const [textDirection, setTextDirection] = React.useState(false);
  const [hardwareAcceleration, setHardwareAcceleration] = React.useState(true);
  const [openInDesktop, setOpenInDesktop] = React.useState(true);
  const [highContrast, setHighContrast] = React.useState('system');

  return (
    <div className="space-y-6">
      {/* Page Title & Subtitle */}
      <div>
        <h2 className="text-xl font-bold tracking-tight text-foreground">Preferences</h2>
        <p className="text-xs text-foreground-secondary mt-1">
          Customize your workspace theme, language, and interface layout.
        </p>
      </div>

      {/* Appearance Section */}
      <div className="space-y-1">
        <h3 className="text-sm font-semibold text-foreground pt-2 pb-1">Appearance</h3>
        <div className="divide-y divide-border-subtle/40">
          {/* Theme Row */}
          <div className="flex items-center justify-between py-3">
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
          <div className="flex items-center justify-between py-3">
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
        </div>
      </div>

      {/* Language & Region Section */}
      <div className="space-y-1">
        <h3 className="text-sm font-semibold text-foreground pt-2 pb-1">Language & region</h3>
        <div className="divide-y divide-border-subtle/40">
          {/* Language Row */}
          <div className="flex items-center justify-between py-3">
            <div>
              <div className="text-sm font-medium text-foreground">Display language</div>
              <div className="text-xs text-foreground-secondary mt-0.5">
                Choose the primary language used for workspace menus, dialogs, and messages.
              </div>
            </div>
            <select
              value={
                i18n.language.startsWith('ar')
                  ? 'ar'
                  : i18n.language.startsWith('zh')
                    ? 'zh-CN'
                    : i18n.language.startsWith('ru')
                      ? 'ru'
                      : 'en'
              }
              onChange={(e) => i18n.changeLanguage(e.target.value)}
              className="min-h-control-sm rounded-md border border-border-subtle bg-surface px-3 py-1 text-xs text-foreground cursor-pointer hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-focus"
            >
              <option value="en">English (US)</option>
              <option value="ar">العربية (Arabic)</option>
              <option value="zh-CN">简体中文 (Chinese)</option>
              <option value="ru">Русский (Russian)</option>
            </select>
          </div>

          {/* Text Direction Controls Row */}
          <div className="flex items-center justify-between py-3">
            <div>
              <div className="text-sm font-medium text-foreground">Bidirectional text controls</div>
              <div className="text-xs text-foreground-secondary mt-0.5">
                Display inline switchers to toggle text direction between left-to-right and
                right-to-left.
              </div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={textDirection}
              aria-label="Bidirectional text controls"
              onClick={() => setTextDirection(!textDirection)}
              className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full px-0.5 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus ${
                textDirection ? 'bg-action' : 'bg-surface-muted'
              }`}
            >
              <span
                className={`pointer-events-none inline-block size-4 transform rounded-full bg-surface shadow-sm transition-transform ${
                  textDirection ? 'translate-x-4' : 'translate-x-0'
                }`}
              />
            </button>
          </div>
        </div>
      </div>

      {/* Editor & Input Section */}
      <div className="space-y-1">
        <h3 className="text-sm font-semibold text-foreground pt-2 pb-1">Editor & input</h3>
        <div className="divide-y divide-border-subtle/40">
          {/* Send on Enter */}
          <div className="flex items-center justify-between py-3">
            <div>
              <div className="text-sm font-medium text-foreground">Send message on Enter</div>
              <div className="text-xs text-foreground-secondary mt-0.5">
                Press Enter to submit messages immediately. Press Shift + Enter to add a new line.
              </div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={enterToSend}
              aria-label="Send message on Enter"
              onClick={() => setEnterToSend(!enterToSend)}
              className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full px-0.5 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus ${
                enterToSend ? 'bg-action' : 'bg-surface-muted'
              }`}
            >
              <span
                className={`pointer-events-none inline-block size-4 transform rounded-full bg-surface shadow-sm transition-transform ${
                  enterToSend ? 'translate-x-4' : 'translate-x-0'
                }`}
              />
            </button>
          </div>

          {/* Hardware acceleration */}
          <div className="flex items-center justify-between py-3">
            <div>
              <div className="text-sm font-medium text-foreground">Hardware acceleration</div>
              <div className="text-xs text-foreground-secondary mt-0.5">
                Use GPU rendering to optimize interface smoothness, transitions, and scrolling.
              </div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={hardwareAcceleration}
              aria-label="Hardware acceleration"
              onClick={() => setHardwareAcceleration(!hardwareAcceleration)}
              className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full px-0.5 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus ${
                hardwareAcceleration ? 'bg-action' : 'bg-surface-muted'
              }`}
            >
              <span
                className={`pointer-events-none inline-block size-4 transform rounded-full bg-surface shadow-sm transition-transform ${
                  hardwareAcceleration ? 'translate-x-4' : 'translate-x-0'
                }`}
              />
            </button>
          </div>
        </div>
      </div>

      {/* Desktop Integration Section */}
      <div className="space-y-1">
        <h3 className="text-sm font-semibold text-foreground pt-2 pb-1">Desktop integration</h3>
        <div className="divide-y divide-border-subtle/40">
          <div className="flex items-center justify-between py-3">
            <div>
              <div className="text-sm font-medium text-foreground">Handle workspace links</div>
              <div className="text-xs text-foreground-secondary mt-0.5">
                Open supported workspace and project links directly inside the application window.
              </div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={openInDesktop}
              aria-label="Handle workspace links"
              onClick={() => setOpenInDesktop(!openInDesktop)}
              className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full px-0.5 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus ${
                openInDesktop ? 'bg-action' : 'bg-surface-muted'
              }`}
            >
              <span
                className={`pointer-events-none inline-block size-4 transform rounded-full bg-surface shadow-sm transition-transform ${
                  openInDesktop ? 'translate-x-4' : 'translate-x-0'
                }`}
              />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
