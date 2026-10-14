/// Public API of the conversation feature. The root route imports from here
/// — never from module internals. Workspace/project provisioning, the scope
/// event, and the selection identity live in the provisioning feature (a
/// leaf module this feature depends on); generic storage and error-envelope
/// helpers live in shared infrastructure. No re-exports of other domains:
/// consumers import them from their owner.
export { useProjectSessions } from './use-project-sessions';
export { ConversationPanel } from './conversation-panel';
export type { ConversationPanelProps } from './conversation-panel';
