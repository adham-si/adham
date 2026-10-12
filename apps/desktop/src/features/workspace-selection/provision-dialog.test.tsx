import * as React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ProvisionDialog, type ProvisionDialogTarget } from './provision-dialog';

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

describe('ProvisionDialog', () => {
  it('renders nothing when closed or target is null', () => {
    const { container } = render(
      <ProvisionDialog
        open={false}
        target={{ type: 'workspace' }}
        onClose={vi.fn()}
        onSuccess={vi.fn()}
      />,
    );
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(container.firstChild).toBeNull();
  });

  it('renders workspace creation dialog with appropriate fields', () => {
    render(
      <ProvisionDialog
        open={true}
        target={{ type: 'workspace' }}
        onClose={vi.fn()}
        onSuccess={vi.fn()}
      />,
    );
    expect(screen.getByRole('dialog')).toBeDefined();
    expect(screen.getByRole('heading', { name: /create your workspace/i })).toBeDefined();
    expect(screen.getByLabelText(/workspace name/i)).toBeDefined();
    expect(screen.getByRole('button', { name: /create workspace/i })).toBeDefined();
    expect(screen.getByRole('button', { name: /cancel/i })).toBeDefined();
  });

  it('renders project creation dialog and clearly displays target workspace name and ID', () => {
    const target: ProvisionDialogTarget = {
      type: 'project',
      workspaceId: 'ws-target-123',
      workspaceName: 'Acme Corp',
    };
    render(<ProvisionDialog open={true} target={target} onClose={vi.fn()} onSuccess={vi.fn()} />);
    expect(screen.getByRole('dialog')).toBeDefined();
    expect(screen.getByRole('heading', { name: /create your project/i })).toBeDefined();
    expect(screen.getByText('Target Workspace')).toBeDefined();
    expect(screen.getByText('Acme Corp')).toBeDefined();
    expect(screen.getByText('ws-target-123')).toBeDefined();
    expect(screen.getByLabelText(/project name/i)).toBeDefined();
    expect(screen.getByRole('button', { name: /create project/i })).toBeDefined();
  });

  it('validates empty name locally without dispatching backend creation', async () => {
    const backend = {
      createWorkspace: vi.fn(),
      createProject: vi.fn(),
    };
    render(
      <ProvisionDialog
        open={true}
        target={{ type: 'workspace' }}
        onClose={vi.fn()}
        onSuccess={vi.fn()}
        backend={backend}
      />,
    );

    const input = screen.getByLabelText(/workspace name/i);
    // Button is disabled when input is empty
    const submitBtn = screen.getByRole('button', { name: /create workspace/i });
    expect(submitBtn.hasAttribute('disabled')).toBe(true);

    // Type spaces and press Enter
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });
    expect(backend.createWorkspace).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toBeDefined();
  });

  it('invokes onClose when cancel button is clicked without creating anything', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const backend = {
      createWorkspace: vi.fn(),
      createProject: vi.fn(),
    };
    render(
      <ProvisionDialog
        open={true}
        target={{ type: 'workspace' }}
        onClose={onClose}
        onSuccess={vi.fn()}
        backend={backend}
      />,
    );

    await user.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(backend.createWorkspace).not.toHaveBeenCalled();
  });

  it('successfully creates workspace and reports to onSuccess', async () => {
    const user = userEvent.setup();
    const onSuccess = vi.fn();
    const backend = {
      createWorkspace: vi.fn(async ({ name }: { name: string }) => ({
        workspaceId: 'ws-new-456',
        name,
        kind: 'personal',
        preferredLanguage: 'en',
        createdAt: '2026-10-12T00:00:00Z',
      })),
      createProject: vi.fn(),
    };

    render(
      <ProvisionDialog
        open={true}
        target={{ type: 'workspace' }}
        onClose={vi.fn()}
        onSuccess={onSuccess}
        backend={backend}
      />,
    );

    const input = screen.getByLabelText(/workspace name/i);
    fireEvent.change(input, { target: { value: 'TEST-WS-A' } });
    await user.click(screen.getByRole('button', { name: /create workspace/i }));

    await waitFor(() => {
      expect(backend.createWorkspace).toHaveBeenCalledWith(
        { name: 'TEST-WS-A', kind: 'personal', preferredLanguage: 'en' },
        expect.objectContaining({ requestId: expect.any(String) }),
      );
    });

    expect(onSuccess).toHaveBeenCalledWith({ type: 'workspace' }, 'ws-new-456', 'TEST-WS-A');
  });

  it('successfully creates project bound to target workspace ID', async () => {
    const user = userEvent.setup();
    const onSuccess = vi.fn();
    const backend = {
      createWorkspace: vi.fn(),
      createProject: vi.fn(async (wsId: string, payload: { name: string }) => ({
        projectId: 'proj-new-789',
        workspaceId: wsId,
        name: payload.name,
        storageKind: 'isolated',
        createdAt: '2026-10-12T00:00:00Z',
      })),
    };

    const target: ProvisionDialogTarget = {
      type: 'project',
      workspaceId: 'ws-target-123',
      workspaceName: 'TEST-WS-A',
    };

    render(
      <ProvisionDialog
        open={true}
        target={target}
        onClose={vi.fn()}
        onSuccess={onSuccess}
        backend={backend}
      />,
    );

    const input = screen.getByLabelText(/project name/i);
    fireEvent.change(input, { target: { value: 'Project A1' } });
    await user.click(screen.getByRole('button', { name: /create project/i }));

    await waitFor(() => {
      expect(backend.createProject).toHaveBeenCalledWith(
        'ws-target-123',
        { name: 'Project A1', storageKind: 'isolated' },
        expect.objectContaining({ requestId: expect.any(String) }),
      );
    });

    expect(onSuccess).toHaveBeenCalledWith(target, 'proj-new-789', 'Project A1');
  });

  it('displays backend error when creation fails', async () => {
    const user = userEvent.setup();
    const backend = {
      createWorkspace: vi.fn(),
      createProject: vi.fn(async () => {
        throw new Error('VALIDATION_FAILED: project name already exists');
      }),
    };

    const target: ProvisionDialogTarget = {
      type: 'project',
      workspaceId: 'ws-target-123',
      workspaceName: 'TEST-WS-A',
    };

    render(
      <ProvisionDialog
        open={true}
        target={target}
        onClose={vi.fn()}
        onSuccess={vi.fn()}
        backend={backend}
      />,
    );

    const input = screen.getByLabelText(/project name/i);
    await user.type(input, 'Duplicate Project');
    await user.click(screen.getByRole('button', { name: /create project/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeDefined();
    });
  });

  it('keeps workspace input focused throughout continuous typing (TEST-WS-A)', async () => {
    const user = userEvent.setup();
    const backend = {
      createWorkspace: vi.fn(),
      createProject: vi.fn(),
    };

    render(
      <ProvisionDialog
        open={true}
        target={{ type: 'workspace' }}
        onClose={vi.fn()}
        onSuccess={vi.fn()}
        backend={backend}
      />,
    );

    const input = screen.getByLabelText(/workspace name/i);
    expect(document.activeElement).toBe(input);

    await user.type(input, 'TEST-WS-A');
    expect((input as HTMLInputElement).value).toBe('TEST-WS-A');
    expect(document.activeElement).toBe(input);
    expect(backend.createWorkspace).not.toHaveBeenCalled();
  });

  it('keeps project input focused throughout continuous typing (Project Alpha 1)', async () => {
    const user = userEvent.setup();
    const backend = {
      createWorkspace: vi.fn(),
      createProject: vi.fn(),
    };

    render(
      <ProvisionDialog
        open={true}
        target={{
          type: 'project',
          workspaceId: 'ws-123',
          workspaceName: 'Acme Corp',
        }}
        onClose={vi.fn()}
        onSuccess={vi.fn()}
        backend={backend}
      />,
    );

    const input = screen.getByLabelText(/project name/i);
    expect(document.activeElement).toBe(input);

    await user.type(input, 'Project Alpha 1');
    expect((input as HTMLInputElement).value).toBe('Project Alpha 1');
    expect(document.activeElement).toBe(input);
    expect(backend.createProject).not.toHaveBeenCalled();
  });

  it('supports cursor editing, backspace, and pasting without losing focus', async () => {
    const user = userEvent.setup();
    const backend = {
      createWorkspace: vi.fn(),
      createProject: vi.fn(),
    };

    render(
      <ProvisionDialog
        open={true}
        target={{ type: 'workspace' }}
        onClose={vi.fn()}
        onSuccess={vi.fn()}
        backend={backend}
      />,
    );

    const input = screen.getByLabelText(/workspace name/i) as HTMLInputElement;
    expect(document.activeElement).toBe(input);

    // Type initial string
    await user.type(input, 'TEST-WRONG');
    expect(input.value).toBe('TEST-WRONG');
    expect(document.activeElement).toBe(input);

    // Backspace 5 characters ('WRONG')
    await user.keyboard('{Backspace>5/}');
    expect(input.value).toBe('TEST-');
    expect(document.activeElement).toBe(input);

    // Paste replacement text
    await user.paste('WS-A');
    expect(input.value).toBe('TEST-WS-A');
    expect(document.activeElement).toBe(input);

    // Move cursor left 4 positions and insert prefix
    await user.keyboard('{ArrowLeft>4}COOL-{ArrowRight>4}');
    expect(input.value).toBe('TEST-COOL-WS-A');
    expect(document.activeElement).toBe(input);

    // Verify typing alone dispatched zero creation commands
    expect(backend.createWorkspace).not.toHaveBeenCalled();
  });

  it('handles workspace -> project dialog transition and gives project field initial focus', async () => {
    const user = userEvent.setup();
    const backend = {
      createWorkspace: vi.fn(async ({ name }: { name: string }) => ({
        workspaceId: 'ws-created-999',
        name,
        kind: 'personal',
        preferredLanguage: 'en',
        createdAt: '2026-10-12T00:00:00Z',
      })),
      createProject: vi.fn(async (wsId: string, payload: { name: string }) => ({
        projectId: 'proj-created-888',
        workspaceId: wsId,
        name: payload.name,
        storageKind: 'isolated',
        createdAt: '2026-10-12T00:00:00Z',
      })),
    };

    function ChainedProvisioning() {
      const [target, setTarget] = React.useState<ProvisionDialogTarget | null>({
        type: 'workspace',
      });
      return (
        <ProvisionDialog
          open={target !== null}
          target={target}
          onClose={() => setTarget(null)}
          onSuccess={(tgt, id, name) => {
            if (tgt.type === 'workspace') {
              setTarget({
                type: 'project',
                workspaceId: id,
                workspaceName: name ?? 'New Workspace',
              });
            } else {
              setTarget(null);
            }
          }}
          backend={backend}
        />
      );
    }

    render(<ChainedProvisioning />);

    // 1. Workspace step: input receives initial focus and types continuously
    const wsInput = screen.getByLabelText(/workspace name/i);
    expect(document.activeElement).toBe(wsInput);
    await user.type(wsInput, 'TEST-WS-A');
    expect((wsInput as HTMLInputElement).value).toBe('TEST-WS-A');
    expect(document.activeElement).toBe(wsInput);

    // Submit workspace creation
    await user.click(screen.getByRole('button', { name: /create workspace/i }));

    // 2. Transition to project step
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /create your project/i })).toBeDefined();
    });
    expect(screen.getByText('TEST-WS-A')).toBeDefined();
    expect(screen.getByText('ws-created-999')).toBeDefined();

    // Project field has initial focus immediately after transition
    const projInput = screen.getByLabelText(/project name/i);
    expect(document.activeElement).toBe(projInput);

    // Continuous typing in project field works without losing focus
    await user.type(projInput, 'A1');
    expect((projInput as HTMLInputElement).value).toBe('A1');
    expect(document.activeElement).toBe(projInput);

    // Submit project creation
    await user.click(screen.getByRole('button', { name: /create project/i }));

    await waitFor(() => {
      expect(backend.createProject).toHaveBeenCalledWith(
        'ws-created-999',
        { name: 'A1', storageKind: 'isolated' },
        expect.objectContaining({ requestId: expect.any(String) }),
      );
    });
  });
});
