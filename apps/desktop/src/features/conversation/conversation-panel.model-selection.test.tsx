import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConversationPanel } from './conversation-panel';
import { fakeBackend, registryProvider, pickRegistryModel } from './conversation-panel-test-utils';

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

describe('ConversationPanel model selection', () => {
  it('renders no unknown-telemetry dashboard and discloses the model gap in production', async () => {
    const backend = fakeBackend();
    render(<ConversationPanel backend={backend} />);
    await screen.findByRole('textbox', { name: /composer input/i });

    // no evidence → no context strip at all, and no invented numbers
    expect(screen.queryByText(/unknown/i)).toBeNull();
    expect(screen.getByText(/model selection is not applied/i)).toBeDefined();
    expect(screen.queryByText(/12\.4k \/ 128k/)).toBeNull();
    expect(screen.queryByText(/adham\.si/)).toBeNull();
  });

  it('keeps the explicit model choice per session across a remount and dispatches with it', async () => {
    const user = userEvent.setup();
    const backend = fakeBackend();
    const payloads: { modelId?: string }[] = [];
    backend.completeOnceStreaming = vi.fn(async (_ws, _p, _s, payload) => {
      payloads.push(payload as { modelId?: string });
      return { opId: 'op-1', messageId: 'm-1', context: null };
    });
    backend.stopCompletion = vi.fn(async () => ({ opId: 'op-1', status: 'cancelled' }));
    const first = render(<ConversationPanel backend={backend} provider={registryProvider()} />);

    await pickRegistryModel(user);
    await waitFor(() =>
      expect(localStorage.getItem('adham:compose:model:sess-1')).toBe('qwen2.5:latest'),
    );

    // Reopen: the choice is restored from the session bucket, never re-picked
    // and never a discovery-order default.
    first.unmount();
    render(<ConversationPanel backend={backend} provider={registryProvider()} />);
    expect(
      await screen.findByRole('button', { name: /Current model is Qwen 2\.5 \(latest\)/i }),
    ).toBeDefined();

    const box = (await screen.findByRole('textbox', {
      name: /composer input/i,
    })) as HTMLTextAreaElement;
    await user.type(box, 'hi');
    await user.keyboard('{Enter}');
    await waitFor(() => expect(payloads).toHaveLength(1));
    expect(payloads[0]!.modelId).toBe('qwen2.5:latest');
  });

  it('explains a vanished stored model and never silently substitutes another', async () => {
    const user = userEvent.setup();
    localStorage.setItem('adham:compose:model:sess-1', 'ghost:70b');
    const backend = fakeBackend();
    backend.completeOnceStreaming = vi.fn();
    render(<ConversationPanel backend={backend} provider={registryProvider()} />);

    // The stale claim is named, the picker stays the only way to a usable
    // model, and the send is honestly the text-only path.
    await screen.findByText(/ghost:70b/);
    expect(screen.getByText(/no longer available/i)).toBeDefined();
    expect(screen.getByRole('button', { name: 'Select a model' })).toBeDefined();

    const box = (await screen.findByRole('textbox', {
      name: /composer input/i,
    })) as HTMLTextAreaElement;
    await user.type(box, 'hi');
    await user.keyboard('{Enter}');
    await waitFor(() => expect(backend.submitMessage).toHaveBeenCalled());
    expect(backend.completeOnceStreaming).not.toHaveBeenCalled();
  });

  it('names the missing provider instead of leaving the model gap generic', async () => {
    const backend = fakeBackend();
    const provider = {
      listAccounts: vi.fn(async () => ({ accounts: [] })),
      listModels: vi.fn(),
    } as unknown as NonNullable<Parameters<typeof ConversationPanel>[0]['provider']>;
    render(<ConversationPanel backend={backend} provider={provider} />);

    await screen.findByText(/no model provider is connected/i);
    // With no account there is nothing to select, so no shallow picker.
    expect(screen.queryByRole('button', { name: 'Select a model' })).toBeNull();
    expect(provider.listModels).not.toHaveBeenCalled();
  });

  it('carries a stale pre-session pick into the session the first text-only send created', async () => {
    const user = userEvent.setup();
    // A pre-session pick that discovery no longer lists: the honest text-only
    // path creates the session, and the claim moves with it instead of being
    // silently dropped or silently replaced.
    localStorage.setItem('adham:compose:model:pending', 'ghost:70b');
    const backend = fakeBackend();
    backend.listSessions = vi.fn().mockResolvedValue({ sessions: [], truncated: false });
    backend.completeOnceStreaming = vi.fn();
    render(<ConversationPanel backend={backend} provider={registryProvider()} />);

    await screen.findByText(/ghost:70b/);
    const box = (await screen.findByRole('textbox', {
      name: /composer input/i,
    })) as HTMLTextAreaElement;
    await user.type(box, 'hi');
    await user.keyboard('{Enter}');

    await waitFor(() =>
      expect(localStorage.getItem('adham:compose:model:sess-1')).toBe('ghost:70b'),
    );
    expect(localStorage.getItem('adham:compose:model:pending')).toBeNull();
    // The vanished claim is still the session's remembered choice: explained,
    // never silently substituted. (While the turn persisted, the provider list
    // was briefly unresolved, so the explained block returns only after ready.)
    await screen.findByText(/no longer available/i);
    expect(backend.completeOnceStreaming).not.toHaveBeenCalled();
  });
});
