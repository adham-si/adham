import { describe, expect, it } from 'vitest';
import { buildDiagnosticsReport } from './diagnostics-report';

describe('buildDiagnosticsReport', () => {
  it('contains exactly the public allowlist — no paths, versions only', () => {
    const report = buildDiagnosticsReport({
      platform: { os: 'macos', arch: 'aarch64', appVersion: '0.1.0', buildProfile: 'debug' },
      storage: { status: 'ready', journalMode: 'wal', schemaVersion: 1 },
    });
    expect(report).toEqual({
      appVersion: '0.1.0',
      buildProfile: 'debug',
      os: 'macos',
      arch: 'aarch64',
      storageStatus: 'ready',
      journalMode: 'wal',
      schemaVersion: 1,
    });
  });

  it('never leaks the data directory or other private facts', () => {
    const report = buildDiagnosticsReport({
      platform: { os: 'linux', arch: 'x86_64', appVersion: '0.1.0', buildProfile: 'release' },
      storage: { status: 'ready', journalMode: 'wal', schemaVersion: 1 },
    });
    const serialized = JSON.stringify(report);
    expect(serialized).not.toContain('home');
    expect(serialized).not.toContain('Users');
    expect(Object.keys(report)).toHaveLength(7);
  });
});
