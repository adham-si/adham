import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import {
  Menu,
  MenuContent,
  MenuGroup,
  MenuItem,
  MenuRoot,
  MenuSeparator,
  MenuTrigger,
} from './menu';

const DIRECTION_LOCKED = /(^|\s)(left-|right-|ml-|mr-|pl-|pr-)/;

function BasicMenu({ onSelect }: { onSelect?: (value: string) => void }) {
  return (
    <Menu label="Actions" onSelect={onSelect}>
      <MenuItem value="open">Open</MenuItem>
      <MenuItem value="rename">Rename</MenuItem>
      <MenuItem value="delete" disabled>
        Delete
      </MenuItem>
      <MenuItem value="share">Share</MenuItem>
    </Menu>
  );
}

describe('Menu', () => {
  it('exposes menu and menuitem roles', () => {
    render(<BasicMenu />);
    expect(screen.getByRole('menu', { name: 'Actions' })).toBeDefined();
    expect(screen.getAllByRole('menuitem')).toHaveLength(4);
  });

  it('is a single tab stop: every item has tabindex -1', () => {
    render(<BasicMenu />);
    for (const item of screen.getAllByRole('menuitem')) {
      expect(item.getAttribute('tabindex')).toBe('-1');
    }
  });

  it('takes focus on the first item when it opens', () => {
    render(<BasicMenu />);
    expect(document.activeElement?.textContent).toBe('Open');
  });

  it('never focuses a disabled item on open', () => {
    render(
      <Menu label="Actions">
        <MenuItem value="delete" disabled>
          Delete
        </MenuItem>
        <MenuItem value="open">Open</MenuItem>
      </Menu>,
    );
    expect(document.activeElement?.textContent).toBe('Open');
  });

  it('ArrowDown walks forward and skips disabled items', async () => {
    const user = userEvent.setup();
    render(<BasicMenu />);
    // Focus starts on Open. Next is Rename, then Share — Delete is skipped.
    await user.keyboard('{ArrowDown}');
    expect(document.activeElement?.textContent).toBe('Rename');
    await user.keyboard('{ArrowDown}');
    expect(document.activeElement?.textContent).toBe('Share');
  });

  it('ArrowUp walks backward and skips disabled items', async () => {
    const user = userEvent.setup();
    render(<BasicMenu />);
    await user.keyboard('{ArrowDown}{ArrowDown}');
    expect(document.activeElement?.textContent).toBe('Share');
    await user.keyboard('{ArrowUp}');
    expect(document.activeElement?.textContent).toBe('Rename');
  });

  it('wraps from the last item back to the first', async () => {
    const user = userEvent.setup();
    render(<BasicMenu />);
    await user.keyboard('{End}{ArrowDown}');
    expect(document.activeElement?.textContent).toBe('Open');
  });

  it('wraps from the first item to the last', async () => {
    const user = userEvent.setup();
    render(<BasicMenu />);
    await user.keyboard('{ArrowUp}');
    expect(document.activeElement?.textContent).toBe('Share');
  });

  it('Home and End jump to the ends', async () => {
    const user = userEvent.setup();
    render(<BasicMenu />);
    await user.keyboard('{End}');
    expect(document.activeElement?.textContent).toBe('Share');
    await user.keyboard('{Home}');
    expect(document.activeElement?.textContent).toBe('Open');
  });

  it('Enter activates the focused item', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<BasicMenu onSelect={onSelect} />);
    await user.keyboard('{Enter}');
    expect(onSelect).toHaveBeenCalledWith('open');
    await user.keyboard('{ArrowDown}{Enter}');
    expect(onSelect).toHaveBeenCalledWith('rename');
  });

  it('Space activates the focused item', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<BasicMenu onSelect={onSelect} />);
    await user.keyboard(' ');
    expect(onSelect).toHaveBeenCalledWith('open');
  });

  it('a disabled item never receives focus', async () => {
    const user = userEvent.setup();
    render(<BasicMenu />);
    await user.keyboard('{End}');
    expect(document.activeElement?.textContent).toBe('Share');
  });

  it('renders a separator with role=separator', () => {
    render(
      <Menu label="Actions">
        <MenuItem value="open">Open</MenuItem>
        <MenuSeparator />
        <MenuItem value="close">Close</MenuItem>
      </Menu>,
    );
    expect(screen.getByRole('separator')).toBeDefined();
  });

  it('renders a labelled group', () => {
    render(
      <Menu label="Actions">
        <MenuGroup label="File">
          <MenuItem value="open">Open</MenuItem>
        </MenuGroup>
      </Menu>,
    );
    expect(screen.getByRole('group', { name: 'File' })).toBeDefined();
  });

  it('active item takes the selection surface', () => {
    render(
      <Menu label="Actions">
        <MenuItem value="open" active>
          Open
        </MenuItem>
      </Menu>,
    );
    expect(screen.getByRole('menuitem').className).toContain('bg-selection');
  });

  // --- trigger lifecycle: open, Escape, focus return
  it('MenuTrigger reports the menu state and opens on click', async () => {
    const user = userEvent.setup();
    render(
      <MenuRoot>
        <MenuTrigger>Actions</MenuTrigger>
        <MenuContent label="Actions">
          <MenuItem value="open">Open</MenuItem>
        </MenuContent>
      </MenuRoot>,
    );
    const trigger = screen.getByRole('button', { name: 'Actions' });
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(trigger.getAttribute('aria-haspopup')).toBe('menu');
    expect(screen.queryByRole('menu')).toBeNull();

    await user.click(trigger);
    expect(screen.getByRole('menu')).toBeDefined();
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
  });

  it('Escape closes the menu and returns focus to the trigger', async () => {
    const user = userEvent.setup();
    render(
      <MenuRoot>
        <MenuTrigger>Actions</MenuTrigger>
        <MenuContent label="Actions">
          <MenuItem value="open">Open</MenuItem>
        </MenuContent>
      </MenuRoot>,
    );
    const trigger = screen.getByRole('button', { name: 'Actions' });
    await user.click(trigger);
    expect(screen.getByRole('menu')).toBeDefined();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('selecting an item closes the menu and reports the value', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <MenuRoot>
        <MenuTrigger>Actions</MenuTrigger>
        <MenuContent label="Actions" onSelect={onSelect}>
          <MenuItem value="open">Open</MenuItem>
        </MenuContent>
      </MenuRoot>,
    );
    await user.click(screen.getByRole('button', { name: 'Actions' }));
    await user.click(screen.getByRole('menuitem', { name: 'Open' }));
    expect(onSelect).toHaveBeenCalledWith('open');
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('uses no magic values and no direction-locked utility', () => {
    const { container } = render(
      <Menu label="Actions">
        <MenuItem value="open" active>
          Open
        </MenuItem>
      </Menu>,
    );
    for (const element of container.querySelectorAll('[role="menuitem"]')) {
      expect(element.className).not.toMatch(DIRECTION_LOCKED);
      expect(element.className).not.toContain('#');
      expect(element.className).not.toContain('[var(');
    }
    expect(screen.getByRole('menu').className).toContain('z-menu');
  });

  it('popup rows breathe: 4px gap like nav lists, separators carry no margins', () => {
    render(
      <Menu label="Actions">
        <MenuGroup label="File">
          <MenuItem value="open">Open</MenuItem>
        </MenuGroup>
        <MenuSeparator />
        <MenuItem value="save">Save</MenuItem>
      </Menu>,
    );
    const { className } = screen.getByRole('menu');
    expect(className).toContain('flex');
    expect(className).toContain('flex-col');
    expect(className).toContain('gap-1');
    expect(screen.getByRole('separator').className).not.toContain('my-1');
    // Group heading keeps top air but no bottom padding: the container gap owns
    // the 4px below it, so heading-to-row never stacks to 8px.
    const heading = screen.getByText('File');
    expect(heading.className).not.toContain('pb-1');
    expect(heading.className).toContain('pt-1');
  });

  it('clicking an item reports its value', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<BasicMenu onSelect={onSelect} />);
    await user.click(screen.getByRole('menuitem', { name: 'Share' }));
    expect(onSelect).toHaveBeenCalledWith('share');
  });

  it('a disabled item ignores clicks', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<BasicMenu onSelect={onSelect} />);
    await user.click(screen.getByRole('menuitem', { name: 'Delete' }));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('refuses to render an item outside a Menu', () => {
    expect(() => render(<MenuItem value="orphan">Orphan</MenuItem>)).toThrow(/MenuContent/);
  });
});
