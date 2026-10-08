import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Select, type SelectOption } from './select';

const DIRECTION_LOCKED = /(^|\s)(left-|right-|ml-|mr-|pl-|pr-)/;

const OPTIONS: SelectOption[] = [
  { value: 'personal', label: 'Personal' },
  { value: 'team', label: 'Team' },
  { value: 'archived', label: 'Archived', disabled: true },
];

function renderSelect(props?: Partial<React.ComponentProps<typeof Select>>) {
  return render(
    <Select
      id="workspace"
      options={OPTIONS}
      placeholder="Select a workspace"
      indicator={<span data-testid="indicator-closed">v</span>}
      indicatorOpen={<span data-testid="indicator-open">^</span>}
      {...props}
    />,
  );
}

describe('Select', () => {
  it('renders closed with the placeholder and the closed indicator', () => {
    renderSelect();
    const trigger = screen.getByRole('button', { name: 'Select a workspace' });
    expect(trigger.getAttribute('aria-haspopup')).toBe('listbox');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(screen.getByTestId('indicator-closed')).toBeDefined();
    expect(screen.queryByTestId('indicator-open')).toBeNull();
  });

  it('click opens the listbox and swaps to the open indicator', async () => {
    const user = userEvent.setup();
    renderSelect();
    await user.click(screen.getByRole('button', { name: 'Select a workspace' }));
    expect(screen.getByRole('listbox')).toBeDefined();
    expect(screen.getByTestId('indicator-open')).toBeDefined();
    expect(screen.queryByTestId('indicator-closed')).toBeNull();
  });

  it('selects an option, reports it, closes, and returns focus to the trigger', async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    renderSelect({ onValueChange });
    await user.click(screen.getByRole('button', { name: 'Select a workspace' }));
    await user.click(screen.getByRole('option', { name: 'Team' }));
    expect(onValueChange).toHaveBeenCalledWith('team');
    expect(screen.queryByRole('listbox')).toBeNull();
    const trigger = screen.getByRole('button', { name: 'Team' });
    expect(document.activeElement).toBe(trigger);
  });

  it('Escape closes without selecting and returns focus to the trigger', async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    renderSelect({ onValueChange, defaultValue: 'personal' });
    await user.click(screen.getByRole('button', { name: 'Personal' }));
    await user.keyboard('{Escape}');
    expect(onValueChange).not.toHaveBeenCalled();
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Personal' }));
  });

  it('ArrowDown on a closed trigger opens and focuses the selected option', async () => {
    const user = userEvent.setup();
    renderSelect({ defaultValue: 'team' });
    const trigger = screen.getByRole('button', { name: 'Team' });
    trigger.focus();
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('listbox')).toBeDefined();
    expect(document.activeElement).toBe(screen.getByRole('option', { name: 'Team' }));
  });

  it('arrow keys move between enabled options and skip disabled ones', async () => {
    const user = userEvent.setup();
    renderSelect({ defaultValue: 'personal' });
    const trigger = screen.getByRole('button', { name: 'Personal' });
    trigger.focus();
    await user.keyboard('{ArrowDown}');
    await user.keyboard('{ArrowDown}');
    // Team -> wraps past disabled Archived back to Personal.
    await user.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(screen.getByRole('option', { name: 'Personal' }));
  });

  it('Enter on a focused option selects it', async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    renderSelect({ onValueChange });
    await user.click(screen.getByRole('button', { name: 'Select a workspace' }));
    await user.keyboard('{Enter}');
    expect(onValueChange).toHaveBeenCalledWith('personal');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('a disabled option cannot be selected by pointer', async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    renderSelect({ onValueChange });
    await user.click(screen.getByRole('button', { name: 'Select a workspace' }));
    await user.click(screen.getByRole('option', { name: 'Archived' }));
    expect(onValueChange).not.toHaveBeenCalled();
    expect(screen.getByRole('listbox')).toBeDefined();
  });

  it('outside pointer closes the listbox without stealing focus', async () => {
    const user = userEvent.setup();
    renderSelect();
    await user.click(screen.getByRole('button', { name: 'Select a workspace' }));
    expect(screen.getByRole('listbox')).toBeDefined();
    await user.click(document.body);
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('Tab closes the listbox and lets focus move on', async () => {
    const user = userEvent.setup();
    render(
      <>
        <Select id="workspace" options={OPTIONS} placeholder="Select a workspace" />
        <button type="button">After</button>
      </>,
    );
    await user.click(screen.getByRole('button', { name: 'Select a workspace' }));
    await user.tab();
    await vi.waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'After' }));
  });

  it('controlled value drives the trigger label', () => {
    const { rerender } = renderSelect({ value: 'team' });
    expect(screen.getByRole('button', { name: 'Team' })).toBeDefined();
    rerender(
      <Select id="workspace" options={OPTIONS} placeholder="Select a workspace" value="personal" />,
    );
    expect(screen.getByRole('button', { name: 'Personal' })).toBeDefined();
  });

  it('disabled never opens', async () => {
    const user = userEvent.setup();
    renderSelect({ disabled: true });
    const trigger = screen.getByRole('button', { name: 'Select a workspace' });
    expect(trigger).toHaveProperty('disabled', true);
    await user.click(trigger);
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('invalid: sets aria-invalid and wires the error alert', () => {
    renderSelect({ invalid: true, errorMessage: 'Required' });
    const trigger = screen.getByRole('button', { name: 'Select a workspace' });
    expect(trigger.getAttribute('aria-invalid')).toBe('true');
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toBe('Required');
    expect(trigger.getAttribute('aria-describedby')).toBe(alert.id);
  });

  it('associates a label via htmlFor and id', () => {
    render(
      <>
        <label htmlFor="workspace">Workspace</label>
        <Select id="workspace" options={OPTIONS} placeholder="Select a workspace" />
      </>,
    );
    const trigger = screen.getByLabelText('Workspace');
    expect(trigger.id).toBe('workspace');
    expect(trigger.getAttribute('aria-haspopup')).toBe('listbox');
  });

  it.each([
    ['sm', 'min-h-control-sm'],
    ['md', 'min-h-control-md'],
    ['lg', 'min-h-control-lg'],
  ] as const)('size %s applies %s', (size, expected) => {
    renderSelect({ size });
    expect(screen.getByRole('button').className).toContain(expected);
  });

  it('boundary: 1px quiet rest, no hover border, instant state changes', () => {
    renderSelect();
    const { className } = screen.getByRole('button');
    expect(className).toContain('border-border-subtle');
    expect(className).not.toContain('hover:border');
    expect(className).not.toContain('transition-');
    expect(className).toMatch(/(^|\s)border(\s|$)/);
    expect(className).not.toMatch(/(^|\s)border-[0-9]/);
    expect(className).toContain('focus-visible:outline-focus');
  });

  it('popup: quiet 1px subtle border with a real floating shadow', async () => {
    const user = userEvent.setup();
    renderSelect();
    await user.click(screen.getByRole('button', { name: 'Select a workspace' }));
    const { className } = screen.getByRole('listbox');
    expect(className).toContain('border-border-subtle');
    expect(className).toContain('shadow-floating');
    expect(className).not.toContain('shadow-shadow-floating');
  });

  it('popup rows breathe: 4px gap like nav lists, options never compress', async () => {
    const user = userEvent.setup();
    renderSelect();
    await user.click(screen.getByRole('button', { name: 'Select a workspace' }));
    const { className } = screen.getByRole('listbox');
    expect(className).toContain('flex');
    expect(className).toContain('flex-col');
    expect(className).toContain('gap-1');
    expect(screen.getByRole('option', { name: 'Personal' }).className).toContain('shrink-0');
  });

  it.each([
    ['sm', 'text-xs'],
    ['md', 'text-sm'],
    ['lg', 'text-base'],
  ] as const)('size %s scales option text to %s', async (size, expected) => {
    const user = userEvent.setup();
    renderSelect({ size });
    await user.click(screen.getByRole('button', { name: 'Select a workspace' }));
    for (const option of screen.getAllByRole('option')) {
      expect(option.className).toContain(expected);
    }
  });

  it('options signal hover through background colour, never the border', async () => {
    const user = userEvent.setup();
    renderSelect();
    await user.click(screen.getByRole('button', { name: 'Select a workspace' }));
    const { className } = screen.getByRole('option', { name: 'Personal' });
    expect(className).toContain('hover:bg-surface-hover');
    expect(className).not.toContain('hover:border');
  });

  it('renders no direction-locked utility', () => {
    const { container } = renderSelect({ size: 'lg', invalid: true });
    for (const element of container.querySelectorAll('button,div')) {
      expect(element.className).not.toMatch(DIRECTION_LOCKED);
    }
  });

  it('uses no magic values', () => {
    const { container } = renderSelect({ invalid: true, errorMessage: 'x' });
    const className = Array.from(container.querySelectorAll('button,div'))
      .map((element) => element.className)
      .join(' ');
    expect(className).not.toContain('#');
    expect(className).not.toContain('[var(');
  });

  it('forwards a ref to the trigger element', () => {
    let captured: HTMLButtonElement | null = null;
    renderSelect({
      ref: (element) => {
        captured = element;
      },
    });
    expect(captured).toBeInstanceOf(HTMLButtonElement);
  });
});
