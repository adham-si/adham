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

async function run({ records = [RECORD], deny = DENY, lock = LOCK, today = '2026-10-08' } = {}) {
  return validateExceptions({
    records,
    denyText: deny,
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
let total = 0;
for (const [name, mustPass, options] of CASES.map(([n, e, o]) => [n, e === 0, o])) {
  total++;
  const count = (await run(options ?? {})).length;
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
total++;
console.log('  ok   deadline format validation');

// --- ignore extraction must read real TOML, not regex text -------------
const EXTRACTION_CASES = [
  [
    'single-quoted id counts as an ignore',
    "[advisories]\nignore = [{ id = 'RUSTSEC-2024-0370', reason = 'test' }]\n",
    ['RUSTSEC-2024-0370'],
  ],
  [
    'comment after section header still counts ignores',
    '[advisories] # valid TOML comment\nignore = [{ id = "RUSTSEC-2024-0370", reason = "test" }]\n',
    ['RUSTSEC-2024-0370'],
  ],
  [
    'commented-out entry does not count',
    '[advisories]\n# ignore = [{ id = "RUSTSEC-2024-0370", reason = "test" }]\n',
    [],
  ],
  [
    'inline single-line array counts',
    '[advisories]\nignore = [{ id = "RUSTSEC-2024-0370", reason = "test" }]\n',
    ['RUSTSEC-2024-0370'],
  ],
];

for (const [name, denyText, expected] of EXTRACTION_CASES) {
  total++;
  let actual;
  try {
    actual = parseAdvisoryIgnoreIds(denyText);
  } catch (error) {
    failures++;
    console.error(`  FAIL ${name}: extraction threw: ${error.message}`);
    continue;
  }
  try {
    assert.deepEqual(actual, expected);
    console.log(`  ok   ${name}`);
  } catch {
    failures++;
    console.error(
      `  FAIL ${name}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}

// Malformed TOML must fail closed, never read as "no ignores".
total++;
try {
  parseAdvisoryIgnoreIds('[advisories]\nignore = [{ id = "RUSTSEC-2024-0370" \n');
  failures++;
  console.error('  FAIL malformed config fails closed: extraction succeeded');
} catch {
  console.log('  ok   malformed config fails closed');
}

// An approved version coexisting with an unapproved one must fail: the
// deny ignore is advisory-ID-wide, so presence of 1.0.4 proves nothing.
total++;
{
  const both =
    '[[package]]\nname = "proc-macro-error"\nversion = "1.0.4"\n[[package]]\nname = "proc-macro-error"\nversion = "1.0.5"\n';
  const count = (await run({ lock: both })).length;
  if (count >= 1) {
    console.log('  ok   coexisting unapproved version fails');
  } else {
    failures++;
    console.error('  FAIL coexisting unapproved version fails: validation passed');
  }
}

// Injected today is helper input and must be validated like any other:
// empty, malformed and impossible dates fail instead of comparing wrong.
for (const badToday of ['', 'not-a-date', '2026-02-30']) {
  total++;
  const count = (await run({ today: badToday })).length;
  if (count >= 1) {
    console.log(`  ok   malformed injected today fails (${JSON.stringify(badToday)})`);
  } else {
    failures++;
    console.error(
      `  FAIL malformed injected today fails (${JSON.stringify(badToday)}): validation passed`,
    );
  }
}

console.log(`\n${total - failures}/${total} cases passed.`);
process.exit(failures > 0 ? 1 : 0);
