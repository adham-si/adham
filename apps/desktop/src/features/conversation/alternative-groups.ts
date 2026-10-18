/**
 * Branch grouping for edited prompts (line 65).
 *
 * Editing a prompt and resending appends an alternative; the original and its
 * answers stay persisted and visible. This module derives, from loaded history
 * plus persisted selections, which messages belong to an edited branch and
 * which member is the one the session continues from.
 *
 * The default active member is the newest edit — the same rule the backend
 * applies when an edited send arrives, so what the chips show and what the
 * model is answered against never disagree.
 */

export type AlternativeSelection = { rootMessageId: string; activeMessageId: string };

export type AlternativeInfo = {
  /** User message that the branch's edits revised. */
  rootId: string;
  /** True for the member the session continues from. */
  active: boolean;
};

type MessageLike = {
  id: string;
  role: string;
  reference?: { refersToMessageId: string; relation: string } | null;
};

/**
 * Every message that belongs to an edited branch, keyed by message id. Breadth
 * is honest: only branches whose root is in the loaded history are marked — a
 * branch edit whose original is outside the loaded rows is left unlabelled
 * rather than guessed at. A message without alternatives is absent.
 */
export function alternativeIndex(
  messages: ReadonlyArray<MessageLike>,
  selections: ReadonlyArray<AlternativeSelection>,
): Map<string, AlternativeInfo> {
  const groups = new Map<string, { edits: string[]; newest: string }>();
  for (const message of messages) {
    if (message.role !== 'user' || message.reference?.relation !== 'edited-from') continue;
    const root = message.reference.refersToMessageId;
    const group = groups.get(root);
    if (group) {
      group.edits.push(message.id);
      group.newest = message.id;
    } else {
      groups.set(root, { edits: [message.id], newest: message.id });
    }
  }
  const index = new Map<string, AlternativeInfo>();
  for (const [rootId, group] of groups) {
    if (!messages.some((message) => message.id === rootId)) continue;
    const members = [rootId, ...group.edits];
    const explicit = selections.find((s) => s.rootMessageId === rootId)?.activeMessageId;
    const activeId = explicit !== undefined && members.includes(explicit) ? explicit : group.newest;
    // Chained edits put a message in several groups: the later, finer group
    // wins, matching the backend's independent per-group filter.
    for (const id of members) index.set(id, { rootId, active: id === activeId });
  }
  return index;
}
