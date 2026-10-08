import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SidebarItem } from './sidebar-item';

const DIRECTION_LOCKED = /(^|\s)(left-|right-|ml-|mr-|pl-|pr-)/;

describe('SidebarItem', () => {
  it('renders a button by default', () => {
    render(<SidebarItem>Projects</SidebarItem>);
    expect(screen.getByRole('button', { name: 'Projects' })).toBeDefined();
  });

  // --- spec §7: default, hover, pressed, selected, focus-visible, disabled
  it('default: secondary foreground with a hover surface', () => {
    render(<SidebarItem>Projects</SidebarItem>);
    const { className } = screen.getByRole('button');
    expect(className).toContain('text-foreground-secondary');
    expect(className).toContain('hover:bg-surface-hover');
  });

  it('pressed: declares an active surface', () => {
    render(<SidebarItem>Projects</SidebarItem>);
    expect(screen.getByRole('button').className).toContain('active:bg-surface-muted');
  });

  it('focus-visible: outlines with the focus token', () => {
    render(<SidebarItem>Projects</SidebarItem>);
    expect(screen.getByRole('button').className).toContain('outline-focus');
  });

  it('selected: sets aria-current=page and the selection surface', () => {
    render(<SidebarItem selected>Projects</SidebarItem>);
    const item = screen.getByRole('button');
    expect(item.getAttribute('aria-current')).toBe('page');
    expect(item.className).toContain('bg-selection');
  });

  it('not selected: omits aria-current', () => {
    render(<SidebarItem>Projects</SidebarItem>);
    expect(screen.getByRole('button').hasAttribute('aria-current')).toBe(false);
  });

  it('disabled: sets the native attribute and the disabled foreground', () => {
    render(<SidebarItem disabled>Projects</SidebarItem>);
    const item = screen.getByRole('button');
    expect(item).toHaveProperty('disabled', true);
    expect(item.className).toContain('text-foreground-disabled');
  });

  it('href renders an anchor', () => {
    render(<SidebarItem href="/projects">Projects</SidebarItem>);
    const link = screen.getByRole('link', { name: 'Projects' });
    expect(link.getAttribute('href')).toBe('/projects');
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('a selected link keeps aria-current', () => {
    render(
      <SidebarItem href="/projects" selected>
        Projects
      </SidebarItem>,
    );
    expect(screen.getByRole('link').getAttribute('aria-current')).toBe('page');
  });

  it('a disabled link drops href and stops being a link', () => {
    render(
      <SidebarItem href="/projects" disabled>
        Projects
      </SidebarItem>,
    );
    // No href means no link role: the row is no longer navigable, and pretending
    // otherwise with aria-disabled on an <a> would be invalid ARIA.
    expect(screen.queryByRole('link')).toBeNull();
    const anchor = document.querySelector('a');
    expect(anchor?.hasAttribute('href')).toBe(false);
    expect(anchor?.className).toContain('text-foreground-disabled');
  });

  it('uses logical inset so it mirrors correctly in RTL', () => {
    render(<SidebarItem>Projects</SidebarItem>);
    const { className } = screen.getByRole('button');
    expect(className).toContain('ps-3');
    expect(className).toContain('pe-3');
  });

  it('renders no direction-locked utility', () => {
    const { container } = render(
      <SidebarItem selected href="/x">
        Projects
      </SidebarItem>,
    );
    expect(container.querySelector('a')?.className).not.toMatch(DIRECTION_LOCKED);
  });

  it('uses no magic values', () => {
    const { container } = render(<SidebarItem selected>Projects</SidebarItem>);
    const className = container.querySelector('button')?.className ?? '';
    expect(className).not.toContain('#');
    expect(className).not.toContain('[var(');
  });

  it('lets a caller className override the base padding', () => {
    render(<SidebarItem className="pe-8">Projects</SidebarItem>);
    const { className } = screen.getByRole('button');
    expect(className).toContain('pe-8');
    expect(className).not.toContain('pe-3');
  });

  it('forwards a ref to the button element', () => {
    let captured: HTMLButtonElement | null = null;
    render(
      <SidebarItem
        ref={(element) => {
          captured = element as HTMLButtonElement | null;
        }}
      >
        Projects
      </SidebarItem>,
    );
    expect(captured).toBeInstanceOf(HTMLButtonElement);
  });
});
