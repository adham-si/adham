import { describe, it, expect, beforeEach } from 'vitest';
import {
  buildSessionSelectionKey,
  clearDurableSessionPreference,
  readDurableSessionPreference,
  writeDurableSessionPreference,
} from './durable-session-storage';

describe('durableSessionStorage', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('keys storage strictly by installation, workspace, and project', () => {
    const key = buildSessionSelectionKey('inst-1', 'ws-1', 'proj-1');
    expect(key).toBe('adham:session:selected:inst-1:ws-1:proj-1');
  });

  it('persists and restores technical IDs only', () => {
    const written = writeDurableSessionPreference({
      installationId: 'inst-1',
      workspaceId: 'ws-1',
      projectId: 'proj-1',
      sessionId: 'sess-1',
    });
    expect(written).toBe(true);

    const storedRaw = localStorage.getItem('adham:session:selected:inst-1:ws-1:proj-1');
    expect(storedRaw).not.toBeNull();
    const parsed = JSON.parse(storedRaw ?? '{}');
    expect(parsed).toEqual({
      installationId: 'inst-1',
      workspaceId: 'ws-1',
      projectId: 'proj-1',
      sessionId: 'sess-1',
    });
    // Never contains message content or user text
    expect(parsed.text).toBeUndefined();
    expect(parsed.content).toBeUndefined();

    const read = readDurableSessionPreference('inst-1', 'ws-1', 'proj-1');
    expect(read).toEqual({
      installationId: 'inst-1',
      workspaceId: 'ws-1',
      projectId: 'proj-1',
      sessionId: 'sess-1',
    });
  });

  it('different installations or scopes never cross-pollinate selections', () => {
    writeDurableSessionPreference({
      installationId: 'inst-A',
      workspaceId: 'ws-1',
      projectId: 'proj-1',
      sessionId: 'sess-A',
    });

    // Same workspace and project under different installation ID returns null
    expect(readDurableSessionPreference('inst-B', 'ws-1', 'proj-1')).toBeNull();

    // Different project in same installation returns null
    expect(readDurableSessionPreference('inst-A', 'ws-1', 'proj-2')).toBeNull();
  });

  it('clear removes the exact scoped preference', () => {
    writeDurableSessionPreference({
      installationId: 'inst-1',
      workspaceId: 'ws-1',
      projectId: 'proj-1',
      sessionId: 'sess-1',
    });
    expect(readDurableSessionPreference('inst-1', 'ws-1', 'proj-1')).not.toBeNull();

    clearDurableSessionPreference('inst-1', 'ws-1', 'proj-1');
    expect(readDurableSessionPreference('inst-1', 'ws-1', 'proj-1')).toBeNull();
  });

  it('rejects malformed or empty session IDs', () => {
    localStorage.setItem(
      'adham:session:selected:inst-1:ws-1:proj-1',
      JSON.stringify({
        installationId: 'inst-1',
        workspaceId: 'ws-1',
        projectId: 'proj-1',
        sessionId: '   ',
      }),
    );
    expect(readDurableSessionPreference('inst-1', 'ws-1', 'proj-1')).toBeNull();
  });
});
