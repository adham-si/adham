import { describe, expect, it } from 'vitest';
import { alternativeIndex } from './alternative-groups';

const user = (id: string, root?: string) => ({
  id,
  role: 'user',
  reference: root ? { refersToMessageId: root, relation: 'edited-from' } : null,
});
const assistant = (id: string) => ({ id, role: 'assistant', reference: null });

describe('alternativeIndex', () => {
  it('marks the newest edit active by default and the original as alternative', () => {
    const index = alternativeIndex(
      [user('q1'), assistant('a1'), user('q2', 'q1'), assistant('a2')],
      [],
    );
    expect(index.get('q1')).toEqual({ rootId: 'q1', active: false });
    expect(index.get('q2')).toEqual({ rootId: 'q1', active: true });
    expect(index.has('a1')).toBe(false);
    expect(index.has('a2')).toBe(false);
  });

  it('honours an explicit selection of the original', () => {
    const index = alternativeIndex(
      [user('q1'), user('q2', 'q1')],
      [{ rootMessageId: 'q1', activeMessageId: 'q1' }],
    );
    expect(index.get('q1')?.active).toBe(true);
    expect(index.get('q2')?.active).toBe(false);
  });

  it('falls back to the newest edit when the selection names a non-member', () => {
    const index = alternativeIndex(
      [user('q1'), user('q2', 'q1')],
      [{ rootMessageId: 'q1', activeMessageId: 'gone' }],
    );
    expect(index.get('q2')?.active).toBe(true);
  });

  it('leaves branches whose root is outside the loaded history unmarked', () => {
    const index = alternativeIndex([user('q2', 'q1')], []);
    expect(index.size).toBe(0);
  });

  it('never groups a quoted reply or a lone message', () => {
    const index = alternativeIndex(
      [
        user('q1'),
        { id: 'q2', role: 'user', reference: { refersToMessageId: 'q1', relation: 'replied' } },
      ],
      [],
    );
    expect(index.size).toBe(0);
  });

  it('keeps chained edits in one chain: only the newest member is active', () => {
    const index = alternativeIndex([user('q1'), user('q2', 'q1'), user('q3', 'q2')], []);
    expect(index.get('q1')?.active).toBe(false);
    expect(index.get('q2')?.active).toBe(false);
    expect(index.get('q3')?.active).toBe(true);
  });
});
