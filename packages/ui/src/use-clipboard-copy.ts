import * as React from 'react';

export type CopyState = 'idle' | 'copied' | 'failed';

/**
 * Awaited clipboard write with visible outcome states. A rejected write or a
 * missing clipboard API lands on `failed` — a copy that did not happen is
 * never reported as one that did.
 */
export function useClipboardCopy() {
  const [state, setState] = React.useState<CopyState>('idle');

  const copy = React.useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setState('copied');
    } catch {
      setState('failed');
    }
  }, []);

  const reset = React.useCallback(() => setState('idle'), []);

  return { state, copy, reset };
}
