import type { Plugin } from "@opencode-ai/plugin"

// Local-only example plugin. Auto-loaded from .opencode/plugin/*.ts.
// No entry in opencode.json needed.
export default (async () => {
  return {
    config: (cfg: any) => {
      // Keep project-local defaults. Do not override user auth/models here.
      cfg.snapshot ??= true
    },
  }
}) satisfies Plugin
