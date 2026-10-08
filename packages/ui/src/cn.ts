import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

/**
 * Adham's tier-1 scales are aliased into `--spacing-*` and `--z-index-*` in
 * tokens.css so `min-h-control-md`, `size-icon-md` and `z-dialog` generate real
 * utilities. tailwind-merge has no idea those exist — without this, a caller's
 * `min-h-control-lg` would silently lose to a component's `min-h-control-md`,
 * which is the exact failure `cn()` is here to prevent.
 */
const NAMED_SCALES = {
  'min-h': ['control-xs', 'control-sm', 'control-md', 'control-lg'],
  'min-w': ['control-xs', 'control-sm', 'control-md', 'control-lg'],
  size: ['icon-sm', 'icon-md', 'icon-lg'],
  z: ['dialog', 'menu', 'popover', 'toast'],
} as const;

const merge = extendTailwindMerge({
  extend: {
    classGroups: {
      'min-h': [{ 'min-h': [...NAMED_SCALES['min-h']] }],
      'min-w': [{ 'min-w': [...NAMED_SCALES['min-w']] }],
      size: [{ size: [...NAMED_SCALES.size] }],
      z: [{ z: [...NAMED_SCALES.z] }],
    },
  },
});

/**
 * Joins class names and resolves conflicting Tailwind utilities so a caller's
 * `className` wins over a component's base classes. Without the merge step a
 * caller's `p-8` would lose to the component's `p-4`, silently.
 */
export function cn(...inputs: ClassValue[]): string {
  return merge(clsx(inputs));
}
