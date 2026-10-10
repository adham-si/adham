import * as React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { ShellLayoutProvider } from '../context';
import { Titlebar } from './titlebar';
import { setPlatformForTesting, setAmbientForTesting } from '@/shared/platform';

function Wrapper({ children }: { children: React.ReactNode }) {
  return <ShellLayoutProvider>{children}</ShellLayoutProvider>;
}

describe('Titlebar Platform-Chrome Adaptation', () => {
  beforeEach(() => {
    setPlatformForTesting(null);
    setAmbientForTesting(null);
  });

  afterEach(() => {
    setPlatformForTesting(null);
    setAmbientForTesting(null);
  });

  describe('macOS Chrome Behavior', () => {
    beforeEach(() => {
      setPlatformForTesting('macos');
    });

    it('suppresses custom Windows caption buttons on macOS', () => {
      render(
        <Wrapper>
          <Titlebar />
        </Wrapper>,
      );

      // Windows caption buttons must be completely absent from the DOM
      expect(screen.queryByRole('button', { name: 'Minimize' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Maximize' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Restore' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Close' })).toBeNull();

      // Separator vertical line must be suppressed
      expect(screen.queryByRole('separator')).toBeNull();
    });

    it('preserves Adham layout controls on macOS', () => {
      render(
        <Wrapper>
          <Titlebar />
        </Wrapper>,
      );

      // All 3 layout toggles must be present and accessible
      const primarySidebarBtn = screen.getByRole('button', { name: /primary sidebar/i });
      const panelBtn = screen.getByRole('button', { name: /panel/i });
      const secondarySidebarBtn = screen.getByRole('button', { name: /secondary sidebar/i });

      expect(primarySidebarBtn).not.toBeNull();
      expect(panelBtn).not.toBeNull();
      expect(secondarySidebarBtn).not.toBeNull();

      // NavRail toggle and Actions menu must be present
      expect(screen.getByRole('button', { name: /navigation rail/i })).not.toBeNull();
      expect(screen.getByRole('button', { name: /actions/i })).not.toBeNull();
    });

    it('applies physical traffic-light clearance on macOS header', () => {
      const { container } = render(
        <Wrapper>
          <Titlebar />
        </Wrapper>,
      );

      const header = container.querySelector('header');
      expect(header).not.toBeNull();
      expect(header?.classList.contains('pl-20')).toBe(true);
    });

    it('preserves physical traffic-light clearance on macOS in RTL direction', () => {
      const { container } = render(
        <div dir="rtl">
          <Wrapper>
            <Titlebar />
          </Wrapper>
        </div>,
      );

      const header = container.querySelector('header');
      expect(header).not.toBeNull();
      // On macOS, native traffic lights are physically on the left regardless of text direction.
      // Physical pl-20 ensures that RTL layout items never encroach upon the 0..80px traffic light zone.
      expect(header?.classList.contains('pl-20')).toBe(true);

      // Layout controls and NavRail remain accessible in RTL
      expect(screen.getByRole('button', { name: /primary sidebar/i })).not.toBeNull();
      expect(screen.getByRole('button', { name: /navigation rail/i })).not.toBeNull();
    });

    it('uses truthful "Close Window" labeling in actions menu instead of "Exit"', () => {
      render(
        <Wrapper>
          <Titlebar />
        </Wrapper>,
      );

      const actionsBtn = screen.getByRole('button', { name: /actions/i });
      fireEvent.click(actionsBtn);

      expect(screen.getByRole('menuitem', { name: 'Close Window' })).not.toBeNull();
      expect(screen.queryByRole('menuitem', { name: 'Exit' })).toBeNull();
    });
  });

  describe('Windows Chrome Component Behavior (DOM)', () => {
    beforeEach(() => {
      setPlatformForTesting('windows');
    });

    it('renders custom caption buttons on Windows', () => {
      render(
        <Wrapper>
          <Titlebar />
        </Wrapper>,
      );

      // Windows caption buttons must be rendered and accessible
      expect(screen.getByRole('button', { name: 'Minimize' })).not.toBeNull();
      expect(screen.getByRole('button', { name: 'Maximize' })).not.toBeNull();
      expect(screen.getByRole('button', { name: 'Close' })).not.toBeNull();

      // Separator vertical line must be present
      expect(screen.getByRole('separator')).not.toBeNull();
    });

    it('preserves Adham layout controls on Windows', () => {
      render(
        <Wrapper>
          <Titlebar />
        </Wrapper>,
      );

      // All 3 layout toggles must be present and accessible
      expect(screen.getByRole('button', { name: /primary sidebar/i })).not.toBeNull();
      expect(screen.getByRole('button', { name: /panel/i })).not.toBeNull();
      expect(screen.getByRole('button', { name: /secondary sidebar/i })).not.toBeNull();

      // NavRail toggle and Actions menu must be present
      expect(screen.getByRole('button', { name: /navigation rail/i })).not.toBeNull();
      expect(screen.getByRole('button', { name: /actions/i })).not.toBeNull();
    });

    it('applies standard start padding on Windows', () => {
      const { container } = render(
        <Wrapper>
          <Titlebar />
        </Wrapper>,
      );

      const topStartSection = container.querySelector('.ps-2');
      expect(topStartSection).not.toBeNull();
      expect(container.querySelector('.ps-20')).toBeNull();
    });
  });

  describe('Unknown Platform Chrome Behavior', () => {
    beforeEach(() => {
      setPlatformForTesting('unknown');
    });

    it('does not default to Windows caption controls on unknown platform', () => {
      render(
        <Wrapper>
          <Titlebar />
        </Wrapper>,
      );

      // Custom caption buttons must NOT be rendered for unknown platform
      expect(screen.queryByRole('button', { name: 'Minimize' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Maximize' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Close' })).toBeNull();
      expect(screen.queryByRole('separator')).toBeNull();

      // Layout controls remain functional
      expect(screen.getByRole('button', { name: /primary sidebar/i })).not.toBeNull();
    });
  });

  describe('Draggable Middle Region Scoping', () => {
    it('restricts drag region attribute to the middle container rather than entire header', () => {
      const { container } = render(
        <Wrapper>
          <Titlebar />
        </Wrapper>,
      );

      const header = container.querySelector('header');
      expect(header).not.toBeNull();
      // Header itself must NOT have data-tauri-drag-region attribute
      expect(header?.hasAttribute('data-tauri-drag-region')).toBe(false);

      // Drag region is scoped to the middle flexible spacer
      const dragRegion = container.querySelector('div[data-tauri-drag-region]');
      expect(dragRegion).not.toBeNull();
      expect(dragRegion?.classList.contains('flex-1')).toBe(true);
    });
  });

  describe('Collision-Safe Toolbar Loading and Error States (Component Tests)', () => {
    it('preserves collision-safe traffic-light clearance during ambient macOS loading state', () => {
      setAmbientForTesting(true);
      setPlatformForTesting(null);

      const { container } = render(
        <Wrapper>
          <Titlebar />
        </Wrapper>,
      );

      const header = container.querySelector('header');
      expect(header).not.toBeNull();
      expect(header?.classList.contains('pl-20')).toBe(true);

      // Custom caption controls remain suppressed
      expect(screen.queryByRole('button', { name: 'Minimize' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Close' })).toBeNull();
    });

    it('suppresses both traffic-light clearance and custom captions during non-macOS loading state', () => {
      setAmbientForTesting(false);
      setPlatformForTesting(null);

      const { container } = render(
        <Wrapper>
          <Titlebar />
        </Wrapper>,
      );

      const header = container.querySelector('header');
      expect(header).not.toBeNull();
      expect(header?.classList.contains('pl-20')).toBe(false);

      // Custom caption controls remain suppressed during loading
      expect(screen.queryByRole('button', { name: 'Minimize' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Close' })).toBeNull();
    });
  });
});
