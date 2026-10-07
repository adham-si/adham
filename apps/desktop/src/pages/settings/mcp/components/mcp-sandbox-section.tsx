import * as React from 'react';

export function McpSandboxSection() {
  return (
    <div className="rounded-lg border border-border-subtle bg-surface p-4 space-y-2.5">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-semibold text-foreground">
          Model Context Protocol Sandbox & Isolation
        </h4>
        <span className="rounded bg-brand/15 border border-brand/30 px-1.5 py-0.5 text-2xs font-semibold text-brand">
          Sandboxed Stdio
        </span>
      </div>
      <p className="text-xs text-foreground-secondary leading-relaxed">
        MCP servers execute as bounded subprocesses. Tool invocations cannot access files outside
        the approved workspace or ambient credentials unless explicitly reviewed and authorized.
      </p>
    </div>
  );
}
