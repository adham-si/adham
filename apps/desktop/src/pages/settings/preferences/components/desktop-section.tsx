import * as React from 'react';

export function DesktopSection() {
  const [openInDesktop, setOpenInDesktop] = React.useState(true);

  return (
    <section aria-labelledby="desktop-section-heading" className="space-y-4">
      {/* Section Header with Notion-style separator line */}
      <div className="border-b border-border-subtle pb-2.5">
        <h3 id="desktop-section-heading" className="text-sm font-semibold text-foreground">
          Desktop integration
        </h3>
      </div>

      <div className="space-y-4">
        <div className="flex items-center justify-between">
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
    </section>
  );
}
