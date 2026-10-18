import { describe, expect, it } from 'vitest';
import { contentFromText, MESSAGE_CONTENT_SCHEMA } from './message-content';

describe('message content', () => {
  it('migrates legacy text history into a schema 1 text part', () => {
    expect(contentFromText('hello')).toEqual({
      schema: MESSAGE_CONTENT_SCHEMA,
      parts: [{ type: 'text', text: 'hello' }],
    });
  });
});
