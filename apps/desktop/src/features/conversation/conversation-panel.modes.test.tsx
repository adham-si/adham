import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConversationPanel } from './conversation-panel';
import { fakeBackend, registryProvider, pickRegistryModel } from './conversation-panel-test-utils';

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

describe('ConversationPanel modes and settings', () => {
  it('disables execute mode with the runtime explanation instead of offering a turn', async () => {
    const user = userEvent.setup();
    const backend = fakeBackend();
    render(<ConversationPanel backend={backend} />);
    await screen.findByRole('textbox', { name: /composer input/i });

    // No policy/tool runtime exists to execute under: the entry is present
    // for discoverability, explains itself, and refuses activation.
    const trigger = screen.getByRole('button', { name: /execution mode/i });
    const before = trigger.getAttribute('aria-label');
    await user.click(trigger);
    const execute = screen.getByRole('option', { name: /execute/i });
    expect(execute.getAttribute('aria-disabled')).toBe('true');
    expect(execute.textContent).toMatch(/policy and tool runtime/i);
    await user.click(execute);
    expect(trigger.getAttribute('aria-label')).toBe(before);
    expect(window.localStorage.getItem('adham:compose:mode')).toBeNull();
    expect(screen.queryByText(/Verified sandbox execution/i)).toBeNull();
  });

  it('dispatches the selected mode with the turn and remembers it', async () => {
    const user = userEvent.setup();
    const backend = fakeBackend();
    backend.getConversation.mockResolvedValue({
      items: [],
      nextCursor: null,
      projectionPosition: '0',
    });
    const payloads: Array<{ mode?: string }> = [];
    backend.completeOnceStreaming = vi.fn(async (_ws, _p, _s, payload, onEvent) => {
      payloads.push(payload as { mode?: string });
      onEvent({ opId: 'op-m', sequence: 0, event: { type: 'started' } });
      onEvent({
        opId: 'op-m',
        sequence: 1,
        event: { type: 'completed', completion: 'completed', truncated: false, usage: null },
      });
      return { opId: 'op-m', messageId: 'm-m', context: null };
    });
    backend.stopCompletion = vi.fn(async () => ({ opId: 'op-m', status: 'cancelled' }));
    render(<ConversationPanel backend={backend} provider={registryProvider()} />);
    const box = (await screen.findByRole('textbox', {
      name: /composer input/i,
    })) as HTMLTextAreaElement;
    await pickRegistryModel(user);

    await user.click(screen.getByRole('button', { name: /execution mode/i }));
    await user.click(screen.getByRole('option', { name: /ask/i }));
    await user.type(box, 'a question');
    await user.keyboard('{Enter}');

    await waitFor(() => expect(payloads).toHaveLength(1));
    expect(payloads[0]!.mode).toBe('ask');
    expect(window.localStorage.getItem('adham:compose:mode')).toBe('ask');
  });

  it('restores the last used mode and never restores execute', async () => {
    window.localStorage.setItem('adham:compose:mode', 'execute');
    render(<ConversationPanel backend={fakeBackend()} />);
    await screen.findByRole('textbox', { name: /composer input/i });
    // A stored execute is stale: it is not selectable, so the first-run
    // default applies instead of resurrecting an unavailable mode.
    expect(
      screen.getByRole('button', { name: /execution mode/i }).getAttribute('aria-label'),
    ).toMatch(/plan/i);

    window.localStorage.setItem('adham:compose:mode', 'code');
    render(<ConversationPanel backend={fakeBackend()} />);
    const triggers = await screen.findAllByRole('button', { name: /execution mode/i });
    expect(triggers.at(-1)!.getAttribute('aria-label')).toMatch(/code/i);
  });

  it('sends only model-documented thinking values, never for undocumented models', async () => {
    const user = userEvent.setup();
    const backend = fakeBackend();
    backend.getConversation.mockResolvedValue({
      items: [],
      nextCursor: null,
      projectionPosition: '0',
    });
    const payloads: Array<Record<string, unknown>> = [];
    backend.completeOnceStreaming = vi.fn(async (_ws, _p, _s, payload, onEvent) => {
      payloads.push(payload as Record<string, unknown>);
      const opId = `op-t${payloads.length}`;
      onEvent({ opId, sequence: 0, event: { type: 'started' } });
      onEvent({
        opId,
        sequence: 1,
        event: { type: 'completed', completion: 'completed', truncated: false, usage: null },
      });
      return { opId, messageId: `m-${opId}`, context: null };
    });
    backend.stopCompletion = vi.fn(async () => ({ opId: 'op-t1', status: 'cancelled' }));

    // Documented values: an off choice is dispatched as the boolean.
    const values = ['true', 'false', 'medium'];
    const first = render(
      <ConversationPanel backend={backend} provider={registryProvider('supported', values)} />,
    );
    const box = (await screen.findByRole('textbox', {
      name: /composer input/i,
    })) as HTMLTextAreaElement;
    await pickRegistryModel(user);
    await user.click(screen.getByRole('button', { name: /Select model/i }));
    await user.click(screen.getByLabelText(/Disable thinking/i));
    await user.keyboard('{Escape}');
    await user.type(box, 'think later');
    await user.keyboard('{Enter}');
    await waitFor(() => expect(payloads).toHaveLength(1));
    expect(payloads[0]!.think).toBe(false);
    first.unmount();

    // A documented level travels verbatim. The choice is remembered across
    // the remount, so the picker re-opens on the same model — no re-pick.
    const second = render(
      <ConversationPanel backend={backend} provider={registryProvider('supported', values)} />,
    );
    const levelBox = (await screen.findByRole('textbox', {
      name: /composer input/i,
    })) as HTMLTextAreaElement;
    await user.click(
      await screen.findByRole('button', { name: /Current model is Qwen 2\.5 \(latest\)/i }),
    );
    await user.click(screen.getByRole('button', { name: 'medium' }));
    await user.keyboard('{Escape}');
    await user.type(levelBox, 'think less');
    await user.keyboard('{Enter}');
    await waitFor(() => expect(payloads).toHaveLength(2));
    expect(payloads[1]!.think).toBe('medium');
    second.unmount();

    // No documented values: no control, and no parameter on the wire. The
    // same remembered model is still the selection, so no re-pick either.
    render(<ConversationPanel backend={backend} provider={registryProvider('unknown')} />);
    const plainBox = (await screen.findByRole('textbox', {
      name: /composer input/i,
    })) as HTMLTextAreaElement;
    await user.click(
      await screen.findByRole('button', { name: /Current model is Qwen 2\.5 \(latest\)/i }),
    );
    expect(screen.queryByLabelText(/Disable thinking/i)).toBeNull();
    await user.keyboard('{Escape}');
    await user.type(plainBox, 'plain');
    await user.keyboard('{Enter}');
    await waitFor(() => expect(payloads).toHaveLength(3));
    expect('think' in payloads[2]!).toBe(false);
  });

  it('surfaces omitted context from the dispatch assembly, never silently', async () => {
    const user = userEvent.setup();
    const backend = fakeBackend();
    backend.getConversation.mockResolvedValue({
      items: [],
      nextCursor: null,
      projectionPosition: '0',
    });
    backend.completeOnceStreaming = vi.fn(async (_ws, _p, _s, _payload, onEvent) => {
      onEvent({ opId: 'op-c', sequence: 0, event: { type: 'started' } });
      onEvent({
        opId: 'op-c',
        sequence: 1,
        event: { type: 'completed', completion: 'completed', truncated: false, usage: null },
      });
      return {
        opId: 'op-c',
        messageId: 'm-c',
        context: { estimatedInputTokens: 900, inputBudgetTokens: 512, droppedMessages: 3 },
      };
    });
    backend.stopCompletion = vi.fn(async () => ({ opId: 'op-c', status: 'cancelled' }));
    render(<ConversationPanel backend={backend} provider={registryProvider()} />);
    const box = (await screen.findByRole('textbox', {
      name: /composer input/i,
    })) as HTMLTextAreaElement;
    await pickRegistryModel(user);

    await user.type(box, 'a question');
    await user.keyboard('{Enter}');

    // The turn completed, but history was trimmed to fit: the user sees how
    // many messages were omitted instead of a silent drop.
    await screen.findByText(/Older messages were omitted/i);
    expect(screen.getByText(/Omitted messages:\s*3/)).not.toBeNull();
  });
});
