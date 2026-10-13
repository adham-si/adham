import * as React from 'react';
import { useTranslation } from 'react-i18next';

export function GovernancePage() {
  const { t } = useTranslation();
  const [autonomy, setAutonomy] = React.useState('supervised');
  const [confirmEdits, setConfirmEdits] = React.useState(true);
  const [confirmTerminal, setConfirmTerminal] = React.useState(true);
  const [confirmGitPush, setConfirmGitPush] = React.useState(true);
  const [fsBoundary, setFsBoundary] = React.useState('workspace');
  const [blockUnsigned, setBlockUnsigned] = React.useState(true);
  const [dataLossProtection, setDataLossProtection] = React.useState(true);

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div>
        <h2 className="text-xl font-bold tracking-tight text-foreground">
          {t('settings.governance.title', { defaultValue: 'Security & Governance' })}
        </h2>
        <p className="text-xs text-foreground-secondary mt-1">
          {t('settings.governance.desc', {
            defaultValue:
              'Define agent autonomy thresholds, sandbox boundaries, and action approval policies.',
          })}
        </p>
      </div>

      {/* Autonomy & Approvals Section */}
      <section aria-labelledby="autonomy-heading" className="space-y-4">
        <div className="border-b border-border-subtle pb-2.5">
          <h3 id="autonomy-heading" className="text-sm font-semibold text-foreground">
            {t('settings.governance.autonomyTitle', 'Autonomy & approvals')}
          </h3>
        </div>
        <div className="space-y-4">
          {/* Autonomy Level */}
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium text-foreground">
                {t('settings.governance.autonomyLabel', 'Agent autonomy level')}
              </div>
              <div className="text-xs text-foreground-secondary mt-0.5">
                {t(
                  'settings.governance.autonomyHint',
                  'Controls whether actions are carried out automatically or require interactive confirmation',
                )}
              </div>
            </div>
            <select
              value={autonomy}
              onChange={(e) => setAutonomy(e.target.value)}
              className="min-h-control-sm rounded-md border border-border-subtle bg-surface px-3 py-1 text-xs text-foreground cursor-pointer hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-focus"
            >
              <option value="supervised">
                {t('settings.governance.supervised', 'Supervised (Default)')}
              </option>
              <option value="strict">
                {t('settings.governance.strictConfirm', 'Strict Confirmation (All actions)')}
              </option>
              <option value="autonomous">
                {t('settings.governance.autonomous', 'Autonomous (Verified playbooks)')}
              </option>
            </select>
          </div>

          {/* Confirm File Edits */}
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium text-foreground">
                {t('settings.governance.confirmEditsLabel', 'Confirm file modifications')}
              </div>
              <div className="text-xs text-foreground-secondary mt-0.5">
                {t(
                  'settings.governance.confirmEditsHint',
                  'Prompt for review before writing or overwriting repository source files',
                )}
              </div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={confirmEdits}
              aria-label={t('settings.governance.confirmEditsLabel', 'Confirm file modifications')}
              onClick={() => setConfirmEdits(!confirmEdits)}
              className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full px-0.5 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus ${
                confirmEdits ? 'bg-action' : 'bg-surface-muted'
              }`}
            >
              <span
                className={`pointer-events-none inline-block size-4 transform rounded-full bg-surface shadow-sm transition-transform ${
                  confirmEdits ? 'translate-x-4' : 'translate-x-0'
                }`}
              />
            </button>
          </div>

          {/* Confirm Terminal Commands */}
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium text-foreground">
                {t('settings.governance.confirmTerminalLabel', 'Confirm terminal commands')}
              </div>
              <div className="text-xs text-foreground-secondary mt-0.5">
                {t(
                  'settings.governance.confirmTerminalHint',
                  'Prompt before executing non-git shell commands in the workspace environment',
                )}
              </div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={confirmTerminal}
              aria-label={t(
                'settings.governance.confirmTerminalLabel',
                'Confirm terminal commands',
              )}
              onClick={() => setConfirmTerminal(!confirmTerminal)}
              className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full px-0.5 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus ${
                confirmTerminal ? 'bg-action' : 'bg-surface-muted'
              }`}
            >
              <span
                className={`pointer-events-none inline-block size-4 transform rounded-full bg-surface shadow-sm transition-transform ${
                  confirmTerminal ? 'translate-x-4' : 'translate-x-0'
                }`}
              />
            </button>
          </div>

          {/* Confirm Git Push */}
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium text-foreground">
                {t('settings.governance.confirmPushLabel', 'Confirm git push & remote publish')}
              </div>
              <div className="text-xs text-foreground-secondary mt-0.5">
                {t(
                  'settings.governance.confirmPushHint',
                  'Strict human gate before pushing local commits or branch references to remote',
                )}
              </div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={confirmGitPush}
              aria-label={t(
                'settings.governance.confirmPushLabel',
                'Confirm git push & remote publish',
              )}
              onClick={() => setConfirmGitPush(!confirmGitPush)}
              className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full px-0.5 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus ${
                confirmGitPush ? 'bg-action' : 'bg-surface-muted'
              }`}
            >
              <span
                className={`pointer-events-none inline-block size-4 transform rounded-full bg-surface shadow-sm transition-transform ${
                  confirmGitPush ? 'translate-x-4' : 'translate-x-0'
                }`}
              />
            </button>
          </div>
        </div>
      </section>

      {/* Sandbox & Boundaries Section */}
      <section aria-labelledby="sandbox-heading" className="space-y-4">
        <div className="border-b border-border-subtle pb-2.5">
          <h3 id="sandbox-heading" className="text-sm font-semibold text-foreground">
            {t('settings.governance.sandboxTitle', 'Sandbox boundaries')}
          </h3>
        </div>
        <div className="space-y-4">
          {/* Filesystem Boundary */}
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium text-foreground">
                {t('settings.governance.fsScopeLabel', 'Filesystem sandbox scope')}
              </div>
              <div className="text-xs text-foreground-secondary mt-0.5">
                {t(
                  'settings.governance.fsScopeHint',
                  'Constrain agent read and write access strictly to specified local paths',
                )}
              </div>
            </div>
            <select
              value={fsBoundary}
              onChange={(e) => setFsBoundary(e.target.value)}
              className="min-h-control-sm rounded-md border border-border-subtle bg-surface px-3 py-1 text-xs text-foreground cursor-pointer hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-focus"
            >
              <option value="workspace">
                {t('settings.governance.fsWorkspaceOnly', 'Active Workspace Only')}
              </option>
              <option value="readonly-outside">
                {t('settings.governance.fsReadonlyOutside', 'Read-Only Outside Workspace')}
              </option>
              <option value="isolated">
                {t('settings.governance.fsScratchOnly', 'Strict In-Memory Scratch Only')}
              </option>
            </select>
          </div>

          {/* Block Unsigned Plugins */}
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium text-foreground">
                {t('settings.governance.blockUnsignedLabel', 'Block unsigned plugins')}
              </div>
              <div className="text-xs text-foreground-secondary mt-0.5">
                {t(
                  'settings.governance.blockUnsignedHint',
                  'Reject plugins lacking valid cryptographic signatures from verified publishers',
                )}
              </div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={blockUnsigned}
              aria-label={t('settings.governance.blockUnsignedLabel', 'Block unsigned plugins')}
              onClick={() => setBlockUnsigned(!blockUnsigned)}
              className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full px-0.5 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus ${
                blockUnsigned ? 'bg-action' : 'bg-surface-muted'
              }`}
            >
              <span
                className={`pointer-events-none inline-block size-4 transform rounded-full bg-surface shadow-sm transition-transform ${
                  blockUnsigned ? 'translate-x-4' : 'translate-x-0'
                }`}
              />
            </button>
          </div>

          {/* Data Loss Prevention */}
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium text-foreground">
                {t('settings.governance.dataLossLabel', 'Accidental data loss prevention')}
              </div>
              <div className="text-xs text-foreground-secondary mt-0.5">
                {t(
                  'settings.governance.dataLossHint',
                  'Enforce mandatory verification before destructive SQL, cloud bucket deletions, or purge operations',
                )}
              </div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={dataLossProtection}
              aria-label={t('settings.governance.dataLossLabel', 'Accidental data loss prevention')}
              onClick={() => setDataLossProtection(!dataLossProtection)}
              className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full px-0.5 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus ${
                dataLossProtection ? 'bg-action' : 'bg-surface-muted'
              }`}
            >
              <span
                className={`pointer-events-none inline-block size-4 transform rounded-full bg-surface shadow-sm transition-transform ${
                  dataLossProtection ? 'translate-x-4' : 'translate-x-0'
                }`}
              />
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
