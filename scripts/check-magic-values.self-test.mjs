// Self-test for check-magic-values.mjs. Each case is a line of code paired with
// the rule ids it must trigger. Run: node scripts/check-magic-values.self-test.mjs
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { detect, loadRules, stripComments } from './lib/magic-value-rules.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const rules = loadRules(
  new URL(`file:///${path.join(SCRIPT_DIR, 'check-magic-values.rules.json').replace(/\\/g, '/')}`),
);

const CASES = [
  // --- must trigger -------------------------------------------------------
  ['<span className="bg-[var(--color-brand,#2B2BFF)]" />', ['hex-literal', 'arbitrary-var']],
  ['<p className="text-[var(--color-text-primary,#121214)]" />', ['hex-literal', 'arbitrary-var']],
  [
    '<div className="border-[var(--color-border-subtle,#E2E2E6)]" />',
    ['hex-literal', 'arbitrary-var'],
  ],
  ['<div className="rounded-[var(--radius-md,8px)]" />', ['arbitrary-var-radius']],
  ['<div className="z-50" />', ['bare-z']],
  ['<div className="border-2 border-action" />', ['border-width']],
  ['<div className="border-b-2" />', ['border-width']],
  ['<div className="border-t-[3px]" />', ['border-width']],
  ['<div className="z-dialog" />', []],
  ['<button className="bg-red-600 text-white" />', ['default-palette']],
  ['<button className="bg-danger text-action-foreground" />', []],
  ['const c = { brand: "#2B2BFF" };', ['hex-literal']],
  ['<div className="shadow-[var(--shadow-floating)]" />', ['arbitrary-var']],
  ['<div className="ring-[var(--color-brand,#2B2BFF)]" />', ['hex-literal', 'arbitrary-var']],

  // --- must NOT trigger: comments are prose, not code --------------------
  ['// issue reference: see PR #1234 for context', []],
  ['/* legacy token was #2B2BFF before the tier rewrite */', []],
  ['/** @see https://example.com/#2B2BFF */', []],

  // --- must NOT trigger: token utilities ---------------------------------
  ['<div className="bg-surface text-foreground-muted" />', []],
  ['<div className="min-h-control-md rounded-md" />', []],
  ['<div className="z-menu z-popover z-toast" />', []],
  ['<div className="border-border-subtle bg-selection" />', []],
  ['<div className="border border-border-subtle" />', []],
  ['<div className="border-0 border-border" />', []],
  ['<div className="focus-visible:outline-2 focus-visible:-outline-offset-1" />', []],
  ["const label = 'Send message #1';", []],
];

let failures = 0;
for (const [source, expected] of CASES) {
  const line = stripComments(source);
  const actual = detect(line, rules);
  try {
    assert.deepEqual([...actual].sort(), [...expected].sort());
    const tag = expected.length === 0 ? '(clean)' : expected.join(', ');
    console.log(`  ok   ${tag.padEnd(30)} ${source}`);
  } catch {
    failures++;
    console.error(
      `  FAIL ${source}\n       expected: ${JSON.stringify(expected)}\n       actual:   ${JSON.stringify(actual)}`,
    );
  }
}

console.log(`\n${CASES.length - failures}/${CASES.length} cases passed.`);
process.exit(failures > 0 ? 1 : 0);
