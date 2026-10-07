import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AdhamIcon } from './adham-icon';

const DIRECTION_LOCKED = /(^|\s)(left-|right-|ml-|mr-|pl-|pr-)/;
const Chevron = () => (
  <AdhamIcon>
    <path d="M9 6l6 6-6 6" />
  </AdhamIcon>
);
/** `className` on an SVGElement is an SVGAnimatedString, not a string. */
const classAttr = (element: Element | null): string => element?.getAttribute('class') ?? '';

describe('AdhamIcon', () => {
  it('is decorative and hidden from assistive tech without a label', () => {
    const { container } = render(<Chevron />);
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('aria-hidden')).toBe('true');
    expect(svg?.hasAttribute('role')).toBe(false);
  });

  it('is exposed as an image when given a label', () => {
    render(
      <AdhamIcon label="Next">
        <path d="M9 6l6 6-6 6" />
      </AdhamIcon>,
    );
    const icon = screen.getByRole('img', { name: 'Next' });
    expect(icon.hasAttribute('aria-hidden')).toBe(false);
  });

  it('fixes the viewBox at 24x24', () => {
    const { container } = render(<Chevron />);
    expect(container.querySelector('svg')?.getAttribute('viewBox')).toBe('0 0 24 24');
  });

  it('strokes with currentColor so it follows the text colour', () => {
    const { container } = render(<Chevron />);
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('stroke')).toBe('currentColor');
    expect(svg?.getAttribute('fill')).toBe('none');
  });

  it.each([
    ['sm', 'size-icon-sm'],
    ['md', 'size-icon-md'],
    ['lg', 'size-icon-lg'],
  ] as const)('size %s applies %s', (size, expected) => {
    const { container } = render(
      <AdhamIcon size={size}>
        <path d="M0 0h24" />
      </AdhamIcon>,
    );
    expect(container.querySelector('svg')?.classList.contains(expected)).toBe(true);
  });

  it('defaults to the md size', () => {
    const { container } = render(<Chevron />);
    expect(container.querySelector('svg')?.classList.contains('size-icon-md')).toBe(true);
  });

  it('mirrored flips with the writing direction, not with a fixed axis', () => {
    const { container } = render(
      <AdhamIcon mirrored>
        <path d="M9 6l6 6-6 6" />
      </AdhamIcon>,
    );
    expect(classAttr(container.querySelector('svg'))).toContain('rtl:-scale-x-100');
  });

  it('not mirrored applies no flip', () => {
    const { container } = render(<Chevron />);
    expect(classAttr(container.querySelector('svg'))).not.toContain('scale-x');
  });

  it('renders its path children', () => {
    const { container } = render(<Chevron />);
    expect(container.querySelectorAll('path')).toHaveLength(1);
  });

  it('renders no direction-locked utility', () => {
    const { container } = render(
      <AdhamIcon size="lg" mirrored>
        <path d="M0 0h24" />
      </AdhamIcon>,
    );
    expect(classAttr(container.querySelector('svg'))).not.toMatch(DIRECTION_LOCKED);
  });

  it('uses no magic values', () => {
    const { container } = render(<Chevron />);
    const className = classAttr(container.querySelector('svg'));
    expect(className).not.toContain('#');
    expect(className).not.toContain('[var(');
  });

  it('lets a caller className override the size', () => {
    const { container } = render(
      <AdhamIcon className="size-icon-lg">
        <path d="M0 0h24" />
      </AdhamIcon>,
    );
    expect(container.querySelector('svg')?.classList.contains('size-icon-lg')).toBe(true);
  });

  it('forwards a ref to the svg element', () => {
    let captured: SVGSVGElement | null = null;
    render(
      <AdhamIcon
        ref={(element) => {
          captured = element;
        }}
      >
        <path d="M0 0h24" />
      </AdhamIcon>,
    );
    expect(captured).toBeInstanceOf(SVGSVGElement);
  });
});
