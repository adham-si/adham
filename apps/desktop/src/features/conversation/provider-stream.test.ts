import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { notifyProvidersChanged } from '@/shared/providers/provider-events';
import { useOllamaProvider, type ProviderBackend } from './provider-stream';

const account = {
  accountId: 'acc-1',
  alias: 'Local Ollama',
  endpointUrl: 'http://127.0.0.1:11434',
  privacyClass: 'local_only',
  kind: 'ollama_local',
};

const model = {
  modelId: 'qwen2.5:latest',
  digest: 'sha256:abc',
  humanLabel: 'Qwen 2.5 (latest)',
  privacyClass: 'local_only',
  kind: 'ollama_local',
  capabilities: {
    streaming: 'supported',
    structuredOutput: 'unknown',
    toolProposals: 'unknown',
    thinking: 'unknown',
  },
};

describe('useOllamaProvider settings refresh', () => {
  it('re-lists accounts and models when provider settings change', async () => {
    let accounts: Array<typeof account> = [];
    const listAccounts = vi.fn(async () => ({ accounts }));
    const listModels = vi.fn(async () => ({ models: [model] }));
    const backend = { listAccounts, listModels } as unknown as ProviderBackend;

    const { result, unmount } = renderHook(() =>
      useOllamaProvider({
        backend,
        context: { workspaceId: 'ws-1', projectId: 'proj-1', sessionId: null },
        enabled: true,
      }),
    );
    await waitFor(() => expect(result.current.accountsLoaded).toBe(true));
    expect(result.current.account).toBeNull();

    // Settings connected a provider while the composer stayed mounted.
    accounts = [account];
    act(() => notifyProvidersChanged());
    await waitFor(() => expect(result.current.account?.accountId).toBe('acc-1'));
    await waitFor(() => expect(result.current.models).toHaveLength(1));
    expect(listAccounts).toHaveBeenCalledTimes(2);
    expect(listModels).toHaveBeenCalledTimes(1);
    unmount();
  });
});
