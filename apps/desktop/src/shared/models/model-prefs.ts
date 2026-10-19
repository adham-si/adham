import * as React from 'react';

/**
 * "Enabled in chat" preference for registry-pinned provider models. Absence
 * means enabled: a fresh connection shows all its discovered models in the
 * composer until the user curates them. Only explicit opt-outs are stored —
 * "Enable all" deletes keys instead of writing trues.
 */
type PrefsByAccount = Record<string, Record<string, boolean>>;

const STORAGE_KEY = 'adham.modelPrefs.v1';

let listeners = new Set<() => void>();
let cache: { raw: string; value: PrefsByAccount } = { raw: 'missing', value: {} };

function prefs(): PrefsByAccount {
  const raw = window.localStorage.getItem(STORAGE_KEY) ?? '';
  if (raw !== cache.raw) {
    cache = { raw, value: raw ? (JSON.parse(raw) as PrefsByAccount) : {} };
  }
  return cache.value;
}

/** Cross-surface sync: settings page and composer listen on the same store. */
function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function commit(next: PrefsByAccount): void {
  const raw = JSON.stringify(next);
  window.localStorage.setItem(STORAGE_KEY, raw);
  cache = { raw, value: next };
  listeners.forEach((l) => l());
}

export function isModelEnabled(accountId: string, modelId: string): boolean {
  return prefs()[accountId]?.[modelId] ?? true;
}

export function setModelEnabled(accountId: string, modelId: string, enabled: boolean): void {
  const next = { ...prefs() };
  const byModel = { ...next[accountId] };
  // absence = enabled: an opt-back-in deletes the record
  if (enabled) delete byModel[modelId];
  else byModel[modelId] = false;
  if (Object.keys(byModel).length === 0) delete next[accountId];
  else next[accountId] = byModel;
  commit(next);
}

export function setAllModelsEnabled(
  accountId: string,
  enabled: boolean,
  modelIds: readonly string[],
): void {
  const next = { ...prefs() };
  if (enabled) {
    delete next[accountId];
  } else {
    const byModel: Record<string, boolean> = {};
    for (const id of modelIds) byModel[id] = false;
    next[accountId] = byModel;
  }
  commit(next);
}

export function useModelPrefs(): {
  isEnabled: (accountId: string, modelId: string) => boolean;
  setEnabled: (accountId: string, modelId: string, enabled: boolean) => void;
  setAllEnabled: (accountId: string, enabled: boolean, modelIds: readonly string[]) => void;
} {
  // The snapshot (prefs()) is recomputed from localStorage on every store
  // notification; useSyncExternalStore just needs the subscription below.
  React.useSyncExternalStore(subscribe, () => window.localStorage.getItem(STORAGE_KEY) ?? '');
  return {
    isEnabled: isModelEnabled,
    setEnabled: setModelEnabled,
    setAllEnabled: (accountId, enabled, modelIds) =>
      setAllModelsEnabled(accountId, enabled, modelIds),
  };
}
