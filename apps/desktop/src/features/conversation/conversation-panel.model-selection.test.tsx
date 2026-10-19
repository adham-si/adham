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
  it('renders no unknown-telemetry dashboard and keeps the model control visible', async () => {
    const backend = fakeBackend();
    render(<ConversationPanel backend={backend} />);
    await screen.findByRole('textbox', { name: /composer input/i });

    // no evidence → no context strip at all, and no invented numbers
    expect(screen.queryByText(/unknown/i)).toBeNull();
    // Unresolved provider state is neutral: the control is there to select.
    expect(screen.getByRole('button', { name: 'Select a model' })).toBeDefined();
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
      expect(localStorage.getItem('adham:compose:model:ws-1:proj-1:sess-1')).toBe('qwen2.5:latest'),
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

  it('never silently substitutes a vanished stored model', async () => {
    const user = userEvent.setup();
    localStorage.setItem('adham:compose:model:ws-1:proj-1:sess-1', 'ghost:70b');
    const backend = fakeBackend();
    backend.completeOnceStreaming = vi.fn();
    render(<ConversationPanel backend={backend} provider={registryProvider()} />);

    // The picker stays the only way to a usable model, and the send is
    // honestly the text-only path.
    expect(await screen.findByRole('button', { name: 'Select a model' })).toBeDefined();

    const box = (await screen.findByRole('textbox', {
      name: /composer input/i,
    })) as HTMLTextAreaElement;
    await user.type(box, 'hi');
    await user.keyboard('{Enter}');
    await waitFor(() => expect(backend.submitMessage).toHaveBeenCalled());
    expect(backend.completeOnceStreaming).not.toHaveBeenCalled();
  });

  it('shows the unavailable state in the picker when no provider is connected', async () => {
    const user = userEvent.setup();
    const backend = fakeBackend();
    const provider = {
      listAccounts: vi.fn(async () => ({ accounts: [] })),
      listModels: vi.fn(),
    } as unknown as NonNullable<Parameters<typeof ConversationPanel>[0]['provider']>;
    render(<ConversationPanel backend={backend} provider={provider} />);

    // The control stays visible and names the state; the popover says what to
    // do instead of a separate sentence above the composer.
    await user.click(await screen.findByRole('button', { name: 'No model available' }));
    expect(screen.getByText(/set up a model in settings/i)).toBeDefined();
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

    await screen.findByRole('button', { name: 'Select a model' });
    const box = (await screen.findByRole('textbox', {
      name: /composer input/i,
    })) as HTMLTextAreaElement;
    await user.type(box, 'hi');
    await user.keyboard('{Enter}');

    await waitFor(() =>
      expect(localStorage.getItem('adham:compose:model:ws-1:proj-1:sess-1')).toBe('ghost:70b'),
    );
    expect(localStorage.getItem('adham:compose:model:ws-1:proj-1:pending')).toBeNull();
    // The vanished claim stays the session's remembered choice: never silently
    // substituted, and the picker is still the way to replace it.
    await screen.findByRole('button', { name: 'Select a model' });
    expect(backend.completeOnceStreaming).not.toHaveBeenCalled();
  });
});
