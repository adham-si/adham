/// Public API of the conversation feature. Cross-feature consumers (workspace
/// selection, onboarding, the root route) import from here — never from module
/// internals. Protocol and provisioning leaves are re-exported first so any
/// barrel-level import cycle resolves with these bindings already initialized.
export {
  announceScopeChanged,
  clearSelectIntent,
  isDefinitePreEffectRejection,
  readSelectIntent,
  rejectionMessage,
  SCOPE_CHANGED_EVENT,
  writeSelectIntent,
} from './conversation-identity';
export type { ScopeChangedDetail } from './conversation-identity';
export { useProvisioning } from './use-provisioning';
export type { ProvisioningBackend, ProvisionOutcome } from './use-provisioning';
export { useProjectSessions } from './use-project-sessions';
export { ConversationPanel } from './conversation-panel';
export type { ConversationPanelProps } from './conversation-panel';
