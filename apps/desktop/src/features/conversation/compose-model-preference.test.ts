import { beforeEach, describe, expect, it } from 'vitest';
import {
  migratePendingModelChoice,
  readComposeModelPreference,
  writeComposeModelPreference,
} from './compose-model-preference';

const PENDING_KEY = 'adham:compose:model:pending';

beforeEach(() => {
  localStorage.clear();
});

describe('compose model preference', () => {
  it('round-trips a choice per session bucket and never leaks across sessions', () => {
    expect(readComposeModelPreference('sess-1')).toBeNull();
    writeComposeModelPreference('sess-1', 'qwen2.5:latest');
    expect(readComposeModelPreference('sess-1')).toBe('qwen2.5:latest');
    expect(readComposeModelPreference('sess-2')).toBeNull();
  });

  it('refuses empty ids and survives unreadable storage', () => {
    writeComposeModelPreference('sess-1', '');
    expect(localStorage.getItem('adham:compose:model:sess-1')).toBeNull();
  });

  it('carries a pre-session pick into the session the first send materialized', () => {
    writeComposeModelPreference('pending', 'qwen2.5:latest');
    migratePendingModelChoice('sess-1');
    expect(readComposeModelPreference('sess-1')).toBe('qwen2.5:latest');
    expect(localStorage.getItem(PENDING_KEY)).toBeNull();
  });

  it('never overwrites a session that already made its own choice', () => {
    writeComposeModelPreference('sess-1', 'sess-choice:latest');
    writeComposeModelPreference('pending', 'pending-choice:latest');
    migratePendingModelChoice('sess-1');
    expect(readComposeModelPreference('sess-1')).toBe('sess-choice:latest');
    expect(localStorage.getItem(PENDING_KEY)).toBe('pending-choice:latest');
  });

  it('is a no-op for the pending bucket itself', () => {
    writeComposeModelPreference('pending', 'qwen2.5:latest');
    migratePendingModelChoice('pending');
    expect(readComposeModelPreference('pending')).toBe('qwen2.5:latest');
  });

  it('does nothing when no pre-session pick exists', () => {
    migratePendingModelChoice('sess-2');
    expect(readComposeModelPreference('sess-2')).toBeNull();
  });

  it('adopts only the pending pick of the matching project scope', () => {
    writeComposeModelPreference('ws-1:proj-1:pending', 'project-one:latest');
    writeComposeModelPreference('ws-1:proj-2:pending', 'project-two:latest');
    migratePendingModelChoice('ws-1:proj-1:sess-1', 'ws-1:proj-1:pending');
    expect(readComposeModelPreference('ws-1:proj-1:sess-1')).toBe('project-one:latest');
    expect(readComposeModelPreference('ws-1:proj-2:pending')).toBe('project-two:latest');
  });
});
