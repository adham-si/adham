/**
 * Versioned message content model.
 *
 * Schema 1 carries plain text parts — the only part the projection persists
 * today — so `contentFromText` is the backward-compatible migration for
 * existing text history. Parts this client does not render are kept as inert
 * source rather than dropped, and a card must never invent a part the
 * backend did not send.
 */

export const MESSAGE_CONTENT_SCHEMA = 1;

export type MessageContentPart =
  | { type: 'text'; text: string }
  /** A part kind this client cannot render yet; `raw` preserves the source. */
  | { type: 'unknown'; raw: string };

export interface MessageContent {
  schema: number;
  parts: MessageContentPart[];
}

export function contentFromText(text: string): MessageContent {
  return { schema: MESSAGE_CONTENT_SCHEMA, parts: [{ type: 'text', text }] };
}
