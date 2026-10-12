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
    fireEvent.change(input, { target: { value: 'Duplicate Project' } });
    await user.click(screen.getByRole('button', { name: /create project/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeDefined();
    });
  });
});
