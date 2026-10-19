const PROVIDERS_CHANGED_EVENT = 'adham:providers-changed';

/** Cross-surface refresh: a settings mutation (connect, sync, disconnect)
 *  announces itself so cached reads elsewhere — the composer's account and
 *  model lists — refresh instead of keeping a stale claim. */
export function notifyProvidersChanged(): void {
  window.dispatchEvent(new Event(PROVIDERS_CHANGED_EVENT));
}

export function onProvidersChanged(listener: () => void): () => void {
  window.addEventListener(PROVIDERS_CHANGED_EVENT, listener);
  return () => window.removeEventListener(PROVIDERS_CHANGED_EVENT, listener);
}
