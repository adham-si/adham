import { describe, expect, it } from 'vitest';
import { contentFromText, contentToText, MESSAGE_CONTENT_SCHEMA } from './message-content';

describe('message content', () => {
  it('migrates legacy text history into a schema 1 text part', () => {
    expect(contentFromText('hello')).toEqual({
      schema: MESSAGE_CONTENT_SCHEMA,
      parts: [{ type: 'text', text: 'hello' }],
    });
  });

  it('round-trips text through contentToText', () => {
    expect(contentToText(contentFromText('hello **world**'))).toBe('hello **world**');
  });

  it('joins multiple text parts in order', () => {
    const content = {
      schema: MESSAGE_CONTENT_SCHEMA,
      parts: [
        { type: 'text' as const, text: 'first' },
        { type: 'text' as const, text: 'second' },
      ],
    };
    expect(contentToText(content)).toBe('first\n\nsecond');
  });

  it('excludes unrenderable parts: their raw form is not message text', () => {
    const content = {
      schema: MESSAGE_CONTENT_SCHEMA,
      parts: [
        { type: 'text' as const, text: 'kept' },
        { type: 'unknown' as const, raw: '{"kind":"chart"}' },
      ],
    };
    expect(contentToText(content)).toBe('kept');
  });

  it('is empty for content with no text part', () => {
    const content = {
      schema: MESSAGE_CONTENT_SCHEMA,
      parts: [{ type: 'unknown' as const, raw: '{"kind":"chart"}' }],
    };
    expect(contentToText(content)).toBe('');
  });
});
