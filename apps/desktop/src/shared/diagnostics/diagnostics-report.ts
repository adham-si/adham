/**
 * Sanitized diagnostics report (SETTINGS-01 Pillar 1).
 *
 * Explicit allowlist: application version, build profile, OS, architecture,
 * storage status, journal mode and schema version. The data directory,
 * prompts, content, credentials, file paths and identifiers are never
 * included — the report is safe to paste into a support channel.
 */
export interface DiagnosticsPlatformSource {
  os: string;
  arch: string;
  appVersion: string;
  buildProfile: string;
}

export interface DiagnosticsStorageSource {
  status: string;
  journalMode: string;
  schemaVersion: number;
}

export interface DiagnosticsReport {
  appVersion: string;
  buildProfile: string;
  os: string;
  arch: string;
  storageStatus: string;
  journalMode: string;
  schemaVersion: number;
}

export function buildDiagnosticsReport(sources: {
  platform: DiagnosticsPlatformSource;
  storage: DiagnosticsStorageSource;
}): DiagnosticsReport {
  return {
    appVersion: sources.platform.appVersion,
    buildProfile: sources.platform.buildProfile,
    os: sources.platform.os,
    arch: sources.platform.arch,
    storageStatus: sources.storage.status,
    journalMode: sources.storage.journalMode,
    schemaVersion: sources.storage.schemaVersion,
  };
}
