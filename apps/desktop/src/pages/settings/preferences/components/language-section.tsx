import * as React from 'react';
import { useTranslation } from 'react-i18next';

export function LanguageSection() {
  const { i18n } = useTranslation();
  const [textDirection, setTextDirection] = React.useState(false);

  return (
    <section aria-labelledby="language-section-heading" className="space-y-4">
      {/* Section Header with Notion-style separator line */}
      <div className="border-b border-border-subtle pb-2.5">
        <h3 id="language-section-heading" className="text-sm font-semibold text-foreground">
          Language & region
        </h3>
      </div>

      <div className="space-y-4">
        {/* Language Row */}
        <div className="flex items-center justify-between">
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
        <div className="flex items-center justify-between">
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
    </section>
  );
}
