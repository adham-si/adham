import * as React from 'react';

/**
 * One surface of the component gallery: a titled card holding one or more
 * labelled demo rows. Section chrome only - no layout or state decisions.
 */
export function GallerySection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-border-subtle bg-surface p-4 sm:p-6">
      <h2 className="mb-1 text-base font-semibold">{title}</h2>
      {description !== undefined && (
        <p className="mb-4 text-sm text-foreground-secondary">{description}</p>
      )}
      <div className="flex flex-col gap-4">{children}</div>
    </section>
  );
}

/**
 * A labelled demo group inside a section. The label names the axis being
 * demoed (a size scale, a state) rather than being prose.
 */
export function GalleryRow({ label, children }: { label?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      {label !== undefined && (
        <span className="text-xs font-medium tracking-wide text-foreground-muted uppercase">
          {label}
        </span>
      )}
      <div className="flex flex-wrap items-start gap-3">{children}</div>
    </div>
  );
}

/** Shared trigger styling for gallery-only controls that are raw buttons. */
export const galleryTriggerClasses =
  'inline-flex min-h-control-md items-center justify-center gap-2 rounded-md border border-border bg-surface-subtle px-4 text-sm text-foreground transition-colors hover:bg-surface-muted active:bg-surface-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus';
