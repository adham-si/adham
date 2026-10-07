import * as React from 'react';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/theme/use-theme';

export function AppearancePage() {
  const { t, i18n } = useTranslation();
  const { appearance, setAppearance } = useTheme();

  const [enterToSend, setEnterToSend] = React.useState(true);
  const [textDirection, setTextDirection] = React.useState(false);
  const [openInDesktop, setOpenInDesktop] = React.useState(true);
  const [highContrast, setHighContrast] = React.useState('system');

  return (
    <div className="space-y-6">
      {/* Page Title & Subtitle */}
      <div>
        <h2 className="text-xl font-bold tracking-tight text-foreground">
          {t('settings.appearance.title', { defaultValue: 'Preferences' })}
        </h2>
        <p className="text-xs text-foreground-secondary mt-1">
          {t('settings.appearance.desc', {
            defaultValue: 'Choose how you want Adham to look and behave',
          })}
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
                Choose a theme for Adham on this device
              </div>
            </div>
            <select
              value={appearance}
              onChange={(e) => setAppearance(e.target.value as 'light' | 'dark' | 'system')}
              className="min-h-control-sm rounded-md border border-border-subtle bg-surface px-3 py-1 text-xs text-foreground cursor-pointer hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-focus"
            >
              <option value="system">Use system setting</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </div>

          {/* High Contrast Row */}
          <div className="flex items-center justify-between py-3">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-foreground">High contrast</span>
                <span className="rounded bg-surface-muted px-1.5 py-0.5 text-xs text-foreground-muted font-medium">
                  Verified
                </span>
              </div>
              <div className="text-xs text-foreground-secondary mt-0.5">
                Increase contrast for improved visibility and Windows Canvas mode
              </div>
            </div>
            <select
              value={highContrast}
              onChange={(e) => setHighContrast(e.target.value)}
              className="min-h-control-sm rounded-md border border-border-subtle bg-surface px-3 py-1 text-xs text-foreground cursor-pointer hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-focus"
            >
              <option value="system">Use system setting</option>
              <option value="enabled">Enabled</option>
              <option value="disabled">Disabled</option>
            </select>
          </div>
        </div>
      </div>

      {/* Input Options Section */}
      <div className="space-y-1">
        <h3 className="text-sm font-semibold text-foreground pt-2 pb-1">Input options</h3>
        <div className="divide-y divide-border-subtle/40">
          <div className="flex items-center justify-between py-3">
            <div>
              <div className="text-sm font-medium text-foreground">Use Enter to add a new line</div>
              <div className="text-xs text-foreground-secondary mt-0.5">
                Applies to chat, prompt boxes, and inputs. Press Cmd/Ctrl + Enter to send.
              </div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={enterToSend}
              aria-label="Use Enter to add a new line"
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
        </div>
      </div>

      {/* Language & Region Section */}
      <div className="space-y-1">
        <h3 className="text-sm font-semibold text-foreground pt-2 pb-1">Language & time</h3>
        <div className="divide-y divide-border-subtle/40">
          {/* Language Row */}
          <div className="flex items-center justify-between py-3">
            <div>
              <div className="text-sm font-medium text-foreground">Language</div>
              <div className="text-xs text-foreground-secondary mt-0.5">
                Choose the language you want to use Adham in
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
              <div className="text-sm font-medium text-foreground">
                Always show text direction controls
              </div>
              <div className="text-xs text-foreground-secondary mt-0.5">
                Show option to change text direction (LTR or RTL) in editor and messages
              </div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={textDirection}
              aria-label="Always show text direction controls"
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

      {/* Desktop App Section */}
      <div className="space-y-1">
        <h3 className="text-sm font-semibold text-foreground pt-2 pb-1">Desktop app</h3>
        <div className="divide-y divide-border-subtle/40">
          <div className="flex items-center justify-between py-3">
            <div>
              <div className="text-sm font-medium text-foreground">Open links in desktop app</div>
              <div className="text-xs text-foreground-secondary mt-0.5">
                Open workspace links in the desktop shell with native IPC containment
              </div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={openInDesktop}
              aria-label="Open links in desktop app"
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
