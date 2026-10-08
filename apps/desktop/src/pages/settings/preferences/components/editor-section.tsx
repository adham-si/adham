import * as React from 'react';

export function EditorSection() {
  const [enterToSend, setEnterToSend] = React.useState(true);
  const [hardwareAcceleration, setHardwareAcceleration] = React.useState(true);

  return (
    <section aria-labelledby="editor-section-heading" className="space-y-4">
      {/* Section Header with Notion-style separator line */}
      <div className="border-b border-border-subtle pb-2.5">
        <h3 id="editor-section-heading" className="text-sm font-semibold text-foreground">
          Editor & input
        </h3>
      </div>

      <div className="space-y-4">
        {/* Send message on Enter */}
        <div className="flex items-center justify-between">
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
        <div className="flex items-center justify-between">
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
    </section>
  );
}
