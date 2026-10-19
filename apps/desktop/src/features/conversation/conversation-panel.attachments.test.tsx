import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConversationPanel } from './conversation-panel';
import { fakeBackend, registryProvider, pickRegistryModel } from './conversation-panel-test-utils';

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

/** Registry model + a dispatch that terminals immediately, capturing payloads. */
function streamingBackend(payloads?: unknown[]) {
  const backend = fakeBackend();
  backend.completeOnceStreaming = vi.fn(async (_ws, _proj, _session, payload, onEvent) => {
    payloads?.push(payload);
    onEvent({ opId: 'op-1', sequence: 0, event: { type: 'started' } });
    onEvent({
      opId: 'op-1',
      sequence: 1,
      event: { type: 'completed', completion: 'completed', truncated: false, usage: null },
    });
    return { opId: 'op-1', messageId: 'm-1', context: null };
  });
  backend.stopCompletion = vi.fn(async () => ({ opId: 'op-1', status: 'cancelled' }));
  return backend;
}

/** No sessions: the panel starts unsaved, so files stay pending until a send. */
function withoutSessions<T extends ReturnType<typeof fakeBackend>>(backend: T): T {
  backend.listSessions = vi.fn().mockResolvedValue({ sessions: [], truncated: false });
  return backend;
}

function pickFile(name: string, body: string) {
  const input = screen.getByLabelText('Attach a text or code file', { selector: 'input' });
  const file = new File([body], name, { type: 'text/markdown' });
  fireEvent.change(input, { target: { files: [file] } });
}

async function composerBox() {
  return (await screen.findByRole('textbox', { name: /composer input/i })) as HTMLTextAreaElement;
}

describe('ConversationPanel attachments', () => {
  it('ingests a file at send time when the send materializes the session', async () => {
    const user = userEvent.setup();
    const payloads: Array<Record<string, unknown>> = [];
    const backend = withoutSessions(streamingBackend(payloads));
    render(<ConversationPanel backend={backend} provider={registryProvider()} />);
    await pickRegistryModel(user);

    pickFile('notes.md', '# notes');
    expect(await screen.findByText('notes.md')).toBeDefined();
    // No session yet: the file is honestly labelled as not yet read, and no
    // stored attachment is claimed before one exists.
    expect(await screen.findByText('Read when sent')).toBeDefined();
    expect(backend.ingestAttachment).not.toHaveBeenCalled();

    const box = await composerBox();
    await user.type(box, 'see attached');
    await user.keyboard('{Enter}');

    await waitFor(() => expect(payloads).toHaveLength(1));
    expect(backend.ingestAttachment).toHaveBeenCalledWith('ws-1', 'proj-1', 'sess-1', {
      fileName: 'notes.md',
      text: '# notes',
    });
    expect(payloads[0]).toMatchObject({ text: 'see attached', attachmentIds: ['att-1'] });
    expect(backend.submitMessage).not.toHaveBeenCalled();
  });

  it('sends a selected file alone, without text', async () => {
    const user = userEvent.setup();
    const payloads: Array<Record<string, unknown>> = [];
    const backend = withoutSessions(streamingBackend(payloads));
    render(<ConversationPanel backend={backend} provider={registryProvider()} />);
    await pickRegistryModel(user);

    pickFile('notes.md', '# notes');
    expect(await screen.findByText('notes.md')).toBeDefined();

    await user.click(await composerBox());
    await user.keyboard('{Enter}');

    await waitFor(() => expect(payloads).toHaveLength(1));
    expect(payloads[0]).toMatchObject({ text: '', attachmentIds: ['att-1'] });
  });

  it('ingests a picked file into the session immediately once one exists', async () => {
    const user = userEvent.setup();
    const backend = streamingBackend();
    render(<ConversationPanel backend={backend} provider={registryProvider()} />);
    await pickRegistryModel(user);

    pickFile('notes.md', 'later body');
    await waitFor(() =>
      expect(backend.ingestAttachment).toHaveBeenCalledWith('ws-1', 'proj-1', 'sess-1', {
        fileName: 'notes.md',
        text: 'later body',
      }),
    );
    expect(await screen.findByText('notes.md')).toBeDefined();
    expect(screen.queryByText('Read when sent')).toBeNull();
  });

  it('refuses the send when a selected file was refused, keeping it visible', async () => {
    const user = userEvent.setup();
    const backend = streamingBackend();
    backend.ingestAttachment = vi
      .fn()
      .mockRejectedValue(new Error('VALIDATION_FAILED: attachment.binaryContent'));
    render(<ConversationPanel backend={backend} provider={registryProvider()} />);
    await pickRegistryModel(user);

    pickFile('report.md', 'body');
    // The chip carries the localized refusal, and it is not removable-only.
    expect(await screen.findByText('File looks binary, not text')).toBeDefined();

    const box = await composerBox();
    await user.type(box, 'please look');
    await user.keyboard('{Enter}');

    // The send refuses visibly with its own reason; the model is never called
    // and the text stays in the composer.
    expect(
      await screen.findByText('Remove the files marked as refused, then send again.'),
    ).toBeDefined();
    expect(backend.completeOnceStreaming).not.toHaveBeenCalled();
    expect(screen.getByText('report.md')).toBeDefined();
    expect(box.value).toBe('please look');
  });

  it('refuses the pending dispatch when the file cannot be read at send time', async () => {
    const user = userEvent.setup();
    const backend = withoutSessions(streamingBackend());
    backend.ingestAttachment = vi
      .fn()
      .mockRejectedValue(new Error('VALIDATION_FAILED: attachment.binaryContent'));
    render(<ConversationPanel backend={backend} provider={registryProvider()} />);
    await pickRegistryModel(user);

    pickFile('report.md', '');
    expect(await screen.findByText('report.md')).toBeDefined();
    const box = await composerBox();
    await user.type(box, 'please look');
    await user.keyboard('{Enter}');

    // The refusal is the localized reason, the model was never called, the
    // text returns to the composer, and the file stays visible.
    expect((await screen.findAllByText('File looks binary, not text')).length).toBeGreaterThan(0);
    expect(backend.completeOnceStreaming).not.toHaveBeenCalled();
    expect(screen.getByText('report.md')).toBeDefined();
    expect(box.value).toBe('please look');
    // The tracked first-send identity is dismissed, never left to offer a
    // duplicate resend of a turn that never dispatched.
    await waitFor(() =>
      expect(backend.clearPendingOperation).toHaveBeenCalledWith(
        expect.objectContaining({ reason: 'dismissed' }),
        undefined,
      ),
    );
  });

  it('blocks a file send while a turn is running instead of queueing it', async () => {
    const user = userEvent.setup();
    const backend = streamingBackend();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    backend.completeOnceStreaming = vi.fn(async (_ws, _proj, _session, _payload, onEvent) => {
      onEvent({ opId: 'op-1', sequence: 0, event: { type: 'started' } });
      await gate;
      onEvent({
        opId: 'op-1',
        sequence: 1,
        event: { type: 'completed', completion: 'completed', truncated: false, usage: null },
      });
      return { opId: 'op-1', messageId: 'm-1', context: null };
    });
    render(<ConversationPanel backend={backend} provider={registryProvider()} />);
    await pickRegistryModel(user);

    const box = await composerBox();
    await user.type(box, 'first');
    await user.keyboard('{Enter}');
    await waitFor(() => expect(backend.completeOnceStreaming).toHaveBeenCalledTimes(1));

    // The picker button is disabled while running, but a drop or paste must
    // still refuse explicitly at send — never queue a chip-less text or a
    // file that the running turn cannot carry.
    pickFile('notes.md', '# notes');
    expect(await screen.findByText('notes.md')).toBeDefined();
    await user.type(box, 'second');
    await user.keyboard('{Enter}');

    expect(
      await screen.findByText(
        'Files cannot be queued while a turn is running. Wait for it to finish, then send them.',
      ),
    ).toBeDefined();
    expect(backend.completeOnceStreaming).toHaveBeenCalledTimes(1);
    release();
  });

  it('shows the files a sent message carried and previews the stored text', async () => {
    const user = userEvent.setup();
    const backend = withoutSessions(streamingBackend());
    backend.getConversation = vi.fn().mockResolvedValue({
      items: [
        {
          messageId: 'msg-1',
          role: 'user',
          text: 'see attached',
          createdAt: '2026-10-09T00:00:01Z',
          sourceEventId: 'evt-1',
          completion: null,
          reference: null,
          attachments: [
            {
              attachmentId: 'att-1',
              fileName: 'notes.md',
              mediaType: 'text/markdown',
              byteSize: 7,
              contentHash: 'hash-1',
              hashAlgorithm: 'blake3',
              extractedChars: 2500,
              truncated: true,
            },
          ],
        },
      ],
      nextCursor: null,
      projectionPosition: '1',
    });
    backend.readAttachmentText = vi.fn().mockResolvedValue({
      attachmentId: 'att-1',
      fileName: 'notes.md',
      mediaType: 'text/markdown',
      byteSize: 7,
      contentHash: 'hash-1',
      hashAlgorithm: 'blake3',
      extractedChars: 2500,
      truncated: true,
      retention: 'session',
      text: 'stored file body',
    });
    render(<ConversationPanel backend={backend} provider={registryProvider()} />);
    await pickRegistryModel(user);

    pickFile('notes.md', '# notes');
    expect(await screen.findByText('notes.md')).toBeDefined();
    const box = await composerBox();
    await user.type(box, 'see attached');
    await user.keyboard('{Enter}');

    // After the terminal reload the chip comes from the stored link row, with
    // the truncation state the backend recorded.
    const preview = await screen.findByRole('button', { name: 'Preview' });
    expect(screen.getByText('Truncated')).toBeDefined();
    await user.click(preview);
    expect(await screen.findByText('stored file body')).toBeDefined();
    expect(backend.readAttachmentText).toHaveBeenCalledWith('ws-1', 'proj-1', 'sess-1', 'att-1');
  });
});
