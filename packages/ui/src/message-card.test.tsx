import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MessageCard } from './message-card';

const DIRECTION_LOCKED = /(^|\s)(left-|right-|ml-|mr-|pl-|pr-)/;

describe('MessageCard', () => {
  it('renders an article', () => {
    const { container } = render(<MessageCard role="user" text="Hello" timestamp="10:04" />);
    expect(container.querySelector('article')).not.toBeNull();
  });

  it('states the role as visible text, not colour alone', () => {
    render(<MessageCard role="assistant" text="Hi" timestamp="10:04" />);
    expect(screen.getByText('Assistant')).toBeDefined();
  });

  it.each([
    ['user', 'You'],
    ['assistant', 'Assistant'],
    ['system', 'System'],
  ] as const)('role %s renders the label %s', (role, label) => {
    render(<MessageCard role={role} text="Body" timestamp="10:04" />);
    expect(screen.getByText(label)).toBeDefined();
  });

  it('labels the article for assistive tech too', () => {
    const { container } = render(<MessageCard role="system" text="Body" timestamp="10:04" />);
    expect(container.querySelector('article')?.getAttribute('aria-label')).toBe('System');
  });

  it('renders the body text', () => {
    render(<MessageCard role="user" text="Deploy the staging build" timestamp="10:04" />);
    expect(screen.getByText('Deploy the staging build')).toBeDefined();
  });

  it('renders the timestamp in a time element', () => {
    const { container } = render(
      <MessageCard role="user" text="Body" timestamp="10:04" dateTime="2026-10-07T10:04:00Z" />,
    );
    const time = container.querySelector('time');
    expect(time?.textContent).toBe('10:04');
    expect(time?.getAttribute('datetime')).toBe('2026-10-07T10:04:00Z');
  });

  it('selected applies the selection surface', () => {
    render(<MessageCard role="user" text="Body" timestamp="10:04" selected />);
    expect(screen.getByRole('article').className).toContain('bg-selection');
  });

  it('not selected omits the selection surface', () => {
    render(<MessageCard role="user" text="Body" timestamp="10:04" />);
    expect(screen.getByRole('article').className).not.toContain('bg-selection');
  });

  it('editable marks the card with a dashed boundary', () => {
    render(<MessageCard role="user" text="Body" timestamp="10:04" editable />);
    expect(screen.getByRole('article').className).toContain('border-dashed');
  });

  it('read-only by default: no dashed boundary', () => {
    render(<MessageCard role="user" text="Body" timestamp="10:04" />);
    expect(screen.getByRole('article').className).not.toContain('border-dashed');
  });

  it('keeps the body read-only when editable is false', () => {
    render(<MessageCard role="user" text="Body" timestamp="10:04" editable={false} />);
    expect(screen.getByRole('article').className).not.toContain('border-dashed');
  });

  it('is focusable so a selected card can be reached by keyboard', () => {
    const { container } = render(
      <MessageCard role="user" text="Body" timestamp="10:04" tabIndex={0} />,
    );
    expect(container.querySelector('article')?.getAttribute('tabindex')).toBe('0');
    expect(screen.getByRole('article').className).toContain('focus-visible:outline-focus');
  });

  it('renders no direction-locked utility', () => {
    const { container } = render(
      <MessageCard role="user" text="Body" timestamp="10:04" selected editable />,
    );
    expect(container.querySelector('article')?.className).not.toMatch(DIRECTION_LOCKED);
  });

  it('uses no magic values', () => {
    const { container } = render(
      <MessageCard role="assistant" text="Body" timestamp="10:04" selected />,
    );
    const className = container.querySelector('article')?.className ?? '';
    expect(className).not.toContain('#');
    expect(className).not.toContain('[var(');
  });

  it('lets a caller className override the base padding', () => {
    render(<MessageCard role="user" text="Body" timestamp="10:04" className="p-8" />);
    const { className } = screen.getByRole('article');
    expect(className).toContain('p-8');
    expect(className).not.toContain('p-4');
  });

  it('forwards a ref to the article element', () => {
    let captured: HTMLElement | null = null;
    render(
      <MessageCard
        role="user"
        text="Body"
        timestamp="10:04"
        ref={(element) => {
          captured = element;
        }}
      />,
    );
    expect(captured).toBeInstanceOf(HTMLElement);
  });
});
