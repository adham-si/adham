// Self-test for the deny-exception validator. Dates are injected, so the
// deadline transitions are deterministic.
// Run: node scripts/check-deny-exceptions.self-test.mjs
import assert from 'node:assert/strict';
import {
  isValidDeadline,
  parseAdvisoryIgnoreIds,
  parseLockPackages,
  validateExceptions,
} from './lib/deny-exceptions.mjs';

const LOCK = `
[[package]]
name = "proc-macro-error"
version = "1.0.4"
`;
const DENY = `
[advisories]
ignore = [
    { id = "RUSTSEC-2024-0370", reason = "approved exception" },
]
`;
const RECORD = {
  id: 'RUSTSEC-2024-0370',
  crate: 'proc-macro-error',
  version: '1.0.4',
  owner: 'ilyass (repository maintainer)',
  deadline: '2027-01-06',
  rationale: 'Unmaintained build-time proc-macro; no patched version exists.',
  tracking: ['https://rustsec.org/advisories/RUSTSEC-2024-0370'],
};

function run({ records = [RECORD], deny = DENY, lock = LOCK, today = '2026-10-08' } = {}) {
  return validateExceptions({
    records,
    ignoreIds: parseAdvisoryIgnoreIds(deny),
    lockPackages: parseLockPackages(lock),
    today,
  });
}

const CASES = [
  ['before deadline passes', 0, { today: '2026-10-08' }],
  ['day before deadline passes', 0, { today: '2027-01-05' }],
  ['on deadline fails', 1, { today: '2027-01-06' }],
  ['after deadline fails', 1, { today: '2027-06-01' }],
  ['ignore without record fails', 1, { records: [] }],
  ['record without ignore fails', 1, { deny: '[advisories]\n' }],
  ['missing owner fails', 1, { records: [{ ...RECORD, owner: '  ' }] }],
  ['bad deadline fails', 1, { records: [{ ...RECORD, deadline: '2027-13-40' }] }],
  ['empty tracking fails', 1, { records: [{ ...RECORD, tracking: [] }] }],
  ['duplicate ids fail', 1, { records: [RECORD, { ...RECORD }] }],
  ['crate absent from lock fails', 1, { lock: '[[package]]\nname = "other"\nversion = "9.9.9"\n' }],
  ['version drift fails', 1, { records: [{ ...RECORD, version: '1.0.5' }] }],
];

let failures = 0;
for (const [name, mustPass, options] of CASES.map(([n, e, o]) => [n, e === 0, o])) {
  const count = run(options ?? {}).length;
  const ok = mustPass ? count === 0 : count >= 1;
  if (ok) {
    console.log(`  ok   ${name}`);
  } else {
    failures++;
    console.error(
      `  FAIL ${name}: expected ${mustPass ? 'pass' : 'fail'}, got ${count} failure(s)`,
    );
  }
}

assert.equal(isValidDeadline('2027-01-06'), true);
assert.equal(isValidDeadline('2027-13-01'), false);
assert.equal(isValidDeadline('not-a-date'), false);
console.log('  ok   deadline format validation');

console.log(`\n${CASES.length + 1 - failures}/${CASES.length + 1} cases passed.`);
process.exit(failures > 0 ? 1 : 0);
