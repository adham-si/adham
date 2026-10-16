/// Public API of the workspace-selection feature: authoritative discovery,
/// explicit project selection, and the post-initialization creation dialog.
/// The root route and other features import from here — never internals.
export { useSelection } from './use-selection';
export type { SelectionBackend, SelectOutcome } from './use-selection';
export { WorkspaceSelection } from './workspace-selection';
export { ProvisionDialog } from './provision-dialog';
export type { ProvisionDialogProps, ProvisionDialogTarget } from './provision-dialog';
export { useProvisionFlow } from './use-provision-flow';
