/// Public API of the provisioning feature: deliberate workspace/project
/// creation with frozen request identity, the frozen selection intent, and
/// the shared workspace/project scope event. Leaf module — imports only
/// shared infrastructure — so every consumer forms a DAG without
/// barrel-order workarounds.
export { useProvisioning } from './use-provisioning';
export type { ProvisioningBackend, ProvisionOutcome } from './use-provisioning';
export { announceScopeChanged, SCOPE_CHANGED_EVENT } from './scope-event';
export type { ScopeChangedDetail } from './scope-event';
export { clearSelectIntent, readSelectIntent, writeSelectIntent } from './select-intent';
export type { SelectIntent } from './select-intent';
export {
  clearProjectIntent,
  clearWorkspaceIntent,
  readProjectIntent,
  readWorkspaceIntent,
  writeProjectIntent,
  writeWorkspaceIntent,
} from './provision-intent';
export type { ProvisionIntent } from './provision-intent';
